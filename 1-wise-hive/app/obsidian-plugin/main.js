/* The Wise Hive, Obsidian plugin (built 2026-10-13). Source: <brain>\app\obsidian-plugin (The Wise Hive copies it
   into <vault>\.obsidian\plugins\wise-hive on every start, so edit it there, not in the vault).
   Talks to The Wise Hive's local server (http://127.0.0.1:4747, routes in app\obsidian.js):
     - Ask The Wise Hive about this note    -> a chat in the app; the answer opens as a note in "Wise Hive/Answers"
     - Send this note to The Wise Hive as a task (it can edit files)
     - Put this note to the council          -> the debate opens as a note in council/
     - Open The Wise Hive                    -> starts or shows the app
   A status bar item shows whether the app is reachable. Plain JS, no build step. */
const { Plugin, Notice, Modal, Setting, PluginSettingTab, requestUrl, FileSystemAdapter } = require("obsidian");

const DEFAULTS = { server: "http://127.0.0.1:4747" };

class AskModal extends Modal {
  constructor(app, title, placeholder, onSubmit) { super(app); this.title = title; this.placeholder = placeholder; this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    const ta = contentEl.createEl("textarea", { attr: { rows: "5", placeholder: this.placeholder, style: "width:100%;resize:vertical" } });
    const row = contentEl.createDiv({ attr: { style: "display:flex;justify-content:flex-end;gap:8px;margin-top:10px" } });
    const go = () => { const v = ta.value.trim(); if (!v) return; this.close(); this.onSubmit(v); };
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const send = row.createEl("button", { text: "Send", cls: "mod-cta" }); send.onclick = go;
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
    setTimeout(() => ta.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = class WiseHivePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.status = this.addStatusBarItem();
    this.status.setText("Wise Hive: …");
    this.status.addEventListener("click", () => this.ping(true));

    this.addRibbonIcon("hexagon", "Ask The Wise Hive about this note", () => this.ask("ask"));
    this.addCommand({ id: "ask", name: "Ask The Wise Hive about this note", callback: () => this.ask("ask") });
    this.addCommand({ id: "task", name: "Send this note to The Wise Hive as a task", callback: () => this.ask("task") });
    this.addCommand({ id: "council", name: "Put this note to the council", callback: () => this.council() });
    this.addCommand({ id: "open-app", name: "Open The Wise Hive", callback: () => this.openApp() });
    this.addSettingTab(new WiseHiveSettings(this.app, this));

    this.ping(false);
    this.registerInterval(window.setInterval(() => this.ping(false), 30000));
  }

  // --- talking to the app ---
  async call(method, p, payload) {
    const r = await requestUrl({ url: this.settings.server + p, method, headers: { "X-Hive": "1" }, contentType: "application/json",
      body: payload ? JSON.stringify(payload) : undefined, throw: false });
    let data = {}; try { data = r.json; } catch {}
    if (r.status >= 400) throw new Error((data && data.error) || `The Wise Hive answered ${r.status}`);
    return data;
  }
  async ping(loud) {
    try {
      const s = await this.call("GET", `/api/obsidian/status?client=plugin&v=${this.manifest.version}`);
      this.online = true;
      this.status.setText(s.running ? `Wise Hive: working (${s.running})` : "Wise Hive: online");
      if (loud) new Notice("The Wise Hive is running.");
    } catch (e) {
      this.online = false;
      this.status.setText("Wise Hive: offline");
      if (loud) new Notice("The Wise Hive isn't running. Use the command “Open The Wise Hive”.");
    }
  }

  // --- the note the user is on ---
  current() {
    const file = this.app.workspace.getActiveFile();
    const view = this.app.workspace.activeEditor;
    const selection = view && view.editor ? view.editor.getSelection() : "";
    return { file: file && file.extension === "md" ? file.path : "", selection, name: file ? file.basename : "" };
  }

  ask(kind) {
    const c = this.current();
    if (kind === "task" && !c.file) return new Notice("Open the note with the task first.");
    const title = kind === "task" ? `Task for The Wise Hive${c.name ? ` (from “${c.name}”)` : ""}` : `Ask The Wise Hive${c.name ? ` about “${c.name}”` : ""}`;
    const hint = kind === "task" ? "What should it do? (It can edit files. Ctrl+Enter sends.)" : (c.selection ? "Your question about the selected text… (Ctrl+Enter sends)" : "Your question… (Ctrl+Enter sends)");
    new AskModal(this.app, title, hint, async (question) => {
      try {
        const r = await this.call("POST", "/api/obsidian/ask", { kind, file: c.file, selection: c.selection, question });
        new Notice(kind === "task" ? "Sent to The Wise Hive. You'll see a note when it's done." : "Asked The Wise Hive. The answer opens here when it's ready.");
        this.follow(r.job);
      } catch (e) { new Notice("Couldn't reach The Wise Hive: " + e.message); this.ping(false); }
    }).open();
  }

  async council() {
    const c = this.current();
    if (!c.file && !c.selection) return new Notice("Open (or select) the idea you want the council to judge.");
    try {
      const r = await this.call("POST", "/api/obsidian/council", { file: c.file, selection: c.selection });
      new Notice("The council is debating it. The verdict opens here in a minute or two.");
      this.follow(r.job);
    } catch (e) { new Notice("Couldn't reach The Wise Hive: " + e.message); }
  }

  // Wait for a job, then open the note it produced.
  follow(job) {
    const started = Date.now();
    const timer = window.setInterval(async () => {
      let j;
      try { j = await this.call("GET", `/api/obsidian/job/${job}`); } catch (e) { if (Date.now() - started > 3600e3) window.clearInterval(timer); return; }
      if (j.status === "running") return;
      window.clearInterval(timer);
      if (j.status === "done" && j.note) {
        await this.app.workspace.openLinkText(j.note, "", true);
        new Notice(j.kind === "council" ? "The council has ruled." : "The Wise Hive answered.");
      } else new Notice("The Wise Hive couldn't finish: " + (j.error || "unknown error"));
    }, 3000);
    this.registerInterval(timer);
  }

  openApp() {
    const a = this.app.vault.adapter;
    if (!(a instanceof FileSystemAdapter)) return new Notice("This only works on the desktop app.");
    const start = require("path").join(a.getBasePath(), "app", "start.ps1");
    const cp = require("child_process").spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", start], { detached: true, stdio: "ignore", windowsHide: true });
    cp.unref();
    new Notice("Opening The Wise Hive…");
    window.setTimeout(() => this.ping(false), 8000);
  }
};

class WiseHiveSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("The Wise Hive address").setDesc("Where the app's local server listens. Leave it unless you changed the port.")
      .addText((t) => t.setValue(this.plugin.settings.server).onChange(async (v) => { this.plugin.settings.server = v.trim().replace(/\/+$/, "") || DEFAULTS.server; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Check the connection").addButton((b) => b.setButtonText("Check").onClick(() => this.plugin.ping(true)));
  }
}
