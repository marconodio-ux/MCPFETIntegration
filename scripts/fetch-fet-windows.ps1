# Download and extract the official FET Windows 64-bit package (includes fet-cl.exe).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/fetch-fet-windows.ps1
$ErrorActionPreference = "Stop"

$Version = "7.12.0"
$ExpectedSha256 = "E2D65CA80A37068C548B5AD8C0736ECB38F63C3BEA9FD04FE0AC4574AE59F566"
$Url = "https://lalescu.ro/liviu/fet/download/fet-$Version.exe"

$Root = Split-Path -Parent $PSScriptRoot
$Archives = Join-Path $Root "vendor\archives"
$BinRoot = Join-Path $Root "vendor\bin"
$ExePath = Join-Path $Archives "fet-$Version.exe"
$Extracted = Join-Path $BinRoot "fet-$Version"
$FetCl = Join-Path $Extracted "fet-cl.exe"

New-Item -ItemType Directory -Force -Path $Archives, $BinRoot | Out-Null

if (-not (Test-Path $ExePath)) {
  Write-Host "Downloading $Url ..."
  curl.exe -L --fail --retry 3 --retry-delay 2 -o $ExePath $Url
} else {
  Write-Host "Archive already present: $ExePath"
}

$hash = (Get-FileHash $ExePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($hash -ne $ExpectedSha256) {
  throw "SHA256 mismatch for $ExePath`nExpected: $ExpectedSha256`nActual:   $hash"
}
Write-Host "SHA256 OK: $hash"

$seven = @(
  "${env:ProgramFiles}\7-Zip\7z.exe",
  "${env:ProgramFiles(x86)}\7-Zip\7z.exe",
  "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $seven) {
  throw "7-Zip not found. Install 7-Zip or extract $ExePath manually into vendor\bin\"
}

if (Test-Path $Extracted) {
  Write-Host "Removing previous extract: $Extracted"
  Remove-Item -Recurse -Force $Extracted
}

Write-Host "Extracting with 7-Zip → $BinRoot"
& $seven x -y "-o$BinRoot" $ExePath | Out-Host

if (-not (Test-Path $FetCl)) {
  throw "Extraction succeeded but fet-cl.exe missing at $FetCl"
}

Write-Host ""
Write-Host "FET_CL_PATH=$FetCl"
& $FetCl --version
Write-Host "Done."
