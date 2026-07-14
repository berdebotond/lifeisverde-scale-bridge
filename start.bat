@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)
echo.
echo Starting the scale bridge. Keep this window open while using the POS.
echo.
node bridge.js
pause
