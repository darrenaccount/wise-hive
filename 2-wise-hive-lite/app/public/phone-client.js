/* Phone: the Settings side of phone.js. Adds a "Phone" card to the Settings view with the on/off toggle, the
   pairing link as a QR code (public/qr.js, loaded on demand), and what stands between the phone and the PC:
   is the server listening, is Windows Firewall letting it through, is the Wi-Fi marked Public. */
(function () {
  "use strict";
  const H = { "X-Hive": "1", "Content-Type": "application/json" };
  const call = (p, body) => fetch(p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
  const e = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const since = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
  let card = null, data = null, busy = false, resetArm = 0, msg = "", loading = null, loadErr = "";

  const style = document.createElement("style");
  style.textContent = `
.ph-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ph-head h2{margin:0}
.ph-head .toggle{color:var(--ink);font-size:14px;font-weight:700}
.ph-grid{display:grid;grid-template-columns:200px minmax(0,1fr);gap:18px;align-items:start}
.ph-qr{background:#fff;border-radius:12px;padding:6px;width:200px;height:200px}
.ph-qr svg{width:100%;height:100%;display:block}
.ph-steps{margin:0;padding-left:20px;font-size:14px}
.ph-steps li{margin-bottom:4px}
.ph-link{font:12px var(--f-mono,monospace);background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:6px 8px;overflow-wrap:anywhere;user-select:all;color:var(--muted)}
.ph-st{display:flex;flex-direction:column;gap:8px}
.ph-line{display:flex;gap:10px;align-items:flex-start;font-size:14px}
.ph-line::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--ok);flex:none;margin-top:6px}
.ph-line.warn::before{background:var(--warn)}.ph-line.bad::before{background:var(--bad)}.ph-line.off::before{background:var(--muted)}
.ph-line > div{flex:1;min-width:0}
.ph-line small{display:block;color:var(--muted);font-size:12.5px}
.ph-line .row{margin-top:6px}
.ph-line details{margin-top:4px;font-size:12px;color:var(--muted)}
.ph-line pre{font:12px var(--f-mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--sunk);border-radius:8px;padding:6px 8px;margin:4px 0 0}
.ph-warn{font-size:12.5px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;margin:0}
.ph-msg{font-size:13px;color:var(--warn);margin:0}
.ph-port{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted)}
.ph-port input{width:90px;padding:4px 8px}
@media (max-width:760px){.ph-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  // The QR encoder is only needed here, so load it on first use instead of adding another script tag.
  let qrReady = null;
  const loadQR = () => qrReady || (qrReady = window.HiveQR ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/qr.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));

  function mount() {
    if (card && card.isConnected) return true;
    const page = document.querySelector("#v-settings .page"), after = document.getElementById("healthCards");
    if (!page || !after) return false;
    card = document.createElement("section");
    card.className = "card stack"; card.id = "phoneCard";
    after.insertAdjacentElement("afterend", card);
    card.addEventListener("click", onClick);
    card.addEventListener("change", onChange);
    return true;
  }

  function line(cls, title, small, extra = "") { return `<div class="ph-line ${cls}"><div><b>${title}</b>${small ? `<small>${small}</small>` : ""}${extra}</div></div>`; }
  const what = (script) => script ? `<details><summary>What this runs</summary><pre>${e(script)}</pre></details>` : "";

  function draw() {
    if (!mount()) return;
    const d = data;
    const head = `<div class="ph-head"><h2 class="sec">Phone</h2><span class="spacer"></span><label class="toggle"><input type="checkbox" data-ph="toggle" ${d && d.enabled ? "checked" : ""} ${busy || !d ? "disabled" : ""}> Answer from my phone</label></div>
      <p class="muted" style="margin:0;font-size:14px">Allow, deny or answer Claude's questions from your phone, so overnight Training, Working and chats don't wait 15 minutes and then guess.</p>`;
    // No status yet: "Checking…" until the first answer; if it failed, why, and a way to try again.
    if (!d) { card.innerHTML = head + (loadErr ? `<p class="ph-msg">${e(loadErr)}</p><div class="row"><button class="btn small" type="button" data-ph="check">Check again</button></div>` : `<div class="none">Checking…</div>`); return; }
    if (!d.enabled) { card.innerHTML = head + (msg ? `<p class="ph-msg">${e(msg)}</p>` : "") + `<p class="ph-warn">Off. Nothing on your network can reach The Wise Hive. When you turn it on, The Wise Hive also listens on your home Wi-Fi (port ${e(d.port)}), only for this.</p>`; return; }

    const fw = d.firewall, net = d.network, publicNet = net && /public/i.test(net.category);
    const fwOk = fw.rule && !fw.blocks.length;
    const lines = [];
    lines.push(d.listening ? line("", `Listening on port ${e(d.port)}`, d.ip ? `Your PC's address on the Wi-Fi is ${e(d.ip)}.${d.otherIPs.length ? " Also: " + e(d.otherIPs.join(", ")) : ""}` : "No Wi-Fi or network address found.")
      : line("bad", "Not listening", e(d.error || "Starting…")));
    if (fw.blocks.length) lines.push(line("bad", "Windows is blocking The Wise Hive", `Windows added ${fw.blocks.length} "block" rule${fw.blocks.length > 1 ? "s" : ""} for The Wise Hive, probably when its "allow access?" pop-up was closed. Blocks win over allows, so your phone can't connect.`,
      `<div class="row"><button class="btn small primary" type="button" data-ph="fw" ${d.fixing ? "disabled" : ""}>Fix in Windows Firewall</button></div>${what(fw.script)}`));
    else lines.push(fw.rule ? line("", "Windows Firewall lets your phone in", `Rule "The Wise Hive phone": port ${e(d.port)}, home (private) networks only.`)
      : line("warn", "Windows Firewall will block your phone", fw.ruleExists ? `The "The Wise Hive phone" rule is for port ${e(fw.rulePorts.join(", "))}, not ${e(d.port)}.` : "Windows needs your permission to let your phone reach this port. Windows will ask you to confirm.",
        `<div class="row"><button class="btn small primary" type="button" data-ph="fw" ${d.fixing ? "disabled" : ""}>Allow through Windows Firewall</button></div>${what(fw.script)}`));
    if (net) lines.push(publicNet ? line("warn", `Your Wi-Fi "${e(net.name)}" is set to Public`, "Windows treats Public networks as strangers' networks, and the firewall rule only opens the port on Private (home) networks. If this is your home Wi-Fi, mark it as private.",
      `<div class="row"><button class="btn small" type="button" data-ph="net" ${d.fixing ? "disabled" : ""}>Mark it as my home network</button></div>${what(net.script)}`)
      : line("", `Your Wi-Fi "${e(net.name)}" is a home (private) network`, ""));
    if (d.fixing) lines.push(line("warn", "Waiting for you", "Windows is asking for permission. Click Yes in its prompt."));
    lines.push(d.lastPhone ? line("", `Phone last connected ${since(d.lastPhone.at)}`, `From ${e(d.lastPhone.ip)}.`) : line("off", "No phone connected yet", "Scan the code with your phone's camera."));
    const ready = d.listening && fwOk && !publicNet;

    card.innerHTML = head + (msg ? `<p class="ph-msg">${e(msg)}</p>` : "") + `
      <div class="ph-grid">
        <div class="ph-qr" data-ph="qr" aria-label="QR code with the phone link"></div>
        <div class="stack" style="gap:10px">
          <ol class="ph-steps"><li>Point your phone's camera at the code and open the link.</li><li>Bookmark the page or add it to your home screen. The phone stays signed in.</li><li>Keep it open when you're away: it refreshes every 5 seconds and buzzes when Claude needs you.</li></ol>
          <div class="ph-link">${e(d.link || "No network address found")}</div>
          <div class="row"><button class="btn small" type="button" data-ph="copy" ${d.link ? "" : "disabled"}>Copy link</button><button class="btn small" type="button" data-ph="reset">${resetArm ? "Click again: your phone will need to scan the new code" : "Reset link"}</button><button class="btn small" type="button" data-ph="check">Check again</button></div>
          <div class="ph-port">Port <input type="number" min="1024" max="65535" value="${e(d.port)}" data-ph="port" aria-label="Phone port"></div>
        </div>
      </div>
      <div class="ph-st">${lines.join("")}</div>
      <p class="ph-warn">${ready ? "Ready. " : ""}Works only while your phone is on the same Wi-Fi as this PC. The connection isn't encrypted (plain HTTP), which is fine on your home Wi-Fi but don't turn this on while the PC is on public Wi-Fi. Anyone with the link can answer for you, so use Reset link if it leaks. When you turn this on, Windows may ask whether "Electron" can use the network: choose Allow on private networks. There are no phone notifications; the open page buzzes instead.</p>`;
    const box = card.querySelector('[data-ph="qr"]');
    if (d.link) loadQR().then(() => { if (box.isConnected) box.innerHTML = window.HiveQR.svg(d.link, { ecl: "M" }); }).catch(() => { box.textContent = "QR code unavailable"; });
  }

  async function load(refresh) {
    if (loading) return loading;
    loading = (async () => { try { data = await call("/api/phone" + (refresh ? "?refresh=1" : "")); loadErr = ""; } catch (err) { msg = "Can't reach The Wise Hive server."; loadErr = err && err.message && err.message !== "Failed to fetch" ? err.message : msg; } draw(); })().finally(() => (loading = null));
    return loading;
  }
  async function act(fn) { busy = true; msg = ""; draw(); try { data = await fn(); } catch (err) { msg = err.message; } busy = false; draw(); }

  function onChange(ev) {
    const t = ev.target.dataset.ph;
    if (t === "toggle") act(() => call("/api/phone", { enabled: ev.target.checked }));
    if (t === "port") act(() => call("/api/phone", { port: Number(ev.target.value) }));
  }
  async function onClick(ev) {
    const b = ev.target.closest("[data-ph]"); if (!b || b.tagName === "INPUT") return;
    const t = b.dataset.ph;
    if (t === "copy" && data && data.link) { try { await navigator.clipboard.writeText(data.link); b.textContent = "Copied"; } catch { b.textContent = "Select the link and copy it"; } setTimeout(draw, 1500); }
    if (t === "check") { b.disabled = true; await load(true); }
    if (t === "reset") {
      // Two clicks instead of a confirm() dialog.
      if (!resetArm) { resetArm = setTimeout(() => { resetArm = 0; draw(); }, 5000); return draw(); }
      clearTimeout(resetArm); resetArm = 0;
      act(() => call("/api/phone/reset", {}));
    }
    if (t === "fw" || t === "net") {
      b.disabled = true;
      try { await call("/api/phone/firewall", { what: t === "net" ? "network" : "rule" }); msg = ""; } catch (err) { msg = err.message; }
      load();
    }
  }

  const visible = () => { const v = document.getElementById("v-settings"); return v && !v.hidden; };
  window.addEventListener("hive:view", (ev) => { if (ev.detail && ev.detail.view === "settings") { mount(); load(); } });
  window.addEventListener("hive:server", (ev) => {
    const m = ev.detail;
    if (!m || m.t !== "phone") return;
    if (m.cancelled) msg = "Windows didn't make the change (the permission prompt was cancelled).";
    if (m.fixed) msg = "";
    if (visible()) load(m.fixed !== undefined);
  });
  if (visible()) { mount(); load(); }
})();
