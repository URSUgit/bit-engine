@echo off
setlocal
title BitPrivat Launcher
color 0B

echo ============================================
echo   BitPrivat - AI Trading Platform
echo ============================================
echo.

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

:: Check pnpm — must use CALL for .cmd shims
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
echo [1/3] Installing Python signal service dependencies...
python -m pip install fastapi uvicorn httpx pydantic --quiet --disable-pip-version-check
if errorlevel 1 (
    echo WARNING: Some Python packages failed to install. Continuing anyway...
)

echo.
echo [2/3] Installing web app dependencies (this can take 2-3 minutes the first time)...
call pnpm install
if errorlevel 1 (
    echo ERROR: pnpm install failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Starting services...
echo.
echo --------------------------------------------------
echo   Signal Service  --^>  http://localhost:8001
echo   Web UI          --^>  http://localhost:3000
echo --------------------------------------------------
echo.

:: Start signal service in its own window
start "BitPrivat Signal Service" cmd /k "cd /d %~dp0apps\signal-service && python -m uvicorn main:app --host 127.0.0.1 --port 8001"

:: Start web app in its own window
start "BitPrivat Web UI" cmd /k "cd /d %~dp0apps\web && pnpm dev"

:: Wait for services to boot then open browser
echo Waiting 15 seconds for services to boot...
timeout /t 15 /nobreak >nul

echo Opening browser...
start "" "http://localhost:3000"

echo.
echo ============================================
echo  BitPrivat is RUNNING
echo ============================================
echo.
echo Two service windows have opened (Signal Service, Web UI).
echo Leave them open while using the app.
echo.
echo Press any key here to STOP everything and close.
pause >nul

:: Kill services
echo Stopping services...
taskkill /f /fi "WINDOWTITLE eq BitPrivat Signal Service*" >nul 2>nul
taskkill /f /fi "WINDOWTITLE eq BitPrivat Web UI*" >nul 2>nul
taskkill /f /im uvicorn.exe >nul 2>nul

echo Done.
timeout /t 2 >nul
endlocal
