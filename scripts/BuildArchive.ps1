param([Parameter(Mandatory=$true)][string]$ReleaseDir, [Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
function Get-LocalSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$ReleaseDir = [IO.Path]::GetFullPath($ReleaseDir)
$zipPath = $ReleaseDir + '.zip'
if (Test-Path -LiteralPath $zipPath) { throw 'Archive already exists; preserve the existing artifact.' }
$creating = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $ReleaseDir -File -Recurse -Force) {
        $relative = $file.FullName.Substring($ReleaseDir.TrimEnd('\').Length + 1).Replace('\','/')
        $entry = $creating.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
        $inputStream = [IO.File]::OpenRead($file.FullName)
        $outputStream = $entry.Open()
        try { $inputStream.CopyTo($outputStream) }
        finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
} finally { $creating.Dispose() }
$zipHash = Get-LocalSha256 $zipPath
[IO.File]::WriteAllText($zipPath + '.sha256', $zipHash + '  ' + [IO.Path]::GetFileName($zipPath) + "`n", [Text.UTF8Encoding]::new($false))
$expected = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $ReleaseDir 'MANIFEST.sha256'))) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid manifest entry.' }
    if ($expected.ContainsKey($Matches[2])) { throw 'Duplicate manifest entry.' }
    $expected[$Matches[2]] = $Matches[1]
}
$expected['MANIFEST.sha256'] = Get-LocalSha256 (Join-Path $ReleaseDir 'MANIFEST.sha256')
$seen = @{}
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$hasher = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        if (!$expected.ContainsKey($entry.FullName) -or $seen.ContainsKey($entry.FullName)) { throw ('Unexpected archive entry: ' + $entry.FullName) }
        $stream = $entry.Open()
        try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose() }
        if ($actual -ne $expected[$entry.FullName]) { throw ('Archive hash mismatch: ' + $entry.FullName) }
        $seen[$entry.FullName] = $true
    }
    if ($seen.Count -ne $expected.Count) { throw 'Archive is missing expected files.' }
} finally { $hasher.Dispose(); $archive.Dispose() }
$report = [ordered]@{ passed=$true; filesVerified=$seen.Count; bytes=(Get-Item -LiteralPath $zipPath).Length; sha256=$zipHash }
[IO.File]::WriteAllText($ReportPath, ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Compress
