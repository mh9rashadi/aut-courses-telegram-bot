@echo off
rem Windows installer: double-click this file. It installs the project's packages (first time only)
rem and opens the step-by-step installer page in your browser (tools/installer/).
setlocal
cd /d "%~dp0"
title AUT courses bot - installer

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 20 ? 1 : 0)"
if errorlevel 1 goto oldnode

if exist "node_modules\wrangler\bin\wrangler.js" if exist "node_modules\jsqr\dist\jsQR.js" goto run
echo.
echo Installing packages (first time only, about 1 minute)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto npmfail

:run
node tools\installer\server.mjs
pause
exit /b 0

:nonode
echo.
echo Node.js is not installed. The download page opens now:
echo install the "LTS" version, then double-click install.cmd again.
start "" https://nodejs.org/en/download
pause
exit /b 1

:oldnode
echo.
echo Your Node.js is too old (version 20 or newer is needed). The download page opens now:
echo install the "LTS" version, then double-click install.cmd again.
start "" https://nodejs.org/en/download
pause
exit /b 1

:npmfail
echo.
echo Installing packages failed. Check your internet connection (or VPN) and double-click install.cmd again.
pause
exit /b 1
