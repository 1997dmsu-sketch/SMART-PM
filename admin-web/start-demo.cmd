@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or newer from https://nodejs.org/
  pause
  exit /b 1
)
set ADMIN_MODE=demo
set HOST=127.0.0.1
set PORT=4173
set ADMIN_ORIGIN=http://127.0.0.1:4173
set ADMIN_DATA_DIR=
echo Open http://127.0.0.1:4173 in your browser after the server starts.
node server.mjs
pause
