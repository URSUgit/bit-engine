@echo off
setlocal
title Bit Engine
if /I "%~1"=="--research" (
  powershell.exe -NoProfile -File "%~dp0scripts\start-bitprivat.ps1" -Research
) else (
  powershell.exe -NoProfile -File "%~dp0scripts\start-bitprivat.ps1"
)
if errorlevel 1 (
  echo.
  echo Bit Engine did not start. See the message above.
  pause
  exit /b 1
)
