# Restarts The Wise Hive once no chat has been running for 2 minutes, so a chat inside The Wise Hive can apply its own
# code changes without killing itself. Gives up after 12 hours. Written 2026-10-12 for the guardrails batch.
$deadline = (Get-Date).AddHours(12); $idleSince = $null
while ((Get-Date) -lt $deadline) {
  try {
    $runs = Invoke-RestMethod -Uri http://127.0.0.1:4747/api/runs -Headers @{ 'x-hive' = '1' } -TimeoutSec 10
    $busy = @($runs | Where-Object { -not $_.done }).Count
  } catch { $busy = 0 }
  # Background work isn't a chat: the server's own busy count (chats, councils, Librarian/Organizer/Trimmer and other
  # jobs that edit files) replaces the chat count when it's there; older servers only reported council jobs.
  try {
    $act = Invoke-RestMethod -Uri http://127.0.0.1:4747/api/activity -Headers @{ 'x-hive' = '1' } -TimeoutSec 10
    if ($null -ne $act.busy) { $busy = [int]$act.busy }
    else { $busy += @($act.jobs | Where-Object { $_.label -in @('Council member', 'Judge') }).Count }
  } catch {}
  if ($busy -gt 0) { $idleSince = $null }
  elseif (-not $idleSince) { $idleSince = Get-Date }
  elseif (((Get-Date) - $idleSince).TotalSeconds -ge 120) {
    & powershell -NoProfile -File (Join-Path (Split-Path $PSScriptRoot -Parent) "app\start.ps1") -Restart -NoWindow
    if ($LASTEXITCODE -ne 2) { exit 0 }  # 2 = refused because a chat started meanwhile; keep waiting
    $idleSince = $null
  }
  Start-Sleep -Seconds 20
}
