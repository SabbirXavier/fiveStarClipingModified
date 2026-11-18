@echo off
setlocal
title Fivestar Stopper
cd /d "%~dp0"

echo ========================================================
echo   Stopping Fivestar
echo ========================================================

REM 1. Stop process listening on port 5177
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { Write-Host ('Stopping process on port 5177 PID ' + $c.OwningProcess); Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }"

REM 2. Stop window titled Fivestar Server
taskkill /fi "WINDOWTITLE eq Fivestar Server*" /f /t >nul 2>&1

REM 3. Stop any node process running server.mjs
powershell -NoProfile -ExecutionPolicy Bypass -Command "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist/server.mjs*' -or $_.CommandLine -like '*dist\server.mjs*' }; foreach ($p in $procs) { Write-Host ('Stopping server process PID ' + $p.ProcessId); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo ========================================================
echo   All Fivestar processes have been stopped.
echo ========================================================
echo.
ping 127.0.0.1 -n 2 >nul
exit /b 0
