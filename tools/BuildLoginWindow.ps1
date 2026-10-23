param([string]$Source = (Join-Path $PSScriptRoot 'LoginWindow.cs'), [string]$Output = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Codex-Wechat.exe'))
$ErrorActionPreference = 'Stop'
Add-Type -Path $Source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $Output -OutputType WindowsApplication
