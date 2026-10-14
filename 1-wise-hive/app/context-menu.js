// Right-click menu for The Wise Hive window, like the Claude desktop app's: spelling suggestions for a misspelled word
// (click one -> webContents.replaceMisspelling), "Add to dictionary" (session.addWordToSpellCheckerDictionary),
// Undo/Redo/Cut/Copy/Paste/Select all in text fields, Copy for selected text, Copy link, and Copy image / Save image as…
// for pictures shown in chats. Required by main.js only (Electron), not a server module.
// template() is pure, so test/context-menu-test.js checks it with plain node. Verified 2026-10-12 on Electron 44.4.5.
const LANGS = ["en-US"];
const MAX_SUGGESTIONS = 6;

// p: Electron ContextMenuParams (or a plain object with the same fields). act: { appURL, replace(w), learn(w), copyImage(),
// saveImage(), copyLink() }. Returns a Menu template; an empty one means "show no menu" (empty spots, the sketch canvas).
function template(p, act) {
  const t = [], ed = p.editFlags || {};
  if (p.isEditable && p.misspelledWord) {
    const sug = (p.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    for (const w of sug) t.push({ label: w, click: () => act.replace(w) });
    if (!sug.length) t.push({ label: "No suggestions", enabled: false });
    t.push({ label: "Add to dictionary", click: () => act.learn(p.misspelledWord) }, { type: "separator" });
  }
  // Only the app's own pictures (chat images served from 127.0.0.1); other images get nothing extra.
  if (p.mediaType === "image" && act.appURL && String(p.srcURL || "").startsWith(act.appURL + "/"))
    t.push({ label: "Copy image", click: () => act.copyImage() }, { label: "Save image as…", click: () => act.saveImage() }, { type: "separator" });
  if (!p.isEditable && /^https?:\/\//i.test(p.linkURL || "")) t.push({ label: "Copy link", click: () => act.copyLink() }, { type: "separator" });
  if (p.isEditable) t.push({ role: "undo", enabled: !!ed.canUndo }, { role: "redo", enabled: !!ed.canRedo }, { type: "separator" },
    { role: "cut", enabled: !!ed.canCut }, { role: "copy", enabled: !!ed.canCopy }, { role: "paste", enabled: !!ed.canPaste },
    { type: "separator" }, { role: "selectAll", enabled: ed.canSelectAll !== false });
  else if (String(p.selectionText || "").trim()) t.push({ role: "copy" });
  while (t.length && t[t.length - 1].type === "separator") t.pop();
  return t;
}

// Turns on English spellchecking for the window's session and shows template() on right-click.
function install(win, { Menu, clipboard, appURL }) {
  const wc = win.webContents, ses = wc.session;
  try {
    // setSpellCheckerLanguages throws for codes Electron doesn't offer, so only pass the ones it lists.
    const have = ses.availableSpellCheckerLanguages || [], langs = LANGS.filter((l) => have.includes(l));
    if (langs.length) ses.setSpellCheckerLanguages(langs); else console.log("spellcheck: en-US not offered; using Electron's default");
    ses.setSpellCheckerEnabled(true);
  } catch (e) { console.error("spellcheck:", e && e.message || e); }
  // Without a dictionary there are no suggestions; the menu still offers Add to dictionary and Cut/Copy/Paste.
  ses.once("spellcheck-dictionary-download-failure", (e, lang) => console.error(new Date().toISOString(), "spellcheck: couldn't download the", lang, "dictionary (offline?)"));
  wc.on("context-menu", (e, p) => {
    try {
      const t = template(p, { appURL, replace: (w) => wc.replaceMisspelling(w), learn: (w) => ses.addWordToSpellCheckerDictionary(w),
        copyImage: () => wc.copyImageAt(p.x, p.y), saveImage: () => wc.downloadURL(p.srcURL), copyLink: () => clipboard.writeText(p.linkURL) });
      if (t.length) Menu.buildFromTemplate(t).popup({ window: win, x: p.x, y: p.y });
    } catch (err) { console.error("context menu:", err && err.message || err); }
  });
}

module.exports = { template, install, LANGS, MAX_SUGGESTIONS };
