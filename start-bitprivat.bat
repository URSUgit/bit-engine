@echo off
setlocal
title BitPrivat Launcher
color 0B

echo ============================================
echo   BitPrivat - AI Trading Platform
echo ============================================
echo.

:: Kill any leftover processes from previous runs
echo Stopping any previous instances...
taskkill /f /im python.exe >nul 2>nul
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im uvicorn.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Check Python
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python not found.
    echo Install Python 3.11+ from https://python.org
    echo Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found.
    echo Install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

:: Check pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
    echo Installing pnpm globally...
    call npm install -g pnpm
    if errorlevel 1 (
        echo ERROR: failed to install pnpm
        pause
        exit /b 1
    )
)

echo.
echo [1/4] Pulling latest code from GitHub...
git pull
if errorlevel 1 (
    echo WARNING: git pull failed. Running with current code.
)

echo.
echo [2/4] Installing Python signal service dependencies...
python -m pip install fastapi uvicorn httpx pydantic --quiet --disable-pip-version-check
if errorlevel 1 (
    echo WARNING: Some Python packages failed to install. Continuing anyway...
)

echo.
echo [3/4] Installing web app dependencies...
call pnpm install
if errorlevel 1 (
    echo ERROR: pnpm install failed.
    pause
    exit /b 1
)

echo.
echo [4/4] Starting services...
echo.
echo --------------------------------------------------
echo   Signal Service  --^>  http://localhost:8001
echo   Web UI          --^>  http://localhost:3000
echo   Backtester      --^>  http://localhost:3000/lab/backtester
echo --------------------------------------------------
echo.

:: Start signal service in its own window
start "BitPrivat Signal Service" cmd /k "cd /d %~dp0apps\signal-service && python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload"

:: Start web app in its own window
start "BitPrivat Web UI" cmd /k "cd /d %~dp0apps\web && pnpm dev"

:: Wait for services to boot then open browser directly on backtester
echo Waiting 18 seconds for services to boot...
timeout /t 18 /nobreak >nul

echo Opening browser...
start "" "http://localhost:3000/lab/backtester"

echo.
echo ============================================
echo  BitPrivat is RUNNING
echo ============================================
echo.
echo Leave the two service windows open while using the app.
echo.
echo Press any key here to STOP everything and close.
pause >nul

:: Kill services
echo Stopping services...
taskkill /f /im python.exe >nul 2>nul
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im uvicorn.exe >nul 2>nul

echo Done.
timeout /t 2 >nul
endlocal
