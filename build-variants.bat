@echo off
setlocal

cd /d "%~dp0"

echo Building page variants from variants.json...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Please install Node.js first, then run this file again.
  echo.
  pause
  exit /b 1
)

node scripts\build-variants.mjs
if errorlevel 1 (
  echo.
  echo Build failed. Nothing was changed.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. Review the changes, then commit and push to publish.
echo.
pause
