# SessionStart hook: loads what Claude has learned into every new session before it starts.
# Prints JSON whose additionalContext is injected into the session.
# Claude Code replaces hook context over 10,000 characters with a ~2 KB preview, so this stays under MAX (9,500):
# INDEX.md, the skills list, one-line pointers to the lessons and knowledge files (Grep them when a task needs them),
# and the newest real sessions (the app's own helper runs are skipped). memory\MEMORY.md is skipped when settings.json
# autoMemoryDirectory already points at <brain>\memory, because Claude Code loads that index itself.
# Fixed 2026-10-13: it used to paste LESSONS.md and every knowledge file (~24,000 chars), so sessions only saw a preview.
$ErrorActionPreference = "SilentlyContinue"
$MAX = 9500
$brain = Split-Path $PSScriptRoot -Parent   # this script lives in <brain>\tools
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }

function Section([string]$text) { if ($text) { return $text.TrimEnd() + "`n`n" } else { return "" } }

# 1. Header
$head = "# Recall from $brain (loaded automatically at session start)`nBefore starting work, use what is below. Apply the matching skill and lessons instead of re-learning. Search $brain\transcripts\readable\ for details of past work.`n`n"

# 2. INDEX.md
$index = ""
$idx = Join-Path $brain "INDEX.md"
if (Test-Path $idx) { $index = Section (Get-Content $idx -Raw -Encoding UTF8) }

# 3. Skills (name + description, shortened)
$skills = ""
$sk = New-Object System.Text.StringBuilder
Get-ChildItem (Join-Path $claudeDir "skills") -Directory | ForEach-Object {
    $f = Join-Path $_.FullName "SKILL.md"
    if (Test-Path $f) {
        $desc = ((Get-Content $f -TotalCount 8 -Encoding UTF8) | Where-Object { $_ -match '^description:' }) -replace '^description:\s*', ''
        if ($desc.Length -gt 160) { $desc = $desc.Substring(0, 157) + "..." }
        [void]$sk.AppendLine("- **$($_.Name)**: $desc")
    }
}
if ($sk.Length) { $skills = Section ("## Skills learned (use the Skill tool when one fits)`n" + $sk.ToString()) }

# 4. Memory index, only when Claude Code doesn't load it itself
$memory = ""
$auto = ""
try { $auto = (Get-Content (Join-Path $claudeDir "settings.json") -Raw | ConvertFrom-Json).autoMemoryDirectory } catch {}
$memDir = Join-Path $brain "memory"
$loadsItself = $auto -and ((Resolve-Path $auto -ErrorAction SilentlyContinue).Path -eq (Resolve-Path $memDir -ErrorAction SilentlyContinue).Path)
$mem = Join-Path $memDir "MEMORY.md"
if (-not $loadsItself -and (Test-Path $mem)) { $memory = Section ("## Memories (files in $memDir)`n" + (Get-Content $mem -Raw -Encoding UTF8)) }

# 5. Lessons and knowledge: one line each (read or Grep the file when the task needs it)
$lp = New-Object System.Text.StringBuilder
$les = Join-Path $brain "blender\LESSONS.md"
if (Test-Path $les) {
    $n = @(Get-Content $les -Encoding UTF8 | Where-Object { $_ -match '^\s*- ' }).Count
    [void]$lp.AppendLine("- $les : $n Blender lessons (techniques, mistakes and fixes, export limits). Grep it for your topic before any Blender work.")
}
Get-ChildItem (Join-Path $brain "knowledge") -Filter *.md | ForEach-Object {
    $title = (Get-Content $_.FullName -TotalCount 5 -Encoding UTF8 | Where-Object { $_ -match '^#' } | Select-Object -First 1) -replace '^#+\s*', ''
    [void]$lp.AppendLine("- $($_.FullName) : $title")
}
$lessons = if ($lp.Length) { Section ("## Lessons and knowledge (read the file when the task touches it)`n" + $lp.ToString()) } else { "" }

# 6. Newest real sessions (not the app's own helper runs)
$recent = ""
$log = Join-Path $brain "transcripts\LOG.md"
if (Test-Path $log) {
    # Skip helper runs and test runs: the request (last column) is empty, a role prompt, an app tag or a test probe.
    $real = { param($row) $req = (($row -split '\|') | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim().Trim([char]0xFEFF).Trim(); $req.Length -ge 12 -and $req -notmatch '^[A-Za-z]:[\\/]' -and $req -notmatch '^(You are (the|a message relay)|\[(Hivemind|Teamwright|Wise Hive)|reply (ok|with)|run (exactly|these)|\(see attached\))' -and $req -notmatch '^\[[0-9a-f]{8}\]\(readable/' }
    $rows = Get-Content $log -Encoding UTF8 | Where-Object { $_ -match '^\| 20' -and (& $real $_) } |
        Sort-Object -Descending | Select-Object -First 8 | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0, 197) + "..." } else { $_ } }
    if ($rows) { $recent = Section ("## Most recent sessions`n" + ($rows -join "`n")) }
}

# Fit under MAX: drop the oldest recent sessions first, then shorten INDEX with a pointer to the full file.
$text = $head + $index + $skills + $memory + $lessons + $recent
while ($text.Length -gt $MAX -and $rows -and $rows.Count -gt 0) {
    $rows = @($rows | Select-Object -First ($rows.Count - 1))
    $recent = if ($rows.Count) { Section ("## Most recent sessions`n" + ($rows -join "`n")) } else { "" }
    $text = $head + $index + $skills + $memory + $lessons + $recent
}
if ($text.Length -gt $MAX) {
    $room = $MAX - ($head + $skills + $memory + $lessons + $recent).Length - 120
    if ($room -gt 500) { $index = $index.Substring(0, [Math]::Min($index.Length, $room)) + "`n...(INDEX.md continues: read $idx)`n`n" }
    $text = $head + $index + $skills + $memory + $lessons + $recent
    if ($text.Length -gt $MAX) { $text = $text.Substring(0, $MAX - 60) + "`n...(cut to fit; read $idx)" }
}

$out = @{ hookSpecificOutput = @{ hookEventName = "SessionStart"; additionalContext = $text } } | ConvertTo-Json -Depth 4 -Compress
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::Out.Write($out)
exit 0
