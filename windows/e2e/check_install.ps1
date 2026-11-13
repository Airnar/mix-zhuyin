# Checks an all-in-one MixZhuyin install: files, COM and TSF registration,
# the launcher's auto-start entry and the uninstall entry.
$ErrorActionPreference = "Stop"
$clsid = "{A64DF4E9-E913-47D2-A89A-CF3134688E0D}"
$profileGuid = "{99F99D2E-4C0A-4E5E-BAE6-2876AEFC9A94}"
$dir = Join-Path $env:ProgramFiles "MixZhuyin"

foreach ($f in @("MixZhuyinLauncher.exe", "backends.json", "Uninstall.exe", "x86\MixZhuyinTextService.dll",
                 "x64\MixZhuyinTextService.dll", "node\node.exe", "node\server.js",
                 "node\node_modules\nime\package.json", "node\input_methods\MixZhuyin\ime.json",
                 "node\input_methods\MixZhuyin\index.js", "node\input_methods\MixZhuyin\config_tool.js",
                 "licenses\LGPL-2.0.txt")) {
  if (-not (Test-Path (Join-Path $dir $f))) { throw "Missing $f" }
}

# COM: the 64-bit and 32-bit registrations point at our DLLs.
$hklm64 = [Microsoft.Win32.RegistryKey]::OpenBaseKey("LocalMachine", "Registry64")
$hklm32 = [Microsoft.Win32.RegistryKey]::OpenBaseKey("LocalMachine", "Registry32")
$inproc64 = $hklm64.OpenSubKey("SOFTWARE\Classes\CLSID\$clsid\InprocServer32")
$inproc32 = $hklm32.OpenSubKey("SOFTWARE\Classes\CLSID\$clsid\InprocServer32")
if (-not $inproc64) { throw "64-bit COM registration missing" }
if (-not $inproc32) { throw "32-bit COM registration missing" }
"64-bit COM server: $($inproc64.GetValue(''))"
"32-bit COM server: $($inproc32.GetValue(''))"
if ($inproc64.GetValue('') -notlike "*\x64\MixZhuyinTextService.dll") { throw "64-bit COM server path is wrong" }
if ($inproc32.GetValue('') -notlike "*\x86\MixZhuyinTextService.dll") { throw "32-bit COM server path is wrong" }

# TSF: the language profile is registered under our CLSID, not PIME's.
$tip = $hklm64.OpenSubKey("SOFTWARE\Microsoft\CTF\TIP\$clsid\LanguageProfile\0x00000404\$profileGuid")
if (-not $tip) { throw "TSF language profile missing" }
"TSF profile: $($tip.GetValue('Description'))"

$run = $hklm64.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
if ($run.GetValue("MixZhuyinLauncher") -notlike "*MixZhuyinLauncher.exe*") { throw "Auto-start entry missing" }
$uninst = $hklm64.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MixZhuyin")
if (-not $uninst) { throw "Uninstall entry missing" }
if ($uninst.GetValue("PIMEDir")) { throw "Uninstall entry still belongs to the PIME add-on" }
"Installed $($uninst.GetValue('DisplayVersion')) in $dir"
