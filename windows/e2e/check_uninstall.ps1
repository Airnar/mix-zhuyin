# Checks that uninstalling MixZhuyin removed its files and registrations and
# left the per-user input method list numbered without gaps.
$ErrorActionPreference = "Stop"
$clsid = "{A64DF4E9-E913-47D2-A89A-CF3134688E0D}"
$dir = Join-Path $env:ProgramFiles "MixZhuyin"

foreach ($f in @("MixZhuyinLauncher.exe", "node\input_methods\MixZhuyin\ime.json", "x64\MixZhuyinTextService.dll")) {
  if (Test-Path (Join-Path $dir $f)) { throw "$f remains" }
}
if (Get-Process MixZhuyinLauncher -ErrorAction SilentlyContinue) { throw "The launcher is still running" }

$hklm64 = [Microsoft.Win32.RegistryKey]::OpenBaseKey("LocalMachine", "Registry64")
$hklm32 = [Microsoft.Win32.RegistryKey]::OpenBaseKey("LocalMachine", "Registry32")
if ($hklm64.OpenSubKey("SOFTWARE\Classes\CLSID\$clsid")) { throw "64-bit COM registration remains" }
if ($hklm32.OpenSubKey("SOFTWARE\Classes\CLSID\$clsid")) { throw "32-bit COM registration remains" }
if ($hklm64.OpenSubKey("SOFTWARE\Microsoft\CTF\TIP\$clsid")) { throw "TSF registration remains" }
$run = $hklm64.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
if ($run.GetValue("MixZhuyinLauncher")) { throw "Auto-start entry remains" }
if ($hklm64.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MixZhuyin")) { throw "Uninstall entry remains" }
if ($hklm64.OpenSubKey("SOFTWARE\MixZhuyin")) { throw "Product key remains" }

& (Join-Path $PSScriptRoot "check_profile_numbering.ps1")
"Uninstalled cleanly"
