@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Opening the official download page.
  start "" "https://nodejs.org/en/download"
  echo Install Node.js, then double-click SETUP-WINDOWS.cmd again.
  pause
  exit /b 1
)
call npm run operator:install -- --local
echo.
echo Setup finished. Complete the Chrome Load unpacked step shown above.
pause
