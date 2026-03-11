@echo off
setlocal enabledelayedexpansion

REM CameraClaw Deploy Script (Windows)
REM Installs Node.js dependencies and verifies Docker availability.

echo ========================================
echo        CameraClaw — Deploy
echo ========================================
echo.

REM ── Node.js Detection ─────────────────

set "NODE_BIN="
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=1 delims=v" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
    REM Strip the 'v' prefix if present
    set "NODE_MAJOR=!NODE_MAJOR:v=!"
    if !NODE_MAJOR! GEQ 18 (
        set "NODE_BIN=node"
        echo [OK] Node.js: node ^(!NODE_VER!^)
    )
)

if "!NODE_BIN!"=="" (
    echo [ERROR] Node.js ^>= 18 not found
    echo    Install: https://nodejs.org/
    exit /b 1
)

REM ── npm Install ────────────────────────

echo.
echo Installing dependencies...
call npm install --production
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    exit /b 1
)
echo [OK] Dependencies installed

REM ── Docker Detection ───────────────────

echo.
set "DOCKER_OK=false"
set "COMPOSE_OK=false"

where docker >nul 2>&1
if %errorlevel% equ 0 (
    docker info >nul 2>&1
    if !errorlevel! equ 0 (
        set "DOCKER_OK=true"
        echo [OK] Docker: available and running
    ) else (
        echo [WARN] Docker: installed but daemon not running
        echo    Start Docker Desktop
    )
) else (
    echo [WARN] Docker: not installed
    echo    Install Docker Desktop from https://docker.com
)

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "COMPOSE_OK=true"
    echo [OK] Docker Compose: available
) else (
    echo [WARN] Docker Compose: not available
)

REM ── Summary ─────────────────────────────

echo.
echo ========================================
if "!DOCKER_OK!"=="true" if "!COMPOSE_OK!"=="true" (
    echo [OK] CameraClaw ready ^(Docker mode^)
    echo    Run: node scripts\monitor.js
) else (
    echo [WARN] CameraClaw ready ^(native mode - limited^)
    echo    Install Docker for full container isolation.
    echo    Run: node scripts\monitor.js
)
echo.
echo Deploy complete.
endlocal
