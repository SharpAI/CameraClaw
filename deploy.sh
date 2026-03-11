#!/usr/bin/env bash
set -euo pipefail

# CameraClaw Deploy Script
# Installs Node.js dependencies and verifies Docker availability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║        CameraClaw — Deploy                ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Node.js Detection ─────────────────────────────────────────────────────────

NODE_BIN=""
for candidate in node node18 node20 node22; do
    if command -v "$candidate" &>/dev/null; then
        version=$("$candidate" --version 2>/dev/null | sed 's/v//')
        major=$(echo "$version" | cut -d. -f1)
        if [ "$major" -ge 18 ] 2>/dev/null; then
            NODE_BIN="$candidate"
            echo "✅ Node.js: $candidate ($version)"
            break
        fi
    fi
done

if [ -z "$NODE_BIN" ]; then
    echo "❌ Node.js >= 18 not found"
    echo "   Install: https://nodejs.org/ or 'brew install node'"
    exit 1
fi

# ── npm Install ────────────────────────────────────────────────────────────────

echo ""
echo "📦 Installing dependencies..."
npm install --production 2>&1

echo "✅ Dependencies installed"

# ── Docker Detection (REQUIRED) ───────────────────────────────────────────────

echo ""
DOCKER_OK=false
COMPOSE_OK=false

if command -v docker &>/dev/null; then
    if docker info &>/dev/null 2>&1; then
        DOCKER_OK=true
        echo "✅ Docker: available and running"
    else
        echo "❌ Docker: installed but daemon not running"
        echo "   Start Docker Desktop or: sudo systemctl start docker"
        echo ""
        echo "CameraClaw requires Docker. Cannot proceed."
        exit 1
    fi
else
    echo "❌ Docker: not installed"
    echo "   macOS: brew install --cask docker"
    echo "   Linux: sudo apt-get install docker.io"
    echo ""
    echo "CameraClaw requires Docker. Cannot proceed."
    exit 1
fi

if docker compose version &>/dev/null 2>&1; then
    COMPOSE_OK=true
    echo "✅ Docker Compose: available"
else
    echo "❌ Docker Compose: not available"
    echo "   Docker Compose v2 is required (ships with Docker Desktop)."
    echo ""
    echo "CameraClaw requires Docker Compose. Cannot proceed."
    exit 1
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────"
echo "✅ CameraClaw ready (Docker mode)"
echo "   Run: $NODE_BIN scripts/monitor.js"

echo ""
echo "Deploy complete."
