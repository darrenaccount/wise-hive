// Phone: answer Claude's approvals and questions from a phone on the home Wi-Fi, so overnight runs don't wait
// 15 minutes and then fall back to a guess. OFF by default. When on, a SECOND http server listens on the LAN
// (0.0.0.0:4748) and serves only a mobile page plus a tiny API: list what's waiting, Allow / Deny / answer it,
// list what's running, Stop. No chats, files or memory are reachable from it.
//
// Security: a random 32-byte token (in <brain>\app-settings\phone.json, outside the app folder so updates
// and backups never copy it) is shown once as a link/QR. The page trades it for an HttpOnly SameSite=Strict cookie
// (an HMAC of the token, so Reset link revokes every paired phone). Every API call needs that cookie AND the
// X-Hive-Phone header (a cross-site form can't send custom headers), a matching Origin when one is sent, a Host
// that is an IP literal/this PC's name (blocks DNS rebinding), and a private-range client address. Wrong
// credentials lock that address out for 10 minutes after 10 tries. It's plain HTTP: fine on home Wi-Fi, not public.
const http = require("http");
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isIP } = require("net");
const { execFile } = require("child_process");

const HOST = process.env.HIVE_PHONE_HOST || "0.0.0.0"; // tests bind 127.0.0.1 so Windows shows no firewall pop-up
const SETTINGS = process.env.HIVE_PHONE_SETTINGS || path.join(process.env.TEAMWRIGHT_BRAIN || path.resolve(__dirname, ".."), "app-settings", "phone.json"); // tests point this elsewhere
const RULE = "Teamwright phone"; // the Windows firewall rule's existing name, kept on purpose: keep-old-name
const COOKIE = "teamwright_phone";
const WAIT_MS = 15 * 60 * 1000; // mirrors server.js WAIT_MS: when an unanswered prompt resolves on its own
const LOCK_AFTER = 10, LOCK_MS = 10 * 60 * 1000;
const MAX_BODY = 16 * 1024;

module.exports = (ctx) => {
  const { live, broadcast, answerRequest, stopChat, toolSummary, hub, json } = ctx;
  const PAGE = path.join(ctx.APP_DIR, "public", "phone.html");
  const log = (...a) => console.log(new Date().toISOString(), "phone:", ...a);

  /* ---------- settings ---------- */
  const load = () => { try { return { enabled: false, port: 4748, token: "", ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) }; } catch { return { enabled: false, port: 4748, token: "" }; } };
  let S = load();
  const save = () => writeFileAtomic(SETTINGS, JSON.stringify(S, null, 2));
  const newToken = () => crypto.randomBytes(32).toString("base64url");
  // The cookie is derived from the token, so rotating the token signs every phone out.
  const cookieValue = () => crypto.createHmac("sha256", S.token).update("teamwright-phone-cookie").digest("base64url");
  // Constant-time compare of strings of any length: HMAC both under a per-process key, then timingSafeEqual.
  const KEY = crypto.randomBytes(32);
  const same = (a, b) => crypto.timingSafeEqual(crypto.createHmac("sha256", KEY).update(String(a)).digest(), crypto.createHmac("sha256", KEY).update(String(b)).digest());

  /* ---------- network facts ---------- */
  // Real LAN addresses only (Wi-Fi/Ethernet first); virtual adapters (Hyper-V, WSL, VPNs) aren't reachable from a phone.
  function lanIPs() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      if (/vethernet|virtual|vmware|vbox|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier/i.test(name)) continue;
      for (const a of addrs || []) if (a.family === "IPv4" && !a.internal && privateAddr(a.address)) out.push({ name, ip: a.address, rank: /wi-?fi|wlan|wireless/i.test(name) ? 0 : /ethernet/i.test(name) ? 1 : 2 });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }
  function privateAddr(ip) {
    ip = String(ip || "").replace(/^::ffff:/i, "");
    if (ip === "::1" || /^127\./.test(ip)) return true;
    const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
    if (m) { const a = +m[1], b = +m[2]; return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254); }
    return /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe[89ab][0-9a-f]:/i.test(ip); // IPv6 unique-local and link-local
  }
  const HOSTNAME = os.hostname().toLowerCase();
  // Only real IP literals (isIP: "cafe" or "1.2.3" aren't) or this PC's own names; "[v6]:port" keeps its colons.
  const hostOk = (h) => {
    const s = String(h || "").toLowerCase(), b = /^\[([^\]]+)\](?::\d+)?$/.exec(s), host = b ? b[1] : s.replace(/:\d+$/, "");
    return (b ? isIP(host) === 6 : isIP(host) === 4) || host === "localhost" || host === HOSTNAME || host === HOSTNAME + ".local" || host === HOSTNAME + ".lan";
  };

  /* ---------- Windows Firewall ---------- */
  const run = (file, args, opts = {}) => new Promise((ok) => execFile(file, args, { timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts }, (e, out, err) => ok({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(out || "") + String(err || "") })));
  // netsh prints one block of "Key: value" lines per rule.
  const parseRules = (text) => text.split(/\r?\n(?=Rule Name:)/).filter((b) => /^Rule Name:/m.test(b)).map((b) => {
    const r = {}; for (const l of b.split(/\r?\n/)) { const m = /^([A-Za-z ]+):\s+(.*)$/.exec(l.trim()); if (m) r[m[1].trim().toLowerCase()] = m[2].trim(); }
    return r;
  });
  const coversPrivate = (profiles) => /private|any/i.test(profiles || "") || /^all$/i.test(profiles || "");
  // netsh's "Domain,Private" -> the bits PowerShell's Profile uses (Domain 1, Private 2, Public 4; Any/All = all three).
  const profileMask = (profiles) => { const p = String(profiles || ""); return /^\s*(any|all)\s*$/i.test(p) ? 7 : (/domain/i.test(p) ? 1 : 0) | (/private/i.test(p) ? 2 : 0) | (/public/i.test(p) ? 4 : 0); };
  let fwCache = null, fwAt = 0, fwBusy = false;
  async function firewall(force) {
    if (!force && fwCache && Date.now() - fwAt < 20000) return fwCache;
    const port = String(S.port);
    // Exact-name lookup; verbatim so netsh gets name="The Wise Hive phone" with its quotes.
    const mine = await run("netsh", [`advfirewall firewall show rule name="${RULE}" verbose`], { windowsVerbatimArguments: true });
    const rules = mine.code === 0 ? parseRules(mine.out) : [];
    const good = rules.find((r) => /yes/i.test(r.enabled) && /allow/i.test(r.action) && /^in$/i.test(r.direction) && coversPrivate(r.profiles) && String(r.localport).split(",").includes(port));
    // Windows adds Block rules for the app's .exe when its "allow access?" pop-up is cancelled. Block beats Allow,
    // so such a rule silently defeats ours.
    const all = await run("netsh", ["advfirewall", "firewall", "show", "rule", "name=all", "dir=in", "verbose"]);
    const exe = process.execPath.toLowerCase();
    const blocks = parseRules(all.out).filter((r) => /block/i.test(r.action) && /yes/i.test(r.enabled) && String(r.program || "").toLowerCase() === exe && coversPrivate(r.profiles))
      .map((r) => ({ name: r["rule name"], profiles: r.profiles, protocol: r.protocol }));
    const np = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '|' + $_.Name + '|' + $_.NetworkCategory }"]);
    const networks = np.out.split(/\r?\n/).map((l) => l.split("|")).filter((p) => p.length === 3).map(([alias, name, category]) => ({ alias, name, category }));
    fwCache = { checked: true, rule: !!good, ruleExists: rules.length > 0, rulePorts: rules.map((r) => r.localport), blocks, networks, exe: process.execPath };
    fwAt = Date.now();
    return fwCache;
  }
  // The exact elevated script for what's missing. Shown in Settings ("what this runs") and run behind a UAC prompt.
  function fixScript(fw, what) {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const lines = [];
    if (what === "network") {
      const lan = lanIPs()[0], net = fw.networks.find((n) => lan && n.alias === lan.name) || fw.networks[0];
      if (net) lines.push(`Set-NetConnectionProfile -InterfaceAlias ${q(net.alias)} -NetworkCategory Private`);
      return lines.join("\n");
    }
    if (fw.ruleExists && !fw.rule) lines.push(`netsh advfirewall firewall delete rule name="${RULE}"`);
    if (!fw.rule) lines.push(`netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${Number(S.port)} profile=private`);
    // Only the block rules listed (same name and profiles), and only for home/work networks: a rule that also covers
    // Public is narrowed to Public instead of deleted, so the app stays blocked on public Wi-Fi.
    const seenRule = new Set();
    for (const b of fw.blocks) {
      const mask = profileMask(b.profiles), k = b.name + "|" + mask;
      if (!b.name || !mask || seenRule.has(k)) continue;
      seenRule.add(k);
      lines.push(`Get-NetFirewallApplicationFilter -Program ${q(fw.exe)} | Get-NetFirewallRule | Where-Object { $m = [int]$_.Profile; if ($m -eq 0) { $m = 7 }; $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.DisplayName -eq ${q(b.name)} -and $m -eq ${mask} } | ${mask & 4 ? "Set-NetFirewallRule -Profile Public" : "Remove-NetFirewallRule"}`);
    }
    return lines.join("\n");
  }
  function elevate(script, dry) {
    const enc = Buffer.from(script, "utf16le").toString("base64");
    const launcher = `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${enc}'`;
    if (dry) return Promise.resolve({ dry: true, script, launcher });
    // Windows shows its UAC prompt; the user is at the PC when they press the button. Cancelling UAC makes
    // Start-Process fail, which we report.
    return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", launcher], { timeout: 5 * 60 * 1000 }).then((r) => ({ ok: r.code === 0, cancelled: r.code !== 0, out: r.out.slice(-400) }));
  }

  /* ---------- what's waiting / running ---------- */
  const seen = new Map(); // "run:req" -> first time we saw it waiting (server.js doesn't timestamp prompts)
  function scan() {
    const keys = new Set();
    for (const r of live.values()) for (const req of r.pending.keys()) { const k = r.id + ":" + req; keys.add(k); if (!seen.has(k)) seen.set(k, Date.now()); }
    for (const k of seen.keys()) if (!keys.has(k)) seen.delete(k);
  }
  hub.on("event", (ev) => { if (ev && ev.t === "runs") scan(); });
  const cut = (s, n) => (s == null ? "" : String(s).replace(/\r/g, "").slice(0, n));
  function pendingList() {
    scan();
    const out = [];
    for (const r of live.values()) {
      if (r.done) continue;
      for (const [req, p] of r.pending) {
        const since = seen.get(r.id + ":" + req) || Date.now();
        const base = { run: r.id, req, kind: p.kind, chat: r.title || "Untitled chat", runKind: r.kind, since, autoAt: since + WAIT_MS };
        if (p.kind === "ask") {
          base.questions = (p.input.questions || []).slice(0, 6).map((q) => ({ question: cut(q.question, 600), header: cut(q.header, 60), multi: !!q.multiSelect,
            options: (q.options || []).slice(0, 8).map((o) => ({ label: cut(o.label, 120), description: cut(o.description, 300) })) }));
        } else {
          const ev = [...r.events].reverse().find((e) => e.t === "perm" && e.req === req); // has the friendly tool name
          const inp = p.input || {};
          base.tool = (ev && ev.tool) || p.tool;
          base.summary = cut((ev && ev.summary) || toolSummary(p.tool, inp), 300);
          base.command = cut(inp.command, 1200) || undefined;
          base.file = cut(inp.file_path || inp.notebook_path || inp.path, 400) || undefined;
          base.url = cut(inp.url, 400) || undefined;
          if (!base.command && !base.file && !base.url) base.input = cut(JSON.stringify(inp), 600);
        }
        out.push(base);
      }
    }
    return out.sort((a, b) => a.since - b.since);
  }
  const runningList = () => [...live.values()].filter((r) => !r.done).sort((a, b) => b.started - a.started)
    .map((r) => ({ id: r.id, title: r.title || "Untitled chat", kind: r.kind, mode: r.mode, started: r.started, waiting: r.pending.size }));

  /* ---------- the phone server ---------- */
  const fails = new Map(); // address -> {n, until}
  let srv = null, listening = false, lastError = "", lastPhone = null;
  const sockets = new Set();
  const ipOf = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/i, "");
  function locked(ip) { const f = fails.get(ip); return !!(f && f.until && f.until > Date.now()); }
  function fail(ip, why) {
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
    f.n++;
    if (f.n >= LOCK_AFTER) { f.until = Date.now() + LOCK_MS; log(`locked ${ip} for 10 min after ${f.n} bad tries`); }
    fails.set(ip, f);
    log(`rejected ${ip}: ${why}`);
  }
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join("=")]));
  const send = (res, code, obj, extra = {}) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((ok) => {
    let b = "", over = false;
    req.on("data", (c) => { if (over) return; b += c; if (b.length > MAX_BODY) { over = true; b = ""; ok(null); } }); // the 413 reply closes the connection
    req.on("end", () => { if (over) return; try { const o = JSON.parse(b || "{}"); ok(o && typeof o === "object" ? o : {}); } catch { ok({}); } });
    req.on("error", () => ok(null));
  });

  const tooBig = (res) => send(res, 413, { error: "too big" }, { Connection: "close" });
  async function handle(req, res) {
    const ip = ipOf(req);
    // Only devices on the local network, and only by IP/PC name (a rebinding attacker's domain name fails here).
    if (!privateAddr(ip) || !hostOk(req.headers.host)) { res.writeHead(403); return res.end("forbidden"); }
    const url = new URL(req.url, "http://phone.invalid");
    const p = url.pathname;
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const nonce = crypto.randomBytes(16).toString("base64");
      let html; try { html = fs.readFileSync(PAGE, "utf8").replace(/__NONCE__/g, nonce); } catch { res.writeHead(500); return res.end("page missing"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
      return res.end(html);
    }
    if (!p.startsWith("/papi/")) { res.writeHead(404); return res.end("not found"); }
    // Cross-site requests can't add custom headers without a CORS preflight, which this server never approves.
    const origin = req.headers.origin;
    if (req.headers["x-hive-phone"] !== "1" || (origin && origin !== `http://${req.headers.host}`)) return send(res, 403, { error: "forbidden" });
    if (locked(ip)) return send(res, 429, { error: "locked", message: "Too many wrong tries from this device. Wait 10 minutes." });
    if (!S.enabled || !S.token) return send(res, 403, { error: "off" });

    if (p === "/papi/pair" && req.method === "POST") {
      const o = await readBody(req);
      if (!o) return tooBig(res);
      if (typeof o.k !== "string" || !same(o.k, S.token)) { fail(ip, "bad pairing link"); return send(res, 401, { error: "badlink" }); }
      fails.delete(ip);
      lastPhone = { ip, at: Date.now(), ua: cut(req.headers["user-agent"], 160) };
      log(`paired ${ip}`); broadcast({ t: "phone" });
      // No Secure flag: this is plain HTTP on the LAN. Max-Age caps at Chrome's 400-day limit.
      return send(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=${cookieValue()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${400 * 86400}` });
    }
    const c = cookies(req)[COOKIE];
    if (!c) return send(res, 401, { error: "unpaired" }); // not a guess, so it doesn't count toward the lockout
    if (!same(c, cookieValue())) { fail(ip, "bad cookie"); return send(res, 401, { error: "badcookie" }, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); }
    fails.delete(ip);
    if (!lastPhone || lastPhone.ip !== ip || Date.now() - lastPhone.at > 60000) { lastPhone = { ip, at: Date.now(), ua: cut(req.headers["user-agent"], 160) }; broadcast({ t: "phone" }); }
    else lastPhone.at = Date.now();

    if (p === "/papi/state" && req.method === "GET") return send(res, 200, { pending: pendingList(), running: runningList(), now: Date.now() });
    if (p === "/papi/answer" && req.method === "POST") {
      const o = await readBody(req);
      if (!o) return tooBig(res);
      const r = live.get(String(o.run || "")), pend = r && !r.done && r.pending.get(String(o.req || ""));
      if (!pend) return send(res, 409, { error: "gone", message: "Already answered or no longer waiting." });
      if (pend.kind === "perm") {
        if (o.decision !== "allow" && o.decision !== "deny") return send(res, 400, { error: "bad decision" });
        const ok = answerRequest(r, o.req, o.decision === "allow" ? { decision: "allow" } : { decision: "deny", message: "The user denied this from their phone. Don't retry it; find another way or ask." });
        log(`${o.decision} ${pend.tool} in "${r.title}" from ${ip}`);
        return send(res, ok ? 200 : 409, { ok });
      }
      // Build the answers from the real question texts; only the user's picks/text come from the phone.
      const qs = pend.input.questions || [], given = Array.isArray(o.answers) ? o.answers : [], answers = {};
      // A pick is an option's position in the list the phone was sent (its labels are cut to 120 characters), or a full
      // label (pages loaded before picks went by position).
      qs.forEach((q, i) => {
        const a = given[i] || {}, opts = (q.options || []).slice(0, 8), labels = new Set((q.options || []).map((x) => x.label));
        const label = (x) => (typeof x === "number" ? (Number.isInteger(x) && opts[x] && typeof opts[x].label === "string" ? opts[x].label : null) : labels.has(String(x)) ? String(x) : null);
        const picked = (Array.isArray(a.picked) ? a.picked : []).map(label).filter((l) => l !== null).slice(0, q.multiSelect ? 8 : 1);
        const text = cut(a.text, 2000).trim();
        answers[q.question] = [...picked, text].filter(Boolean).join(", ") || "No preference; use your best judgment.";
      });
      const ok = answerRequest(r, o.req, { answers });
      log(`answered a question in "${r.title}" from ${ip}`);
      return send(res, ok ? 200 : 409, { ok });
    }
    if (p === "/papi/stop" && req.method === "POST") {
      const o = await readBody(req);
      if (!o) return tooBig(res);
      const r = live.get(String(o.run || ""));
      if (!r || r.done) return send(res, 409, { error: "gone", message: "That run already finished." });
      stopChat(r, "user"); log(`stopped "${r.title}" from ${ip}`);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "unknown" });
  }

  function listen() {
    if (srv) return;
    lastError = "";
    srv = http.createServer((req, res) => { handle(req, res).catch((e) => { try { send(res, 500, { error: "server" }); } catch {} log("error", e && e.stack || e); }); });
    srv.requestTimeout = 15000; srv.headersTimeout = 10000; srv.maxConnections = 64;
    srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    srv.on("error", (e) => { lastError = e.code === "EADDRINUSE" ? `Port ${S.port} is already in use by another program.` : String(e.message || e); listening = false; log("listen error:", lastError); try { srv.close(); } catch {} srv = null; broadcast({ t: "phone" }); });
    srv.listen(Number(S.port), HOST, () => { listening = true; log(`listening on ${HOST}:${S.port}`); broadcast({ t: "phone" }); });
  }
  function close() {
    if (!srv) return;
    const s = srv; srv = null; listening = false;
    s.close(); for (const k of sockets) k.destroy(); sockets.clear();
    log("stopped listening"); broadcast({ t: "phone" });
  }

  /* ---------- Settings routes (main app only, behind server.js's origin + x-hive check) ---------- */
  // nocheck: skip the netsh/PowerShell firewall look (the API test uses it, so a test run starts no system tools).
  async function status(force, nocheck) {
    const ips = lanIPs(), fw = nocheck ? { checked: false, rule: false, ruleExists: false, rulePorts: [], blocks: [], networks: [], exe: process.execPath } : await firewall(force);
    const lan = ips[0], net = fw.networks.find((n) => lan && n.alias === lan.name);
    return {
      enabled: S.enabled, port: S.port, listening, error: lastError,
      link: S.enabled && S.token && lan ? `http://${lan.ip}:${S.port}/?k=${S.token}` : "",
      ip: lan ? lan.ip : "", otherIPs: ips.slice(1).map((x) => x.ip), lastPhone,
      firewall: { rule: fw.rule, ruleExists: fw.ruleExists, rulePorts: fw.rulePorts, blocks: fw.blocks, script: fixScript(fw, "rule") },
      network: net ? { alias: net.alias, name: net.name, category: net.category, script: /public/i.test(net.category) ? fixScript(fw, "network") : "" } : null,
      fixing: fwBusy,
    };
  }
  async function route(p, req, res, url) {
    if (!p.startsWith("/api/phone")) return false;
    if (p === "/api/phone" && req.method === "GET") { json(res, 200, await status(url.searchParams.get("refresh") === "1", url.searchParams.get("nocheck") === "1")); return true; }
    if (p === "/api/phone" && req.method === "POST") {
      const o = await ctx.body(req);
      if (o.port !== undefined) {
        const n = Number(o.port);
        if (!Number.isInteger(n) || n < 1024 || n > 65535 || n === ctx.PORT || n === 4747) { json(res, 400, { error: "Pick a port between 1024 and 65535 (not The Wise Hive's own)." }); return true; }
        if (n !== S.port) { S.port = n; fwCache = null; if (srv) { close(); if (S.enabled) listen(); } }
      }
      if (o.enabled !== undefined) {
        S.enabled = !!o.enabled;
        if (S.enabled && !S.token) S.token = newToken();
        if (S.enabled) listen(); else close();
      }
      save(); json(res, 200, await status()); return true;
    }
    if (p === "/api/phone/reset" && req.method === "POST") {
      S.token = newToken(); save(); log("link reset; every paired phone is signed out");
      json(res, 200, await status()); return true;
    }
    if (p === "/api/phone/firewall" && req.method === "POST") {
      const o = await ctx.body(req);
      const fw = await firewall(true), script = fixScript(fw, o.what === "network" ? "network" : "rule");
      if (!script) { json(res, 200, { ok: true, nothing: true }); return true; }
      if (o.dry) { json(res, 200, await elevate(script, true)); return true; }
      if (fwBusy) { json(res, 409, { error: "Already waiting for Windows to ask you." }); return true; }
      fwBusy = true; json(res, 200, { launched: true });
      elevate(script).then((r) => { fwBusy = false; fwCache = null; log(r.ok ? "firewall change done" : "firewall change cancelled"); broadcast({ t: "phone", fixed: r.ok, cancelled: !!r.cancelled }); });
      return true;
    }
    return false;
  }

  function start() { if (S.enabled && S.token) listen(); }
  return { route, start };
};
