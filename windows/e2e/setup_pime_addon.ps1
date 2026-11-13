# Sets up PIME with the earlier MixZhuyin add-on, the way that add-on's
# installer left it: MixZhuyin in PIME\node\input_methods, PIME's text
# service re-registered, and an uninstall entry with PIMEDir. The all-in-one
# installer must then move the user off it.
#
#   setup_pime_addon.ps1 -PimeSetup <PIME setup.exe> -Module <output\pime dir>
param(
  [Parameter(Mandatory)][string]$PimeSetup,
  [Parameter(Mandatory)][string]$Module
)
$ErrorActionPreference = "Stop"

# PIME's installer only installs its Node.js backend when 小麥注音 is
# selected, which a silent install cannot do, so unpack it instead.
$unpacked = Join-Path $env:RUNNER_TEMP "pime-unpacked"
7z x $PimeSetup "-o$unpacked" -y | Out-Null
$launcher = Get-ChildItem $unpacked -Recurse -Filter PIMELauncher.exe | Select-Object -First 1
if (-not $launcher) { throw "PIMELauncher.exe not found" }
$pime = "${env:ProgramFiles(x86)}\PIME"
New-Item -ItemType Directory -Force $pime | Out-Null
Copy-Item "$($launcher.DirectoryName)\*" $pime -Recurse -Force
New-Item -Path "HKLM:\SOFTWARE\PIME" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\PIME" -Name "(default)" -Value $pime

$ime = "$pime\node\input_methods\MixZhuyin"
New-Item -ItemType Directory -Force $ime | Out-Null
Copy-Item "$Module\*" $ime -Recurse -Force

foreach ($regsvr in @(@{ Exe = "$env:WINDIR\System32\regsvr32.exe"; Dll = "$pime\x64\PIMETextService.dll" },
                      @{ Exe = "$env:WINDIR\SysWOW64\regsvr32.exe"; Dll = "$pime\x86\PIMETextService.dll" })) {
  $p = Start-Process $regsvr.Exe -ArgumentList '/s', "`"$($regsvr.Dll)`"" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "regsvr32 $($regsvr.Dll) failed: $($p.ExitCode)" }
}

$uninst = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MixZhuyin"
New-Item -Path $uninst -Force | Out-Null
Set-ItemProperty $uninst -Name DisplayName -Value "混打注音"
Set-ItemProperty $uninst -Name PIMEDir -Value $pime
Set-ItemProperty $uninst -Name UninstallString -Value "`"$ime\Uninstall-MixZhuyin.exe`""

$tip = "HKLM:\SOFTWARE\Microsoft\CTF\TIP\{35F67E9D-A54D-4177-9697-8B0AB71A9E04}\LanguageProfile\0x00000404"
"PIME profiles: $((Get-ChildItem $tip | ForEach-Object PSChildName) -join ', ')"
if (-not (Test-Path "$tip\{99F99D2E-4C0A-4E5E-BAE6-2876AEFC9A94}")) { throw "The add-on is not registered under PIME" }
