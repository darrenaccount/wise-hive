# Saves the full Claude Code session transcript into <brain>\transcripts (this script lives in <brain>\tools).
# Runs from the Stop and SessionEnd hooks; reads the hook payload (JSON) from stdin.
# Writes: raw\<id>.jsonl (exact copy), readable\<date>_<project>_<id8>.md, and one line in LOG.md.
$ErrorActionPreference = "Stop"
$root = Join-Path (Split-Path $PSScriptRoot -Parent) "transcripts"
foreach ($d in @("raw", "readable")) { New-Item -ItemType Directory -Force (Join-Path $root $d) | Out-Null }
try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $src = $payload.transcript_path
    if (-not $src -or -not (Test-Path $src)) { exit 0 }
    $id = $payload.session_id
    $project = if ($payload.cwd) { Split-Path $payload.cwd -Leaf } else { "unknown" }
    $project = $project -replace '[^\w\-\.]', '_'
    $started = (Get-Item $src).CreationTime.ToString("yyyy-MM-dd")

    Copy-Item $src (Join-Path $root "raw\$id.jsonl") -Force

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("# Session $id")
    [void]$sb.AppendLine("Project: $($payload.cwd)  ")
    [void]$sb.AppendLine("Started: $started")
    [void]$sb.AppendLine("")
    $firstPrompt = ""
    foreach ($line in [System.IO.File]::ReadLines($src)) {
        if (-not $line.Trim()) { continue }
        try { $e = $line | ConvertFrom-Json } catch { continue }
        if ($e.type -ne "user" -and $e.type -ne "assistant") { continue }
        if ($e.isMeta) { continue }
        $content = $e.message.content
        $parts = @()
        if ($content -is [string]) { $parts += $content }
        else {
            foreach ($b in $content) {
                if ($b.type -eq "text" -and $b.text) { $parts += $b.text }
                elseif ($b.type -eq "tool_use") {
                    $inp = ($b.input | ConvertTo-Json -Compress -Depth 4)
                    if ($inp.Length -gt 400) { $inp = $inp.Substring(0, 400) + "..." }
                    $parts += "> tool: **$($b.name)** $inp"
                }
                elseif ($b.type -eq "tool_result" -and $b.is_error) {
                    $t = ($b.content | Out-String).Trim()
                    if ($t.Length -gt 400) { $t = $t.Substring(0, 400) + "..." }
                    $parts += "> tool error: $t"
                }
            }
        }
        $text = ($parts -join "`n`n") -replace '(?s)<system-reminder>.*?</system-reminder>', ''
        $text = $text.Trim()
        if (-not $text) { continue }
        if ($e.type -eq "user" -and -not $firstPrompt -and $text -notmatch '^>|^<') { $firstPrompt = $text }
        $who = if ($e.type -eq "user") { "## You" } else { "## Claude" }
        [void]$sb.AppendLine($who)
        [void]$sb.AppendLine($text)
        [void]$sb.AppendLine("")
    }
    $short = $id.Substring(0, [Math]::Min(8, $id.Length))
    $mdPath = Join-Path $root "readable\${started}_${project}_$short.md"
    [System.IO.File]::WriteAllText($mdPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))

    $log = Join-Path $root "LOG.md"
    if (-not (Test-Path $log)) { [System.IO.File]::WriteAllText($log, "# Session log`n`n| Date | Project | Session | First request |`n|---|---|---|---|`n") }
    if (-not (Select-String -Path $log -SimpleMatch $short -Quiet)) {
        $fp = ($firstPrompt -replace '\s+', ' ' -replace '\|', '/')
        if ($fp.Length -gt 100) { $fp = $fp.Substring(0, 100) + "..." }
        Add-Content -Path $log -Value "| $started | $project | [$short](readable/${started}_${project}_$short.md) | $fp |" -Encoding UTF8
    }
} catch {
    Add-Content -Path (Join-Path $root "hook-errors.log") -Value "$(Get-Date -Format s) $($_.Exception.Message)"
}
exit 0
