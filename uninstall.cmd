@echo off
rem Windows: double-click to remove the bot from your Cloudflare account and this computer (tools/uninstall.mjs).
setlocal
cd /d "%~dp0"
title AUT courses bot - uninstall
where node >nul 2>nul || (echo Node.js is not installed. & pause & exit /b 1)
if not exist "node_modules\wrangler\bin\wrangler.js" call npm install --no-audit --no-fund --loglevel=error
node tools\uninstall.mjs %*
pause
