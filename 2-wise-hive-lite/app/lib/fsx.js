// Shared file helpers for server.js, main.js and the feature modules (added in the 2026-10-13 refactor).
// writeFileAtomic is the one copy of "write a temp file next to it, then rename": a crash or power cut mid-write can't leave
// a half-written state file that is read again at the next start. If the rename fails (Windows: the target is open in
// another program), it falls back to writing the file directly, as the old per-module copies did.
const fs = require("fs");
const path = require("path");

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
  catch { fs.writeFileSync(file, data); try { fs.unlinkSync(tmp); } catch {} }
}

// JSON.parse of a file, or `fallback` when it is missing or unreadable.
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

module.exports = { writeFileAtomic, readJson };
