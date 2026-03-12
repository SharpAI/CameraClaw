@echo off
setlocal

REM CameraClaw — Uninstall Script (Windows)
REM Called by Aegis when the skill is uninstalled.
REM Tears down all Docker resources created by this skill.

echo CameraClaw: Uninstalling...

REM Check Docker availability
where docker >nul 2>&1
if errorlevel 1 (
    echo   Docker not found, skipping container cleanup
    goto :cleanup_media
)

docker info >nul 2>&1
if errorlevel 1 (
    echo   Docker not running, skipping container cleanup
    goto :cleanup_media
)

REM Stop and remove all compose services
set "COMPOSE_FILE=%~dp0docker-compose.yml"
if exist "%COMPOSE_FILE%" (
    echo   Stopping Docker containers...
    docker compose -f "%COMPOSE_FILE%" down --remove-orphans --timeout 10 2>nul
)

REM Remove the openclaw:local image
docker image inspect openclaw:local >nul 2>&1
if not errorlevel 1 (
    echo   Removing openclaw:local image...
    docker rmi openclaw:local 2>nul
)

REM Clean up dangling networks
docker network prune -f >nul 2>&1

:cleanup_media
REM Clean up media files
set "MEDIA_DIR=%USERPROFILE%\.aegis-ai\media\camera-claw"
if exist "%MEDIA_DIR%" (
    echo   Removing media: %MEDIA_DIR%
    rmdir /s /q "%MEDIA_DIR%"
)

echo CameraClaw: Uninstall complete.
endlocal
