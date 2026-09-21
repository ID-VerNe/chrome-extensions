@echo off
REM install-autostart.bat - Register tab-bridge.exe to launch at Windows login.
REM Uses the bridge's built-in -autostart flag (writes HKCU Run key).

setlocal
cd /d "%~dp0"
if not exist "tab-bridge.exe" (
    echo tab-bridge.exe not found. Run build.ps1 first.
    pause
    exit /b 1
)
"tab-bridge.exe" -autostart
if errorlevel 1 (
    echo Failed to register autostart.
    pause
    exit /b 1
)
echo Autostart registered. tab-bridge will launch on next login.
endlocal
