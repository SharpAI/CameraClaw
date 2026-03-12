#!/usr/bin/env bash
set -euo pipefail

# CameraClaw — Uninstall Script
# Called by Aegis when the skill is uninstalled.
# Tears down all Docker resources created by this skill.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "CameraClaw: Uninstalling..."

# Stop and remove all compose services
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
    if [ -f "$COMPOSE_FILE" ]; then
        echo "  Stopping Docker containers..."
        docker compose -f "$COMPOSE_FILE" down --remove-orphans --timeout 10 2>/dev/null || true
    fi

    # Remove the openclaw:local image (it's large, ~4GB)
    if docker image inspect openclaw:local &>/dev/null 2>&1; then
        echo "  Removing openclaw:local image..."
        docker rmi openclaw:local 2>/dev/null || true
    fi

    # Clean up any dangling networks
    docker network prune -f 2>/dev/null || true
fi

# Clean up media files
MEDIA_DIR="${HOME}/.aegis-ai/media/camera-claw"
if [ -d "$MEDIA_DIR" ]; then
    echo "  Removing media: $MEDIA_DIR"
    rm -rf "$MEDIA_DIR"
fi

echo "CameraClaw: Uninstall complete."
