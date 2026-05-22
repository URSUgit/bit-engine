@echo off
echo ============================================
echo  BitPrivat Desktop - Local Build Script
echo ============================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Check pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo Installing pnpm...
    npm install -g pnpm
)

echo [1/4] Installing dependencies...
cd /d %~dp0..\..
pnpm install
if %errorlevel% neq 0 goto error

echo [2/4] Building Next.js web app...
cd apps\web
pnpm build
if %errorlevel% neq 0 goto error
cd ..\..

echo [3/4] Installing Electron dependencies...
cd apps\desktop
npm install
if %errorlevel% neq 0 goto error

echo [4/4] Building Windows installer (.exe)...
npm run build:win
if %errorlevel% neq 0 goto error

echo.
echo ============================================
echo  SUCCESS! Find your installer in:
echo  apps\desktop\dist\BitPrivat Setup *.exe
echo ============================================
start "" "dist"
pause
exit /b 0

:error
echo.
echo BUILD FAILED. Check the output above.
pause
exit /b 1
