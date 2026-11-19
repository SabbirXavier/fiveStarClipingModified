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

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not found on your PATH.
    echo Please ensure npm is installed and added to your PATH.
    pause
    exit /b 1
)

REM Check if first-time setup is needed
if not exist "node_modules\express" goto DO_SETUP
if not exist ".setup_done" goto DO_SETUP
goto CHECK_RUNNING

:DO_SETUP
echo.
echo ========================================================
echo   First-time setup detected. Setting up Fivestar...
echo   This will only take a couple of minutes on first run.
echo ========================================================
echo.
echo [1/2] Installing dependencies (npm ci --omit=dev)...
call npm ci --omit=dev
if errorlevel 1 (
    echo.
    echo [INFO] npm ci failed or package-lock mismatch. Trying npm install --omit=dev...
    call npm install --omit=dev
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install npm dependencies.
        echo Please check your internet connection and try running: npm install --omit=dev
        pause
        exit /b 1
    )
)

echo.
echo [2/2] Setting up tools, fonts and assets (npm run setup)...
call npm run setup
if errorlevel 1 (
    echo.
    echo [WARNING] Setup finished with warnings, but will attempt to start.
)

REM Mark setup as complete so this step is skipped on future runs
echo setup_completed > .setup_done
echo.
echo ========================================================
echo   Setup complete! Launching Fivestar...
echo ========================================================
echo.

:CHECK_RUNNING
REM Check if server is already running on port 5177
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 10 } else { exit 0 }"
if %ERRORLEVEL% equ 10 (
    echo Fivestar is already running.
    goto OPEN_BROWSER
)

echo Launching Fivestar server...
start "Fivestar Server" cmd /k "cd /d "%~dp0" && title Fivestar Server && node dist\start.mjs"

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
