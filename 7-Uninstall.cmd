@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Manage.ps1" -Action Uninstall
set "BRIDGE_EXIT=%ERRORLEVEL%"
pause
exit /b %BRIDGE_EXIT%
