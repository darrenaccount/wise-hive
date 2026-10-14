# Sends a message (or a task) from a Claude session to The Wise Hive app.
#   -Text     the message
#   -Task     run it as a new chat in The Wise Hive (starts right away, even if the window is closed)
#   -Folder   project folder for a task (default: the brain folder)
#   -Mode     read | edit | full for a task (default edit)
#   -ReplyTo  id of The Wise Hive message you're answering
param([Parameter(Mandatory = $true)][string]$Text, [switch]$Task, [string]$Folder = (Split-Path $PSScriptRoot -Parent), [string]$Mode = "edit", [string]$ReplyTo = "")
$body = @{ text = $Text; task = [bool]$Task; folder = $Folder; mode = $Mode; replyTo = $ReplyTo } | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:4747/api/link/inbox" -Method Post -Headers @{ "X-Hive" = "1" } -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 15
    if ($Task) { "Task handed to The Wise Hive (message $($r.msg.id), run $($r.run))." } else { "Delivered to The Wise Hive (message $($r.msg.id))." }
} catch {
    "The Wise Hive isn't running, so the message wasn't delivered. Open it from The Wise Hive shortcut and try again. ($($_.Exception.Message))"
    exit 1
}
