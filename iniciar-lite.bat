@echo off
cd /d "%~dp0"
echo Iniciando Cambios AV Lite...
node --max-old-space-size=320 --expose-gc index.js
pause
