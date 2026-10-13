@echo off
rem Stanger panelen (inte spelservern).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8028 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Panelen ar stangd.
timeout /t 2 /nobreak >nul
