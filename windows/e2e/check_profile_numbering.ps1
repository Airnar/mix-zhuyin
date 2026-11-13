# The per-user input method list must stay numbered 1..N: gaps crash
# Windows 11's input switcher.
$ErrorActionPreference = "Stop"
$up = "HKCU:\Control Panel\International\User Profile\zh-Hant-TW"
if (Test-Path $up) {
  $key = Get-Item $up
  $nums = $key.Property | Where-Object { $_ -match '^[0-9A-Fa-f]{4}:\{' } | ForEach-Object { [int]$key.GetValue($_) } | Sort-Object
  "User profile order: $($nums -join ', ')"
  for ($i = 0; $i -lt $nums.Count; $i++) { if ($nums[$i] -ne $i + 1) { throw "User profile numbering has a gap" } }
}
