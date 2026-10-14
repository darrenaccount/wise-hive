#!/usr/bin/env node
// Memory health check from the command line (same logic as The Wise Hive's Library > Health tab: app\memhealth.js).
// Usage: node <brain>\tools\check-memory.js [brainFolder] [--json]
// Read-only. Exit code 1 if there are errors, 0 if only warnings/notes. Verified 2026-10-12.
const path = require("path");
const { check, report } = require(path.join(__dirname, "..", "app", "memhealth.js"));
const args = process.argv.slice(2);
const brain = args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..");
const r = check(path.resolve(brain));
console.log(args.includes("--json") ? JSON.stringify(r, null, 1) : report(r));
process.exitCode = r.counts.error ? 1 : 0;
