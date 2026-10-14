# Opens The Wise Hive. Normally that's the Electron desktop app, which runs its own server.
#   -Restart   quit the running app/server first (after changing server.js or main.js).
#              Refused while Claude is working on a chat, unless you add -Force.
#   -NoWindow  start in the tray without showing the window
#   -Watchdog  used by watchdog.vbs: start The Wise Hive in the tray if it isn't running,
#              unless you quit it yourself from the tray
# Falls back to the standalone node server + an Edge app window if Electron isn't installed.
param([switch]$Restart, [switch]$Force, [switch]$NoWindow, [switch]$Watchdog)
$url = "http://127.0.0.1:4747"
$dist = Join-Path $PSScriptRoot "node_modules\electron\dist"
# The Electron binary is renamed to WiseHive.exe by tools\brand-electron.ps1 (name + queen icon in Task Manager).
function Get-Exe { foreach ($n in "WiseHive.exe", "electron.exe") { $p = Join-Path $dist $n; if (Test-Path $p) { return $p } }; return (Join-Path $dist "WiseHive.exe") }
$electron = Get-Exe
function Test-Up { try { Invoke-WebRequest "$url/icon.svg" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
$appRx = [regex]::Escape($PSScriptRoot)   # this app folder, wherever the brain lives
function Get-AppProcs { Get-CimInstance Win32_Process | Where-Object { ($_.Name -in 'WiseHive.exe', 'electron.exe' -and $_.CommandLine -match $appRx) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match "$appRx\\server\.js") } }
# Start through WMI so the process is outside the caller's Windows job object and app container
# (a process started from a Claude Code session dies with that session and has its AppData redirected).
function Start-Detached([string]$cmd) {
    $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $PSScriptRoot; ProcessStartupInformation = $si } | Out-Null
}

if ($Watchdog) {
    if (Test-Path (Join-Path $PSScriptRoot ".user-quit")) { return }   # you quit it on purpose
    if ((Get-AppProcs) -and (Test-Up)) { return }                      # healthy
    if (Get-AppProcs) {                                                # running but not answering: restart it
        Start-Sleep -Seconds 20
        if (Test-Up) { return }
        Get-AppProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Add-Content (Join-Path $PSScriptRoot "server.log") "$(Get-Date -Format s) watchdog: The Wise Hive wasn't answering, restarted it"
        Start-Sleep -Seconds 1
    } else {
        Add-Content (Join-Path $PSScriptRoot "server.log") "$(Get-Date -Format s) watchdog: The Wise Hive wasn't running, started it"
    }
    $NoWindow = $true
}

if ($Restart) {
    if (-not $Force) {
        try { $runs = Invoke-RestMethod "$url/api/runs" -Headers @{ "X-Hive" = "1" } -TimeoutSec 3; $busy = @($runs | Where-Object { -not $_.done }) } catch { $busy = @() }
        # Background work (a council, the Librarian/Organizer/Trimmer and other jobs that edit files) isn't a chat; a restart
        # would kill it mid-run. The server's busy count covers all of it; older servers only reported council jobs.
        try {
            $act = Invoke-RestMethod "$url/api/activity" -Headers @{ "X-Hive" = "1" } -TimeoutSec 3
            $other = if ($null -ne $act.busy) { [Math]::Max(0, [int]$act.busy - $busy.Count) } else { @($act.jobs | Where-Object { $_.label -in @("Council member", "Judge") }).Count }
        } catch { $other = 0 }
        if ($busy.Count -or $other) {
            $what = @()
            if ($busy.Count) { $what += "$($busy.Count) chat(s) ($(($busy | ForEach-Object { $_.title }) -join '; '))" }
            if ($other) { $what += "background work (a council, the Librarian, Organizer or another job)" }
            "Not restarting: Claude is working on $($what -join ' and ') in The Wise Hive. Wait for them to finish, or use -Force to stop them."
            exit 2
        }
    }
    # Ask the app to quit first (main.js watches this file), so it removes its tray icon; force only what is left after 10 s.
    if (Get-AppProcs) {
        Set-Content -Path (Join-Path $PSScriptRoot ".restart-request") -Value (Get-Date -Format s)
        for ($i = 0; $i -lt 20 -and (Get-AppProcs); $i++) { Start-Sleep -Milliseconds 500 }
        Remove-Item -LiteralPath (Join-Path $PSScriptRoot ".restart-request") -ErrorAction SilentlyContinue
    }
    Get-AppProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
}

if (Test-Path $electron) {
    $running = Get-AppProcs | Where-Object Name -ne 'node.exe'
    if ($running -and $NoWindow) { return }   # already running in the tray
    # An Electron update (npm install) brings back a plain electron.exe (named "Electron", Electron's icon);
    # turn it into WiseHive.exe again before starting. Never blocks the launch.
    $brand = Join-Path (Split-Path $PSScriptRoot) "tools\brand-electron.ps1"
    if (-not $running -and (Test-Path $brand) -and (Test-Path (Join-Path $dist "electron.exe"))) {
        try { & powershell -NoProfile -ExecutionPolicy Bypass -File $brand | Out-Null } catch { }
        $electron = Get-Exe
    }
    $hidden = if ($NoWindow) { " --hidden" } else { "" }
    # A second launch just brings the running app to the front (single instance).
    Start-Detached "`"$electron`" `"$PSScriptRoot`"$hidden"
    if (-not $running) { for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 250 } }
    return
}

if (-not (Test-Up)) {
    Start-Detached "cmd.exe /c node `"$PSScriptRoot\server.js`" >> `"$PSScriptRoot\server.log`" 2>&1"
    for ($i = 0; $i -lt 40 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 250 }
}
if ($NoWindow) { return }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process $edge -ArgumentList "--app=$url", "--window-size=1320,880" } else { Start-Process $url }
