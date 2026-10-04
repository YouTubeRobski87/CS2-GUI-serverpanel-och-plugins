@echo off
chcp 65001 >nul
title Gamla Skolan Panel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Hittar inte Node.js. Installera det fran https://nodejs.org och forsok igen.
  pause
  exit /b 1
)

rem Kor panelen redan? Oppna den bara i webblasaren.
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8027 -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  start "" http://localhost:8027
  exit /b 0
)

set PORT=8027
set HOST=127.0.0.1
set ORIGIN=http://localhost:8027
echo ==================================================
echo   GAMLA SKOLAN - CS2 SERVERPANEL
echo   http://localhost:8027
echo   Stang det har fonstret for att stanga panelen.
echo   (CS2-servern fortsatter kora aven om panelen stangs.)
echo ==================================================
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8027"
node build
pause
