// Which The Wise Hive this is: "full" (default) or "lite" (The Wise Hive Lite release ships edition.json = {"edition":"lite"}).
// Lite spends far less of the user's Claude usage; see the LITE notes in server.js, ideas.js, autopilot.js and updates.js.
const fs = require("fs");
const path = require("path");
let LITE = false;
try { LITE = JSON.parse(fs.readFileSync(path.join(__dirname, "edition.json"), "utf8")).edition === "lite"; } catch {}
module.exports = { LITE, EDITION: LITE ? "lite" : "full", NAME: LITE ? "The Wise Hive Lite" : "The Wise Hive" };
