@echo off
chcp 65001 >nul
title DANI OS Setup
if not exist "%~dp0DANI-Setup.ps1" (
  echo DANI-Setup.ps1 not found next to this file.
  echo Extract the whole zip first, then double-click DANI-Setup.bat again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DANI-Setup.ps1"
echo.
pause
