---
name: updates
description: Run The Wise Hive Messenger - check whether the Claude desktop app's Claude Code has updated and, if so, update the CLI and adapt The Wise Hive app to the new version (with backup, verification and rollback). Use when the user asks to check for Claude updates, update The Wise Hive, or make The Wise Hive match the desktop app.
---

# The Messenger

The Wise Hive app does the real work (backup, adapting, `node --check`, a smoke test on a spare port, rollback, and a restart once nothing is running), so drive it through its local API rather than editing the app by hand.

1. **Status:**
   ```powershell
   Invoke-RestMethod http://127.0.0.1:4747/api/updates -Headers @{ "X-Hive" = "1" } | ConvertTo-Json -Depth 5
   ```
   Report the versions: the desktop app, the desktop app's Claude Code, The Wise Hive's Claude Code, the latest release, and the version The Wise Hive was last adapted to. Also report whether it's busy, and the last few history entries.
2. **Check now** (updates the CLI and adapts The Wise Hive if the desktop app's Claude Code is newer):
   ```powershell
   Invoke-RestMethod http://127.0.0.1:4747/api/updates/check -Method Post -Headers @{ "X-Hive" = "1" } -ContentType "application/json" -Body "{}"
   ```
   Then poll the status every ~30 s until `busy` is false, and report what happened: up to date, CLI updated, The Wise Hive adapted (and what changed), no change needed, or rolled back (and why).
3. If the user wants The Wise Hive re-adapted to the current version anyway: POST `/api/updates/adapt` with body `{"force":true}`.
4. If the app isn't reachable, start it with `powershell -File {{BRAIN}}\app\start.ps1 -NoWindow` and try again. Never edit files in `{{BRAIN}}\app` from this skill.

Details of the update process are in `{{BRAIN}}\projects\wise-hive.md`.
