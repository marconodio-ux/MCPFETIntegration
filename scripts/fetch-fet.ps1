<#
.SYNOPSIS
  Download and extract the pinned FET release from the official Lalescu GitHub archive mirror.

.NOTES
  Official upstream (archives only): https://github.com/lalesculiviu/fet
  Homepage / authoritative source:  https://lalescu.ro/liviu/fet/
  Pinned version: FET-7.12.0 @ commit c4f67a7b9a430033133cab602d60d85e90ccbd86
#>
$ErrorActionPreference = "Stop"

$Version = "7.12.0"
$Commit = "c4f67a7b9a430033133cab602d60d85e90ccbd86"
$ArchiveName = "fet-$Version.tar.xz"
$RawUrl = "https://raw.githubusercontent.com/lalesculiviu/fet/main/$ArchiveName"
$AscUrl = "$RawUrl.asc"

$Root = Split-Path -Parent $PSScriptRoot
$Archives = Join-Path $Root "vendor\archives"
$SrcRoot = Join-Path $Root "vendor\fet-src"
$ArchivePath = Join-Path $Archives $ArchiveName
$AscPath = Join-Path $Archives "$ArchiveName.asc"
$Extracted = Join-Path $SrcRoot "fet-$Version"

New-Item -ItemType Directory -Force -Path $Archives, $SrcRoot | Out-Null

Write-Host "FET pin: $Version (upstream commit $Commit)"
Write-Host "Downloading $RawUrl"

if (-not (Test-Path $ArchivePath)) {
  curl.exe -L --fail -o $ArchivePath $RawUrl
} else {
  Write-Host "Archive already present: $ArchivePath"
}

try {
  curl.exe -L --fail -o $AscPath $AscUrl
} catch {
  Write-Warning "Could not download .asc signature (optional): $_"
}

if (Test-Path $Extracted) {
  Write-Host "Removing previous extract: $Extracted"
  Remove-Item -Recurse -Force $Extracted
}

Write-Host "Extracting..."
tar.exe -xf $ArchivePath -C $SrcRoot

if (-not (Test-Path $Extracted)) {
  throw "Expected extracted folder missing: $Extracted"
}

$meta = @{
  version = $Version
  upstreamUrl = "https://github.com/lalesculiviu/fet"
  upstreamCommit = $Commit
  archive = $ArchiveName
  extracted = "vendor/fet-src/fet-$Version"
  homepage = "https://lalescu.ro/liviu/fet/"
  fetchedAt = (Get-Date).ToString("o")
}
$meta | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Root "vendor\FET_PIN.json")

Write-Host "Done. Source at: $Extracted"
Write-Host "Next: build FET (CMake + Qt) so fet-cl exists, then set FET_CL_PATH if needed."
