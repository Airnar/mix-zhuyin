# Builds the all-in-one MixZhuyin installer on Windows:
#   windows\build\MixZhuyin-<version>-setup.exe
#
# Needs: Visual Studio 2022 or later with the x86, x64 and ARM64 C++ tools,
# CMake 3.19+, Rust (rustup) with the i686-pc-windows-msvc target, Node.js and
# npm, NSIS 3.x (makensis). Run `npm ci` and `npm run build:pime` first.
#
#   pwsh windows\build_all_in_one.ps1
param(
  # The Node.js runtime shipped with MixZhuyin (x64; it also runs on ARM64).
  [string]$NodeVersion = "22.23.4",
  # Skip steps whose output already exists (handy when iterating locally).
  [switch]$Reuse
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$pime = Join-Path $root "windows\pime"
$work = Join-Path $root "windows\build"
$payload = Join-Path $work "payload"
New-Item -ItemType Directory -Force $work | Out-Null

function Invoke-Checked([string]$what, [scriptblock]$block) {
  Write-Host "==> $what"
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE" }
}

$version = (Get-Content (Join-Path $root "output\pime\ime.json") -Raw | ConvertFrom-Json).version
if (-not (Test-Path (Join-Path $root "output\pime\index.js")) -or
    -not (Test-Path (Join-Path $root "output\pime\config_tool.js"))) {
  throw "output\pime is not built; run npm run build:pime first."
}

# 1. Text service DLLs. x86 serves 32-bit apps everywhere; x64 and ARM64
#    serve 64-bit apps. On ARM64, an ARM64X forwarder picks the ARM64 or x64
#    build for each process.
foreach ($arch in @(@{ Name = "x86"; Cmake = "Win32" }, @{ Name = "x64"; Cmake = "x64" }, @{ Name = "arm64"; Cmake = "ARM64" })) {
  $dir = Join-Path $work "cmake-$($arch.Name)"
  if ($Reuse -and (Test-Path "$dir\PIMETextService\Release\MixZhuyinTextService.dll")) { continue }
  Invoke-Checked "Configure text service ($($arch.Name))" { cmake -S $pime -B $dir -A $arch.Cmake }
  Invoke-Checked "Build text service ($($arch.Name))" { cmake --build $dir --config Release --target PIMETextService }
}

# 2. The launcher (32-bit, like PIME's, so it runs on every Windows).
$launcherExe = Join-Path $pime "PIMELauncher\target\i686-pc-windows-msvc\release\MixZhuyinLauncher.exe"
if (-not ($Reuse -and (Test-Path $launcherExe))) {
  Invoke-Checked "Add the Rust i686 target" { rustup target add i686-pc-windows-msvc }
  $env:RUSTFLAGS = "-Ctarget-feature=+crt-static"
  Push-Location (Join-Path $pime "PIMELauncher")
  try { Invoke-Checked "Build the launcher" { cargo build --release --locked } } finally { Pop-Location }
}

# 3. Node.js, checked against the published SHA-256.
$nodeZip = Join-Path $work "node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
  Write-Host "==> Download Node.js $NodeVersion"
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match " node-v$NodeVersion-win-x64\.zip$" }) -replace "\s.*$", ""
  $actual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $actual -ne $expected.Trim().ToLower()) {
    Remove-Item $nodeZip
    throw "Node.js download does not match SHASUMS256.txt"
  }
}
$nodeDir = Join-Path $work "node-v$NodeVersion-win-x64"
if (-not (Test-Path "$nodeDir\node.exe")) {
  Expand-Archive $nodeZip -DestinationPath $work -Force
}

# 4. The Node.js backend's own packages (nime).
Push-Location (Join-Path $pime "node")
try { Invoke-Checked "Install the backend's packages" { npm ci --omit=dev --no-audit --no-fund } } finally { Pop-Location }

# 5. Stage the files the installer ships.
Write-Host "==> Stage $payload"
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item -ItemType Directory -Force $payload, "$payload\x86", "$payload\x64", "$payload\arm64", "$payload\node", "$payload\licenses" | Out-Null
Copy-Item $launcherExe "$payload\MixZhuyinLauncher.exe"
Copy-Item (Join-Path $root "windows\backends.json") "$payload\backends.json"
Set-Content "$payload\version.txt" $version -NoNewline -Encoding ascii
Copy-Item "$work\cmake-x86\PIMETextService\Release\MixZhuyinTextService.dll" "$payload\x86\"
Copy-Item "$work\cmake-x64\PIMETextService\Release\MixZhuyinTextService.dll" "$payload\x64\"
Copy-Item "$work\cmake-arm64\PIMETextService\Release\MixZhuyinTextService.dll" "$payload\arm64\"
Copy-Item "$work\cmake-arm64\PIMETextService\Release\MixZhuyinTextService_arm64.dll" "$payload\arm64\"
Copy-Item "$work\cmake-x64\PIMETextService\Release\MixZhuyinTextService.dll" "$payload\arm64\MixZhuyinTextService_x64.dll"
Copy-Item "$nodeDir\node.exe" "$payload\node\"
foreach ($f in @("server.js", "loadServices.js", "package.json")) { Copy-Item (Join-Path $pime "node\$f") "$payload\node\" }
Copy-Item (Join-Path $pime "node\node_modules") "$payload\node\node_modules" -Recurse
$ime = "$payload\node\input_methods\MixZhuyin"
New-Item -ItemType Directory -Force $ime | Out-Null
# The input method, without development files (same rules as PIME's build).
Get-ChildItem (Join-Path $root "output\pime") -Recurse -File | Where-Object {
  $_.Name -notin @("server.js", "webpack_check.js", "README.md") -and
  $_.Name -notlike "run_*.bat" -and
  ($_.Extension -ne ".txt" -or $_.Name -like "*.LICENSE.txt") -and
  $_.Name -notlike "*.test.js"
} | ForEach-Object {
  $rel = $_.FullName.Substring((Join-Path $root "output\pime").Length + 1)
  $dest = Join-Path $ime $rel
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Copy-Item $_.FullName $dest
}
Copy-Item (Join-Path $pime "LGPL-2.0.txt") "$payload\licenses\LGPL-2.0.txt"
Copy-Item (Join-Path $pime "LICENSE.txt") "$payload\licenses\PIME-LICENSE.txt"
Copy-Item (Join-Path $pime "json\LICENSE.MIT") "$payload\licenses\nlohmann-json-LICENSE.txt"
Copy-Item "$nodeDir\LICENSE" "$payload\licenses\Node.js-LICENSE.txt"
Copy-Item (Join-Path $root "windows\license.txt") "$payload\licenses\MixZhuyin-LICENSE.txt"

# 6. The installer.
$makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (-not $makensis) { $makensis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe" }
$out = Join-Path $work "MixZhuyin-$version-setup.exe"
Invoke-Checked "Build the installer" {
  & $makensis /V3 /INPUTCHARSET UTF8 "/DVERSION=$version" "/DPAYLOAD=$payload" "/DOUTFILE=$out" (Join-Path $root "windows\MixZhuyin.nsi")
}
Get-Item $out | Format-Table Name, Length
