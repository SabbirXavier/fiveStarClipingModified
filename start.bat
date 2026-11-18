@echo off
setlocal
title Fivestar Starter
cd /d "%~dp0"

echo ========================================================
echo   Starting Fivestar
echo ========================================================

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found on your PATH.
    echo Please install Node.js 22.12 or newer.
    pause
    exit /b 1
)

REM Check if server is already running on port 5177
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 10 } else { exit 0 }"
if %ERRORLEVEL% equ 10 (
    echo Fivestar is already running.
    goto OPEN_BROWSER
)

echo Launching Fivestar server...
start "Fivestar Server" cmd /k "cd /d "%~dp0" && title Fivestar Server && node dist\server.mjs"

echo Waiting for server to become ready...
for /l %%i in (1,1,25) do (
    ping 127.0.0.1 -n 2 >nul
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 10 } else { exit 0 }"
    if errorlevel 10 goto OPEN_BROWSER
)

echo Warning: Server took longer than expected to bind to port 5177.

:OPEN_BROWSER
echo Opening Fivestar in your active browser...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$browsers = @('chrome', 'msedge', 'brave', 'firefox', 'opera'); $proc = Get-Process -ErrorAction SilentlyContinue | Where-Object { $browsers -contains $_.ProcessName } | Sort-Object StartTime -Descending | Select-Object -First 1; if ($proc) { Start-Process $proc.ProcessName 'http://localhost:5177' } else { Start-Process 'http://localhost:5177' }"

echo.
echo ========================================================
echo   Fivestar is running at: http://localhost:5177
echo   To stop Fivestar, double-click: stop.bat
echo ========================================================
echo.
ping 127.0.0.1 -n 3 >nul
exit /b 0
