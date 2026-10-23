@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Verify.ps1"
set "BRIDGE_EXIT=%ERRORLEVEL%"
pause
exit /b %BRIDGE_EXIT%
