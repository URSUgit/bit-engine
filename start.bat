@echo off
title BitPrivat
echo Starting BitPrivat...

:: Start the dev server in a new window
start "BitPrivat Dev Server" cmd /k "cd /d %~dp0 && pnpm dev"

:: Wait for the server to be ready, then open browser
timeout /t 6 /nobreak >nul
start "" "http://localhost:3000/dashboard"
