# Removes The Wise Hive from Claude Code and Windows: hooks, memory setting, CLAUDE.md section, the wise-hive plugin,
# the watchdog task, shortcuts and start-with-Windows. Your brain folder (memories, notes, transcripts) is kept.
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Brain <folder>]
param([string]$Brain = "", [string]$ClaudeDir = "")
$a = @("--uninstall")
if ($Brain) { $a += @("--brain", $Brain) }
if ($ClaudeDir) { $a += @("--claude-dir", $ClaudeDir) }
& node (Join-Path $PSScriptRoot "installer\install.js") @a
exit $LASTEXITCODE
