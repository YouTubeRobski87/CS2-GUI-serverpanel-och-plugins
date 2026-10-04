@echo off
chcp 65001 >nul
title Gamla Skolan Panel
cd /d "%~dp0"
rem Starts the panel in a console window (alternative to "Gamla Skolan Panel.vbs").
rem Startar panelen i ett konsolfonster (alternativ till "Gamla Skolan Panel.vbs").

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org ^(LTS^) and try again.
  echo Hittar inte Node.js. Installera det fran https://nodejs.org och forsok igen.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8027 -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  start "" http://localhost:8027
  exit /b 0
)

set PORT=8027
set HOST=127.0.0.1
set ORIGIN=http://localhost:8027
echo ==================================================
echo   GAMLA SKOLAN - CS2 SERVER PANEL
echo   http://localhost:8027
echo   Close this window to stop the panel.
echo   (The CS2 server keeps running if the panel closes.)
echo ==================================================
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8027"
node build
pause
