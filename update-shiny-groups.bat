@echo off
setlocal

cd /d "%~dp0"

echo Updating shiny group data...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Please install Node.js first, then run this file again.
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found on this computer.
  echo Please install Git first, then run this file again.
  echo.
  pause
  exit /b 1
)

node scripts\read-shiny-tasks.mjs --write
if errorlevel 1 (
  echo.
  echo Failed to update shiny group data.
  echo.
  pause
  exit /b 1
)

git diff --quiet -- data\shiny-groups.json
if not errorlevel 1 (
  echo.
  echo No data changes found. Nothing to commit.
  echo.
  pause
  exit /b 0
)

git add data\shiny-groups.json

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set UPDATE_STAMP=%%i
git commit -m "Update shiny groups %UPDATE_STAMP%"
if errorlevel 1 (
  echo.
  echo Failed to commit data changes.
  echo.
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo.
  echo Failed to push data changes.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. Shiny group data has been updated and pushed.
echo.
pause
