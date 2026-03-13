@echo off
setlocal enabledelayedexpansion

REM CameraClaw Deploy Script (Windows)
REM Installs Node.js dependencies, verifies Docker, and prepares the OpenClaw image.

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
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    exit /b 1
)
echo [OK] Dependencies installed

REM ── Docker Detection ───────────────────

echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker not installed
    echo    Install Docker Desktop from https://docker.com
    exit /b 1
)

docker info >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Docker daemon not running
    echo    Start Docker Desktop
    exit /b 1
)
echo [OK] Docker: available and running

docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Compose not available
    exit /b 1
)
echo [OK] Docker Compose: available

REM ── Prepare OpenClaw Config Directory ──

echo.
set "OPENCLAW_DIR=%USERPROFILE%\.openclaw"
if not exist "!OPENCLAW_DIR!" (
    echo Creating OpenClaw config directory: !OPENCLAW_DIR!
    mkdir "!OPENCLAW_DIR!"
    mkdir "!OPENCLAW_DIR!\workspace"
)
echo [OK] Config dir: !OPENCLAW_DIR!

REM ── Pull OpenClaw Image ────────────────

echo.
echo Preparing OpenClaw Docker image...

docker image inspect openclaw:local >nul 2>&1
if !errorlevel! equ 0 (
    echo [OK] OpenClaw image: openclaw:local ^(already built^)
) else (
    echo    Image openclaw:local not found — building locally...

    REM Build using the Dockerfile at the skill root
    REM Build context is the skill root so COPY scripts/setup-desktop.sh works
    docker build -t openclaw:local "%~dp0."
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to build OpenClaw image
        exit /b 1
    )

    docker image inspect openclaw:local >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] OpenClaw image: openclaw:local ^(built locally^)
    ) else (
        echo [ERROR] Failed to build OpenClaw image
        exit /b 1
    )
)

REM ── Summary ─────────────────────────────

echo.
echo ========================================
echo [OK] CameraClaw ready ^(Docker mode^)
echo    Run: node scripts\monitor.js
echo.
echo Deploy complete.
endlocal
