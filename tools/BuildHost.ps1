param([string]$Source = (Join-Path $PSScriptRoot 'BridgeHost.cs'), [string]$Output = (Join-Path $PSScriptRoot 'BridgeHost.exe'))
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path $Source -OutputAssembly $Output -OutputType WindowsApplication
