// Electron self-test for right-click spelling fixes (context-menu.js), run outside The Wise Hive with its own profile:
//   node_modules\electron\dist\electron.exe test\spell-selftest.js
// Opens a small window off-screen, types "teh quick " into a textarea, right-clicks "teh" with real input events, and
// checks that context-menu.js install() offers suggestions and that clicking the first one replaces the word.
// Dictionary downloads are pointed at an unreachable local address, so the test never fetches anything: it proves the
// spellchecker that works offline (on Windows, the system's own). Prints a JSON line, then PASS or FAIL; exit 0/1.
// Verified 2026-10-12 on Electron 44.4.5.
"use strict";
const { app, BrowserWindow, clipboard } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { install } = require("../context-menu.js");

const DATA = path.join(os.tmpdir(), "teamwright-spelltest");
fs.mkdirSync(DATA, { recursive: true });
app.setPath("userData", DATA);
const out = { available: [], languages: [], events: [], misspelled: "", suggestions: [], menu: [], after: "" };
const finish = (ok, why) => {
  console.log(JSON.stringify(out));
  console.log(ok ? "PASS spellcheck suggestions and replace work" : "FAIL " + why);
  app.exit(ok ? 0 : 1);
};
setTimeout(() => finish(false, "timed out after 40 s"), 40000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: -3000, y: -3000, width: 420, height: 200, show: false, webPreferences: { spellcheck: true, contextIsolation: true } });
  const ses = win.webContents.session;
  ses.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/"); // never download (port 9 = discard)
  for (const e of ["spellcheck-dictionary-initialized", "spellcheck-dictionary-download-begin", "spellcheck-dictionary-download-success", "spellcheck-dictionary-download-failure"])
    ses.on(e, (ev, lang) => out.events.push(e.replace("spellcheck-dictionary-", "") + ":" + lang));
  // The real install(), with a Menu stand-in that records the menu instead of showing it.
  let last = null;
  const Menu = { buildFromTemplate: (t) => ({ popup: () => { last = t; } }) };
  install(win, { Menu, clipboard, appURL: "http://127.0.0.1:1" });
  win.webContents.on("context-menu", (e, p) => { out.misspelled = p.misspelledWord; out.suggestions = p.dictionarySuggestions || []; });
  out.available = ses.availableSpellCheckerLanguages || [];
  out.languages = ses.getSpellCheckerLanguages();
  await win.loadURL("data:text/html,<body style='margin:0'><textarea id=t style='font:20px monospace;width:400px;height:150px' autofocus></textarea></body>");
  win.showInactive();
  win.webContents.focus();
  await win.webContents.executeJavaScript("document.getElementById('t').focus()");
  win.webContents.insertText("teh quick ");
  for (let i = 0; i < 40 && !out.misspelled; i++) {
    await sleep(500);
    // Right-click the middle of the first word.
    const r = await win.webContents.executeJavaScript(`(() => { const t = document.getElementById('t'); t.focus(); t.setSelectionRange(1, 1); const b = t.getBoundingClientRect(); return { x: Math.round(b.left + 22), y: Math.round(b.top + 14) }; })()`);
    for (const type of ["mouseDown", "mouseUp"]) win.webContents.sendInputEvent({ type, button: "right", x: r.x, y: r.y, clickCount: 1 });
    await sleep(300);
  }
  out.menu = (last || []).map((x) => x.label || x.role || x.type);
  if (!out.misspelled) return finish(false, "no misspelled word reported (no dictionary?)");
  if (!out.suggestions.length || !last || !last[0].click) return finish(false, "no suggestions in the menu");
  last[0].click(); // replaceMisspelling(first suggestion)
  await sleep(500);
  out.after = await win.webContents.executeJavaScript("document.getElementById('t').value");
  if (!/^the quick/i.test(out.after)) return finish(false, "the word wasn't replaced");
  finish(true);
}).catch((e) => finish(false, e && e.stack || String(e)));
