@echo off
REM start-bridge.bat - Launch the tab-bridge daemon hidden in the background.
REM Runs from the same folder as this script.

setlocal
cd /d "%~dp0"
if not exist "tab-bridge.exe" (
    echo tab-bridge.exe not found. Run build.ps1 first.
    pause
    exit /b 1
)
start "" "tab-bridge.exe"
echo tab-bridge started.
endlocal
