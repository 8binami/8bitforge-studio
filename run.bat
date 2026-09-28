@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title 8BitForge Studio

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js is not installed or not on PATH.
    echo   Install Node.js 20 or later: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo   First run: installing dependencies...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   Installation failed.
        pause
        exit /b 1
    )
)

set "MODE=%~1"
if not "%MODE%"=="" goto run

:menu
echo.
echo   ========================================
echo     8BitForge Studio
echo   ========================================
echo.
echo     1  Web app          (browser, hot reload)
echo     2  Desktop app      (Electron + hot reload)
echo     3  Build            (dist\web)
echo     4  Build installers (release\)
echo     5  Tests
echo     6  Lint
echo     7  Desktop app, simulating an update (notice in the topbar)
echo     0  Quit
echo.
set /p "CHOICE=  Choice: "

if "%CHOICE%"=="1" set "MODE=web"
if "%CHOICE%"=="2" set "MODE=desktop"
if "%CHOICE%"=="3" set "MODE=build"
if "%CHOICE%"=="4" set "MODE=package"
if "%CHOICE%"=="5" set "MODE=test"
if "%CHOICE%"=="6" set "MODE=lint"
if "%CHOICE%"=="7" set "MODE=update"
if "%CHOICE%"=="0" exit /b 0

if "%MODE%"=="" (
    echo   Unknown choice.
    goto menu
)

:run
if /i "%MODE%"=="web" (
    echo.
    echo   Starting the dev server: http://localhost:5173
    echo   Press Ctrl+C to stop.
    echo.
    call npm run dev
    goto end
)
if /i "%MODE%"=="desktop" (
    echo.
    echo   Starting the desktop app...
    echo.
    call npm run dev:desktop
    goto end
)
if /i "%MODE%"=="update" (
    rem A made-up newer version: "next" is the one after package.json's.
    rem run.bat update 3.0.0 shows that one instead. Development only.
    set "VITE_SIMULATE_UPDATE=next"
    if not "%~2"=="" set "VITE_SIMULATE_UPDATE=%~2"
    echo.
    echo   Starting the desktop app, simulating version !VITE_SIMULATE_UPDATE!...
    echo.
    call npm run dev:desktop
    goto end
)
if /i "%MODE%"=="build" (
    call npm run build
    goto end
)
if /i "%MODE%"=="package" (
    call npm run build:desktop
    goto end
)
if /i "%MODE%"=="test" (
    call npm test
    goto end
)
if /i "%MODE%"=="lint" (
    call npm run lint
    goto end
)

echo.
echo   Usage: run.bat [web^|desktop^|update [version]^|build^|package^|test^|lint]
echo   No argument opens the menu.
echo.

:end
if "%~1"=="" pause
endlocal
