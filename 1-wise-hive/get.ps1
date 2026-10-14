# One-line installer: downloads the latest The Wise Hive from GitHub and runs install.ps1 with the same options.
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/1-wise-hive/get.ps1))) -InstallMissing
# The repo holds both editions as folders (1-wise-hive, 2-wise-hive-lite); $edition picks one (export.js sets it for Lite).
# The download goes to %USERPROFILE%\.wise-hive\source (outside AppData, which Claude Desktop sessions redirect).
$ErrorActionPreference = "Stop"
$repo = "darrenaccount/wise-hive"
$edition = "1-wise-hive"
$home_ = Join-Path $env:USERPROFILE ".wise-hive"
$zip = Join-Path $home_ "wise-hive.zip"
$src = Join-Path $home_ "source"
New-Item -ItemType Directory -Force $home_ | Out-Null
Write-Host "Downloading $edition from github.com/$repo ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
$tmp = Join-Path $home_ "extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp -Force
$root = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
$folder = Join-Path $root $edition
if (-not (Test-Path (Join-Path $folder "install.ps1"))) { throw "The download has no $edition folder with install.ps1 in it." }
if (Test-Path $src) { Remove-Item $src -Recurse -Force }
Move-Item $folder $src
Remove-Item $tmp, $zip -Recurse -Force
& (Join-Path $src "install.ps1") @args
