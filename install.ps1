# Cinecode Studio installer for Windows. Run from the repo folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# Creates a Desktop and Start menu shortcut that opens the panel. Nothing is installed system-wide.
$ErrorActionPreference = 'Stop'
$Dir = $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js not found. Install it first: winget install OpenJS.NodeJS'; exit 1 }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Write-Host "Node.js 22+ is needed (found $(node -v)). Update: winget upgrade OpenJS.NodeJS"; exit 1 }
New-Item -ItemType Directory -Force -Path "$Dir\data" | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")) {
  $lnk = $shell.CreateShortcut("$folder\Cinecode Studio.lnk")
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\bin\cinecode-studio.ps1`""
  $lnk.WorkingDirectory = $Dir
  $lnk.IconLocation = "$Dir\icon\CinecodeStudio.ico"
  $lnk.Save()
}
Write-Host 'Done: double-click Cinecode Studio on your Desktop.'
