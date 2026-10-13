@echo off
rem Startar Gamla Skolans 7 Days to Die-panel (om den inte redan kor) och oppnar den i webblasaren.
cd /d "%~dp0"
set NODE=node
if exist "C:\Program Files\nodejs\node.exe" set NODE=C:\Program Files\nodejs\node.exe
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 8028 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -WindowStyle Hidden -FilePath '%NODE%' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' }"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8028
