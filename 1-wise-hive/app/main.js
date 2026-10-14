// The Wise Hive desktop app (Electron). Runs The Wise Hive server in-process, shows it in its own window,
// lives in the tray when closed (so runs, handoffs and messages from Claude Desktop keep working), and
// raises Windows notifications when Claude needs you or finishes.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, nativeTheme, dialog, powerSaveBlocker, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const { execFileSync } = require("child_process");

const AUMID = "ClaudeBrain.Teamwright";
const { NAME } = require("./edition");   // "The Wise Hive" or "The Wise Hive Lite"
const ICON = path.join(__dirname, "teamwright-icon.ico"); // Queen Claude, drawn by make-icon.py; new name dodges Windows' icon cache
const LOG = path.join(__dirname, "server.log");
const START_HIDDEN = process.argv.includes("--hidden");

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.setAppUserModelId(AUMID);
// Renamed from Hivemind on 2026-10-12: copy the old settings and page storage (%APPDATA%\hivemind) over once. keep-old-name
try {
  const ud = app.getPath("userData"), old = path.join(app.getPath("appData"), "hivemind"); // keep-old-name
  if (!fs.existsSync(ud) && fs.existsSync(old)) {
    fs.cpSync(old, ud, { recursive: true, filter: (src) => !/lockfile$/i.test(src) });
    const os = path.join(ud, "hivemind-settings.json") /* keep-old-name */, ns = path.join(ud, "teamwright-settings.json");
    if (fs.existsSync(os) && !fs.existsSync(ns)) fs.renameSync(os, ns);
  }
} catch (e) { console.error("userData move:", e.message); }
nativeTheme.themeSource = "dark";
// Marker the watchdog (watchdog.vbs, every 2 minutes) checks: it leaves The Wise Hive closed only if you quit it yourself.
const QUIT_FLAG = path.join(__dirname, ".user-quit");
try { fs.rmSync(QUIT_FLAG, { force: true }); } catch {}

// Server output goes to server.log, as with the standalone server.
const logStream = fs.createWriteStream(LOG, { flags: "a" });
for (const k of ["log", "error"]) { const orig = console[k]; console[k] = (...a) => { try { logStream.write(a.map(String).join(" ") + "\n"); } catch {} orig(...a); }; }

// A standalone server from start.ps1 may still hold the port: stop it before starting ours.
try {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -match '" + path.join(__dirname, "server.js").replace(/[\\.]/g, (c) => "\\" + c).replace(/'/g, "''") + "' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { windowsHide: true, timeout: 15000 });
} catch {}

// If an automatic update (updates.js) left the server unable to load, put that update's backup back once and relaunch,
// instead of letting the watchdog restart a broken app forever.
function restoreLastUpdate(err) {
  try {
    const stateFile = path.join(__dirname, "..", "updates", "state.json");
    const S = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    // Only while an update is in progress or its restart is still pending: at any other time the failure isn't the update's
    // fault, and copying the old backup over the app would silently undo all later work (the error dialog explains it instead).
    if (!S.adapting && !S.pendingRestart) return false;
    const last = (S.history || []).slice().reverse().find((h) => h.type === "adapt" && h.backup);
    const dir = (S.adapting && S.adapting.backup) || (last && path.resolve(__dirname, last.backup));
    if (!dir || !fs.existsSync(dir)) return false;
    const marker = path.join(__dirname, ".restored-backup");
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === dir) return false; // already tried this one
    const copy = (rel) => {
      for (const name of fs.readdirSync(path.join(dir, rel))) {
        const r = path.join(rel, name), src = path.join(dir, r);
        if (fs.statSync(src).isDirectory()) { if (!(rel === "" && name === "rejected")) copy(r); continue; }
        fs.mkdirSync(path.dirname(path.join(__dirname, r)), { recursive: true });
        fs.copyFileSync(src, path.join(__dirname, r));
      }
    };
    copy("");
    fs.writeFileSync(marker, dir);
    S.adapting = null; S.pendingRestart = false;
    (S.history = S.history || []).push({ at: new Date().toISOString(), type: "rollback", text: `The Wise Hive couldn't start after the update (${String(err && err.message || err).slice(0, 200)}), so the desktop app put back the backup from before it.` });
    writeFileAtomic(stateFile, JSON.stringify(S, null, 2));
    console.error(new Date().toISOString(), "restored update backup", dir);
    return true;
  } catch (e) { console.error("restore failed:", e); return false; }
}
let srv;
try { srv = require("./server.js"); }
catch (e) {
  console.error(new Date().toISOString(), "server failed to load:", e && e.stack || e);
  if (restoreLastUpdate(e)) { app.relaunch(); app.exit(0); return; }
  app.whenReady().then(() => { dialog.showErrorBox("The Wise Hive can't start", `The server failed to load:\n\n${e && e.message || e}\n\nDetails are in ${LOG}.`); app.exit(1); });
  return;
}
const { hub, PORT, activeRuns } = srv;
// The server couldn't listen (e.g. the port is taken): say so once instead of showing a window that never loads.
let serverErrorShown = false;
hub.on("server-error", (e) => {
  if (serverErrorShown) return;
  serverErrorShown = true;
  const taken = e && e.code === "EADDRINUSE";
  app.whenReady().then(() => dialog.showMessageBox({ type: "error", title: NAME, message: taken ? `${NAME} can't start its server: port ${PORT} is already in use.` : `${NAME}'s server stopped with an error.`,
    detail: `${taken ? "Another copy of The Wise Hive (or its standalone server) may still be running. Close it, then open The Wise Hive again.\n\n" : ""}${e && e.message || e}\n\nDetails are in ${LOG}.` })).catch(() => {});
});
// Taste verdicts are saved only from this window: a per-launch key, kept in memory only (never logged, saved or put in
// the environment), that server.js isPage() checks and createWindow() adds to the window's own API calls.
const PAGE_KEY = require("crypto").randomBytes(32).toString("hex");
try { if (srv.setPageKey) srv.setPageKey(PAGE_KEY); } catch {}
// The Taste library's signing key: in this app's data folder, outside the brain where Training rounds work, and handed
// to the server in memory (server.js tasteKey). A broken file is kept aside, never silently reused.
try {
  const KF = path.join(app.getPath("userData"), "taste.key");
  let k = ""; try { k = fs.readFileSync(KF, "utf8").trim(); } catch {}
  if (!/^[0-9a-f]{64}$/.test(k)) {
    if (fs.existsSync(KF)) fs.renameSync(KF, KF + ".bad-" + Date.now());
    k = require("crypto").randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(KF), { recursive: true });
    fs.writeFileSync(KF, k, { flag: "wx" });
  }
  if (srv.setTasteKey) srv.setTasteKey(k);
} catch (e) { console.error(new Date().toISOString(), "taste key:", e && e.message || e); }
const URL = `http://127.0.0.1:${PORT}`;
const SETTINGS = path.join(app.getPath("userData"), "teamwright-settings.json");
const settings = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } })();
const saveSettings = () => { try { writeFileAtomic(SETTINGS, JSON.stringify(settings, null, 2)); } catch {} };

let win = null, tray = null, quitting = false;
// Active Training/Working modes, the resume time of those paused on purpose, and the power-save blocker id.
const awake = { modes: new Set(), paused: new Map(), id: null, timer: null };
const AWAKE_BEFORE = 24 * 3600e3; // only a pause ending over a day away (a weekly limit) lets the PC sleep; shorter ones must wake up on time to resume
function syncAwake() {
  const now = Date.now(), far = (m) => awake.paused.get(m) > now + AWAKE_BEFORE;
  const need = [...awake.modes].filter((m) => !far(m));
  clearTimeout(awake.timer); awake.timer = null;
  if (need.length && awake.id === null) { awake.id = powerSaveBlocker.start("prevent-app-suspension"); console.log(new Date().toISOString(), "keeping the PC awake for", need.join(", ")); }
  if (!need.length && awake.id !== null) { powerSaveBlocker.stop(awake.id); awake.id = null; console.log(new Date().toISOString(), "PC may sleep again", awake.modes.size ? "(paused for over a day)" : ""); }
  // If the PC is still on a day before the pause ends, keep it awake from then on.
  const ends = [...awake.modes].filter(far).map((m) => awake.paused.get(m));
  if (!need.length && ends.length) { awake.timer = setTimeout(syncAwake, Math.min(2e9, Math.min(...ends) - AWAKE_BEFORE - now + 1000)); if (awake.timer.unref) awake.timer.unref(); }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 720, minHeight: 520, title: NAME, icon: ICON,
    backgroundColor: "#101216", autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  win.removeMenu();
  // Adds the page key to this window's own /api/ calls (see PAGE_KEY). Electron keeps only one onBeforeSendHeaders
  // listener per session: a later feature that needs one must merge into this one.
  win.webContents.session.webRequest.onBeforeSendHeaders((d, cb) => {
    if (d.url.startsWith(URL + "/api/")) d.requestHeaders["X-Hive-Page"] = PAGE_KEY;
    cb({ requestHeaders: d.requestHeaders });
  });
  // Taskbar pins made from this window keep the queen icon and relaunch The Wise Hive (not bare electron.exe).
  if (process.platform === "win32") try { win.setAppDetails({ appId: AUMID, appIconPath: ICON, appIconIndex: 0, relaunchCommand: `"${process.execPath}" "${__dirname}"`, relaunchDisplayName: "The Wise Hive" }); } catch (e) { console.error("setAppDetails:", e.message); }
  // One pending retry at a time (the earliest asked for): every new loadURL aborts the one in flight (ERR_ABORTED, -3),
  // and when that aborted load fired both retry paths again, the retries multiplied. An aborted load isn't retried:
  // whatever replaced it reports its own result.
  let retry = null, retryAt = 0;
  const load = () => { clearTimeout(retry); retry = null; if (win.isDestroyed()) return; win.loadURL(URL).catch((e) => { if (!e || e.errno !== -3) later(500); }); };
  const later = (ms) => { if (retry && retryAt <= Date.now() + ms) return; clearTimeout(retry); retryAt = Date.now() + ms; retry = setTimeout(load, ms); };
  hub.once("ready", load);
  setTimeout(load, 300);
  win.once("ready-to-show", () => { if (!START_HIDDEN) showWindow(); });
  // A window that has never been shown (the --hidden start at login and after every restart) still tells its page it is
  // "visible", and timers run at full speed there, so the pixel scenes kept drawing for hours in a window nobody could
  // see (measured: the GPU process at ~1 s of CPU per 30 s, versus 0 for a bare hidden window). The page gets the real
  // state on <html data-shell="shown|hidden">, and pixel.js / jobs-client.js don't draw while it says hidden.
  const shell = () => {
    if (!win || win.isDestroyed()) return;
    const s = win.isVisible() && !win.isMinimized() ? "shown" : "hidden";
    win.webContents.executeJavaScript(`document.documentElement.dataset.shell = ${JSON.stringify(s)}; window.dispatchEvent(new Event("hive:shell"));`).catch(() => {});
  };
  win.webContents.on("did-finish-load", shell);
  for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, shell);
  // Closing hides to the tray so chats, handoffs and messages keep working.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!settings.toldAboutTray) {
      settings.toldAboutTray = true; saveSettings();
      new Notification({ title: "The Wise Hive is still running", body: "It lives in the tray so Claude can keep working and reach you. Right-click the tray icon to quit.", icon: ICON }).show();
    }
  });
  // Self-healing page: reload if it crashes, fails to load, or hangs. Claude's runs live in this process and keep going.
  win.webContents.on("render-process-gone", (e, d) => { console.error(new Date().toISOString(), "page crashed:", d.reason); later(500); });
  win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => { if (isMain && code !== -3) later(1000); });
  // A page that hangs for 8 s is reloaded, unless it answers again before then.
  let hang = null;
  win.on("unresponsive", () => { clearTimeout(hang); hang = setTimeout(() => { hang = null; try { if (!win.isDestroyed()) win.webContents.reloadIgnoringCache(); } catch {} }, 8000); });
  win.on("responsive", () => { clearTimeout(hang); hang = null; });
  // Links open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(URL)) { e.preventDefault(); shell.openExternal(url); } });
  // Right-click menu like the Claude desktop app: spelling fixes, Add to dictionary, Cut/Copy/Paste, Copy/Save image.
  try { require("./context-menu").install(win, { Menu, clipboard, appURL: URL }); } catch (e) { console.error("context menu:", e && e.message || e); }
}
function openAtLogin() { return app.getLoginItemSettings({ path: process.execPath, args: [__dirname, "--hidden"] }).openAtLogin; }
function setOpenAtLogin(on) { app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [__dirname, "--hidden"] }); }
function quitApp() {
  const n = activeRuns(), modes = [...awake.modes];
  if (n || modes.length) {
    const what = [n ? `working on ${n} chat${n === 1 ? "" : "s"} or council${n === 1 ? "" : "s"}` : "", modes.length ? `running ${modes.join(" and ")}` : ""].filter(Boolean).join(" and ");
    const r = dialog.showMessageBoxSync({ type: "warning", buttons: ["Keep running", "Quit anyway"], defaultId: 0, cancelId: 0, title: "The Wise Hive",
      message: `Claude is still ${what}.`, detail: "Quitting stops that work until you open The Wise Hive again. The Wise Hive can stay in the tray instead." });
    if (r !== 1) return;
  }
  try { fs.writeFileSync(QUIT_FLAG, new Date().toISOString()); } catch {}
  quitting = true; app.quit();
}
// A fixed GUID per edition: a new start takes over the same tray slot, so an app that was force-killed (restarts, crashes)
// doesn't leave a ghost icon next to the new one. If Windows refuses the GUID (it is tied to the exe's path), fall back.
const TRAY_GUID = /Lite/.test(NAME) ? "b780b26f-721c-4b7c-9179-2fd19c0a8822" : "e039b1c1-42f2-4bbf-9529-e8454f687a8c";
function buildTray() {
  const img = nativeImage.createFromPath(ICON);
  try { tray = new Tray(img, TRAY_GUID); } catch (e) { console.error("tray guid:", e && e.message || e); tray = new Tray(img); }
  tray.setToolTip(NAME);
  const menu = () => Menu.buildFromTemplate([
    { label: `Open ${NAME}`, click: showWindow },
    { label: "Start with Windows", type: "checkbox", checked: openAtLogin(), click: (i) => setOpenAtLogin(i.checked) },
    { type: "separator" },
    { label: `Quit ${NAME}`, click: quitApp },
  ]);
  tray.setContextMenu(menu());
  tray.on("click", showWindow);
  tray.on("right-click", () => tray.setContextMenu(menu()));
}
// Start-menu and Desktop shortcuts carry the app id, which Windows needs to show this app's notifications.
function ensureShortcuts() {
  const opts = { target: process.execPath, args: `"${__dirname}"`, cwd: __dirname, icon: ICON, iconIndex: 0, appUserModelId: AUMID, description: `${NAME}: Claude's memory, agent team and chats` };
  for (const dir of [path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"), app.getPath("desktop")]) {
    const lnk = path.join(dir, `${NAME}.lnk`);
    // Switching editions renames the shortcut: remove the other one.
    // A locked or protected shortcut (EPERM/EBUSY) is skipped: it mustn't stop the others, or the window and tray.
    for (const other of ["The Wise Hive.lnk", "The Wise Hive Lite.lnk", "Teamwright.lnk", "Teamwright Lite.lnk", "Hivemind.lnk", "Hivemind Lite.lnk"]) /* keep-old-name */ if (other !== `${NAME}.lnk`) { try { fs.rmSync(path.join(dir, other), { force: true }); } catch (e) { console.error("shortcut:", e.message); } }
    try { fs.rmSync(lnk, { force: true }); if (!shell.writeShortcutLink(lnk, "create", opts)) console.error("shortcut: could not write", lnk); } catch (e) { console.error("shortcut:", e.message); }
  }
}

app.on("second-instance", showWindow);
// The tray icon goes with the app (a quit that skips this leaves a dead icon until the mouse passes over it).
app.on("before-quit", () => { quitting = true; try { if (tray) { tray.destroy(); tray = null; } } catch {} });
// start.ps1 -Restart writes .restart-request and waits for a clean exit before it force-kills anything.
const RESTART_FLAG = path.join(__dirname, ".restart-request");
try { fs.rmSync(RESTART_FLAG, { force: true }); } catch {}
fs.watchFile(RESTART_FLAG, { interval: 1000 }, (cur) => {
  if (!cur.mtimeMs) return;
  try { fs.rmSync(RESTART_FLAG, { force: true }); } catch {}
  quitting = true; app.quit();
});
app.on("window-all-closed", () => {}); // keep running in the tray

app.whenReady().then(() => {
  try { fs.rmSync(path.join(__dirname, ".restored-backup"), { force: true }); } catch {} // started fine: allow a future restore
  // Shortcuts and the login item are extras: an error there (EPERM/EBUSY) must not keep the window and tray from appearing.
  try { ensureShortcuts(); } catch (e) { console.error("shortcuts:", e && e.message || e); }
  try { if (!settings.loginItemSet) { setOpenAtLogin(true); settings.loginItemSet = true; saveSettings(); } } catch (e) { console.error("login item:", e && e.message || e); }
  // The exe can be renamed (electron.exe -> WiseHive.exe by tools\brand-electron.ps1): if "Start with Windows" is on
  // but points at another exe, point it at this one.
  try {
    const li = app.getLoginItemSettings({ path: process.execPath, args: [__dirname, "--hidden"] });
    const stale = (li.launchItems || []).some((i) => i.path && i.path.toLowerCase() !== process.execPath.toLowerCase() && /\\(electron|wisehive)\.exe$/i.test(i.path));
    if (!li.openAtLogin && stale) setOpenAtLogin(true);
  } catch (e) { console.error("login item:", e.message); }
  createWindow();
  buildTray();
  // Training and Working run while the user sleeps: keep Windows from suspending while either is active, except
  // while it's paused (usage limit, daily cap, quiet hours) until more than an hour from now.
  hub.on("event", (ev) => {
    if (!ev || ev.t !== "autopilot" || !ev.mode) return;
    const s = ev.state || {}, until = s.pause && (Number(s.pause.until) || Number(s.restingUntil));
    if (s.active) awake.modes.add(ev.mode); else awake.modes.delete(ev.mode);
    if (s.active && until > 0) awake.paused.set(ev.mode, until); else awake.paused.delete(ev.mode);
    syncAwake();
  });
  hub.on("notify", (n) => {
    if (win && win.isVisible() && win.isFocused()) return; // the page shows its own toast
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: n.title || "The Wise Hive", body: String(n.body || "").slice(0, 200), icon: ICON });
    note.on("click", () => {
      showWindow();
      const js = n.chat ? `openSession(${JSON.stringify(n.chat)})` : n.view ? `show(${JSON.stringify(n.view)})` : "";
      if (js) win.webContents.executeJavaScript(js).catch(() => {});
    });
    note.show();
  });
});
