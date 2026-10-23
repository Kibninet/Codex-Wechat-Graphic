$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $releaseRoot 'MANIFEST.sha256'
$failures = 0
$checked = 0
foreach ($line in Get-Content -LiteralPath $manifestPath -Encoding UTF8) {
    if (!$line) { continue }
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid checksum manifest.' }
    $expected = $Matches[1]
    $relative = $Matches[2]
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $relative))
    if (!$filePath.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Checksum manifest contains an invalid path.' }
    if (!(Test-Path -LiteralPath $filePath -PathType Leaf) -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        Write-Host ('Changed or missing: ' + $relative) -ForegroundColor Red
        $failures++
    }
    $checked++
}
Write-Host "Checked $checked files; failures: $failures"
if ($failures -ne 0) { exit 1 }
