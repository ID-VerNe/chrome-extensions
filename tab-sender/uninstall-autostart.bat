@echo off
REM uninstall-autostart.bat - Remove the tab-bridge autostart entry.

setlocal
cd /d "%~dp0"
if not exist "tab-bridge.exe" (
    echo tab-bridge.exe not found.
    exit /b 1
)
"tab-bridge.exe" -remove-autostart
echo Autostart removed.
endlocal
