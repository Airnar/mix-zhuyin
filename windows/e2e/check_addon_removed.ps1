# After the all-in-one install over the PIME add-on: the add-on is gone from
# PIME, PIME's other input methods are still registered, and 混打注音 is
# registered once, under MixZhuyin's own text service.
$ErrorActionPreference = "Stop"
$pime = "${env:ProgramFiles(x86)}\PIME"
$profileGuid = "{99F99D2E-4C0A-4E5E-BAE6-2876AEFC9A94}"
if (Test-Path "$pime\node\input_methods\MixZhuyin") { throw "The add-on's files remain in PIME" }
$tip = "HKLM:\SOFTWARE\Microsoft\CTF\TIP\{35F67E9D-A54D-4177-9697-8B0AB71A9E04}\LanguageProfile\0x00000404"
$left = Get-ChildItem $tip | ForEach-Object PSChildName
"PIME profiles now: $($left -join ', ')"
if ($left -contains $profileGuid) { throw "The add-on is still registered under PIME" }
if ($left.Count -lt 1) { throw "PIME's other input methods were removed" }
if (-not (Test-Path "HKLM:\SOFTWARE\Microsoft\CTF\TIP\{A64DF4E9-E913-47D2-A89A-CF3134688E0D}\LanguageProfile\0x00000404\$profileGuid")) {
  throw "MixZhuyin is not registered under its own text service"
}
& (Join-Path $PSScriptRoot "check_profile_numbering.ps1")
"The add-on was replaced"
