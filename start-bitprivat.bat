@echo off
title BitPrivat Launcher
color 0B

echo ============================================
echo   BitPrivat - AI Trading Platform
echo ============================================
echo.

:: Check Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python not found.
    echo Install Python 3.11+ from https://python.org
    echo Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo Install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

:: Check pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo Installing pnpm...
    npm install -g pnpm
)

echo [1/3] Installing Python signal service dependencies...
pip install fastapi uvicorn httpx pydantic --quiet
if %errorlevel% neq 0 (
    echo WARNING: Some Python packages failed to install. Continuing...
)

echo [2/3] Installing web app dependencies...
pnpm install --silent
if %errorlevel% neq 0 (
    echo ERROR: pnpm install failed.
    pause
    exit /b 1
)

echo [3/3] Starting services...
echo.
echo --------------------------------------------------
echo   Signal Service  -^>  http://localhost:8001
echo   Web UI          -^>  http://localhost:3000
echo --------------------------------------------------
echo.
echo Opening browser in 8 seconds...
echo Close this window to stop all services.
echo.

:: Start signal service in background
start "BitPrivat Signal Service" /min cmd /c "cd apps\signal-service && python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload 2>&1"

:: Start web app in background
start "BitPrivat Web UI" /min cmd /c "cd apps\web && pnpm dev 2>&1"

:: Wait for services to boot then open browser
timeout /t 8 /nobreak >nul
start "" "http://localhost:3000"

echo Services are running. Press any key to STOP everything.
pause >nul

:: Kill services
taskkill /f /fi "WINDOWTITLE eq BitPrivat Signal Service" >nul 2>nul
taskkill /f /fi "WINDOWTITLE eq BitPrivat Web UI" >nul 2>nul
taskkill /f /im uvicorn.exe >nul 2>nul
taskkill /f /im node.exe >nul 2>nul

echo.
echo All services stopped. Goodbye.
timeout /t 2 >nul
