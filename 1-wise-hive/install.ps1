# Installs (or updates) The Wise Hive on Windows: the brain folder, Claude Code hooks and memory, the /wise-hive skills,
# and The Wise Hive desktop app. Safe to run again; it never overwrites your memories or notes.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Brain <folder>] [-InstallMissing] [-WithVideo]
#                                                        [-NoApp] [-NoImport] [-NoStart] [-NoWatchdog]
#   -Brain           where the memory lives (default: %USERPROFILE%\ClaudeBrain, or the existing install)
#   -InstallMissing  install what's missing: Node.js LTS (winget) and the Claude Code CLI (official installer)
#   -WithVideo       also set up tutorial-video watching for training (Python, yt-dlp, the Watch plugin)
#   -NoApp           skills, hooks and memory only; no desktop app
#   -NoImport        don't copy in existing Claude memories and past conversations
#   -NoStart         don't open the app at the end
#   -NoWatchdog      no scheduled task that restarts the app if it stops
#   -ClaudeDir       use another Claude config folder (for testing)
param([string]$Brain = "", [switch]$InstallMissing, [switch]$WithVideo, [switch]$NoApp, [switch]$NoImport, [switch]$NoStart, [switch]$NoWatchdog, [string]$ClaudeDir = "")
$ErrorActionPreference = "Stop"

function Update-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Has([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget([string]$id, [string]$what) {
    if (-not (Has winget)) { throw "$what is missing and winget isn't available. Install $what yourself, then run this again." }
    Write-Host "Installing $what with winget..."
    winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
    Update-Path
}

if ($env:OS -ne "Windows_NT") { throw "The Wise Hive runs on Windows only." }
Update-Path

# Node.js runs the installer and the app.
if (-not (Has node)) {
    if ($InstallMissing) { Winget "OpenJS.NodeJS.LTS" "Node.js" }
    if (-not (Has node)) { throw "Node.js is needed. Run this again with -InstallMissing, or install the LTS version from https://nodejs.org" }
}

# The Wise Hive's chats and agents run through the Claude Code CLI (the desktop app alone isn't enough).
$claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
if (-not (Test-Path $claudeExe) -and -not (Has claude)) {
    if ($InstallMissing) {
        Write-Host "Installing the Claude Code CLI (official installer from claude.ai)..."
        Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
        Update-Path
    }
    if (-not (Test-Path $claudeExe) -and -not (Has claude)) { throw "The Claude Code CLI is needed. Run this again with -InstallMissing, or see https://docs.claude.com/en/docs/claude-code/setup" }
}

$a = @()
if ($Brain) { $a += @("--brain", $Brain) }
if ($ClaudeDir) { $a += @("--claude-dir", $ClaudeDir) }
if ($NoApp) { $a += "--no-app" }
if ($NoImport) { $a += "--no-import" }
if ($NoStart) { $a += "--no-start" }
if ($NoWatchdog) { $a += "--no-watchdog" }
& node (Join-Path $PSScriptRoot "installer\install.js") @a
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($WithVideo) {
    Write-Host "`n== Tutorial videos for training"
    if (-not (Has python)) { if ($InstallMissing) { Winget "Python.Python.3.12" "Python" } }
    if (-not (Has yt-dlp)) { Winget "yt-dlp.yt-dlp" "yt-dlp" }
    if (-not (Has ffmpeg)) { Winget "Gyan.FFmpeg" "FFmpeg" }
    $claude = if (Test-Path $claudeExe) { $claudeExe } else { "claude" }
    if ($ClaudeDir) { $env:CLAUDE_CONFIG_DIR = $ClaudeDir }
    & $claude plugin marketplace add bradautomates/claude-video
    & $claude plugin install watch@claude-video
    Write-Host "   Training can now watch tutorial videos (Watch plugin by bradautomates)."
}
