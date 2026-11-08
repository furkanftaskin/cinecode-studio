# Cinecode Studio launcher for Windows: starts the local server if it is not running, then opens the panel
# in an app window (Edge or Chrome). Started hidden by the Desktop shortcut that install.ps1 creates.
$ErrorActionPreference = 'SilentlyContinue'
$Dir = Split-Path -Parent $PSScriptRoot
$Port = 4910
$Url = "http://localhost:$Port"
New-Item -ItemType Directory -Force -Path "$Dir\data" | Out-Null
$up = Get-NetTCPConnection -LocalPort $Port -State Listen
if (-not $up) {
  Start-Process -FilePath 'node' -ArgumentList "`"$Dir\server.mjs`"" -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput "$Dir\data\server.log" -RedirectStandardError "$Dir\data\server.err.log"
  for ($i = 0; $i -lt 50; $i++) { Start-Sleep -Milliseconds 100; if (Get-NetTCPConnection -LocalPort $Port -State Listen) { break } }
}
if ($args -contains '--serve') { exit 0 }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$browser = if ($edge) { $edge } elseif ($chrome) { $chrome } else { $null }
if ($browser) { Start-Process $browser "--app=$Url --window-size=1280,860" } else { Start-Process $Url }
