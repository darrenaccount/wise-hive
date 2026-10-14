// Unit test for context-menu.js template(): the right-click menu The Wise Hive's window shows (spelling fixes, edit roles,
// Copy image / Save image as…, Copy link). Free, plain node, no Electron. Prints PASS/FAIL lines; exit 1 on any FAIL.
//   node test/context-menu-test.js
// Verified 2026-10-12.
"use strict";
const assert = require("assert");
const { template, MAX_SUGGESTIONS } = require("../context-menu.js");

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message || e)); }
}
const APP = "http://127.0.0.1:4747";
function actions() {
  const calls = [];
  const rec = (n) => (...a) => calls.push([n, ...a]);
  return { calls, act: { appURL: APP, replace: rec("replace"), learn: rec("learn"), copyImage: rec("copyImage"), saveImage: rec("saveImage"), copyLink: rec("copyLink") } };
}
const labels = (t) => t.map((x) => x.label || x.role || x.type);
const ALL = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

test("a misspelled word lists its suggestions first, then Add to dictionary and the edit roles", () => {
  const { calls, act } = actions();
  const t = template({ isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the", "ten", "tea"], editFlags: ALL }, act);
  assert.deepStrictEqual(labels(t), ["the", "ten", "tea", "Add to dictionary", "separator", "undo", "redo", "separator", "cut", "copy", "paste", "separator", "selectAll"]);
  t[0].click();
  assert.deepStrictEqual(calls, [["replace", "the"]]);
  t[3].click();
  assert.deepStrictEqual(calls[1], ["learn", "teh"]);
});
test(`at most ${MAX_SUGGESTIONS} suggestions`, () => {
  const t = template({ isEditable: true, misspelledWord: "x", dictionarySuggestions: "abcdefghij".split(""), editFlags: ALL }, actions().act);
  assert.strictEqual(t.filter((x) => x.click && x.label && x.label.length === 1).length, MAX_SUGGESTIONS);
});
test("no suggestions shows a disabled line", () => {
  const t = template({ isEditable: true, misspelledWord: "Teamwrighty", dictionarySuggestions: [], editFlags: ALL }, actions().act);
  assert.strictEqual(t[0].label, "No suggestions");
  assert.strictEqual(t[0].enabled, false);
  assert.strictEqual(t[1].label, "Add to dictionary");
});
test("edit roles follow editFlags", () => {
  const t = template({ isEditable: true, editFlags: { canPaste: true } }, actions().act);
  const by = Object.fromEntries(t.filter((x) => x.role).map((x) => [x.role, x.enabled]));
  assert.deepStrictEqual(by, { undo: false, redo: false, cut: false, copy: false, paste: true, selectAll: true });
});
test("selected reply text gets Copy only", () => {
  assert.deepStrictEqual(labels(template({ isEditable: false, selectionText: "hello" }, actions().act)), ["copy"]);
});
test("an empty spot gets no menu", () => {
  assert.deepStrictEqual(template({ isEditable: false, selectionText: "  " }, actions().act), []);
  assert.deepStrictEqual(template({}, actions().act), []);
});
test("a chat picture from the app gets Copy image and Save image as…", () => {
  const { calls, act } = actions();
  const t = template({ mediaType: "image", srcURL: APP + "/media/AAAAAAAAAAAAAAAAAAAAAA/render.png" }, act);
  assert.deepStrictEqual(labels(t), ["Copy image", "Save image as…"]);
  t[0].click(); t[1].click();
  assert.deepStrictEqual(calls.map((c) => c[0]), ["copyImage", "saveImage"]);
});
test("an outside image gets neither", () => {
  assert.deepStrictEqual(template({ mediaType: "image", srcURL: "https://example.com/x.png" }, actions().act), []);
  assert.deepStrictEqual(template({ mediaType: "image", srcURL: APP + ".evil.example/x.png" }, actions().act), []);
});
test("an https link gets Copy link", () => {
  const { calls, act } = actions();
  const t = template({ linkURL: "https://example.com/a", selectionText: "" }, act);
  assert.deepStrictEqual(labels(t), ["Copy link"]);
  t[0].click();
  assert.deepStrictEqual(calls, [["copyLink"]]);
  assert.deepStrictEqual(template({ linkURL: "javascript:alert(1)" }, act), []);
});
test("the menu never ends with a separator", () => {
  const cases = [{ mediaType: "image", srcURL: APP + "/media/x/y.png" }, { linkURL: "https://a.example" }, { isEditable: true, misspelledWord: "a", dictionarySuggestions: ["b"] },
    { linkURL: "https://a.example", selectionText: "x", mediaType: "image", srcURL: APP + "/media/x/y.png" }];
  for (const c of cases) { const t = template(c, actions().act); assert.ok(t.length && t[t.length - 1].type !== "separator", JSON.stringify(c)); }
});

console.log(failed ? `FAILED: ${failed}` : "PASSED");
process.exit(failed ? 1 : 0);
