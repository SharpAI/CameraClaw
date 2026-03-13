#!/usr/bin/env bash
set -euo pipefail

# CameraClaw Deploy Script
# Installs Node.js dependencies, verifies Docker, and prepares the OpenClaw image.

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
npm install --omit=dev 2>&1

echo "✅ Dependencies installed"

# ── Docker Detection ──────────────────────────────────────────────────────────

echo ""

if ! command -v docker &>/dev/null; then
    echo "❌ Docker: not installed"
    echo "   macOS: brew install --cask docker"
    echo "   Linux: sudo apt-get install docker.io"
    exit 1
fi

if ! docker info &>/dev/null 2>&1; then
    echo "❌ Docker: daemon not running"
    echo "   Start Docker Desktop or: sudo systemctl start docker"
    exit 1
fi
echo "✅ Docker: available and running"

if ! docker compose version &>/dev/null 2>&1; then
    echo "❌ Docker Compose: not available"
    exit 1
fi
echo "✅ Docker Compose: available"

# ── Prepare OpenClaw Config Directory ─────────────────────────────────────────

echo ""
OPENCLAW_DIR="${HOME}/.openclaw"
if [ ! -d "$OPENCLAW_DIR" ]; then
    echo "📁 Creating OpenClaw config directory: $OPENCLAW_DIR"
    mkdir -p "$OPENCLAW_DIR"
    mkdir -p "$OPENCLAW_DIR/workspace"
fi
echo "✅ Config dir: $OPENCLAW_DIR"

# ── Build/Pull OpenClaw Image ─────────────────────────────────────────────────

echo ""
echo "🐳 Preparing OpenClaw Docker image..."

# Check if image already exists
if docker image inspect openclaw:2026.3.12 &>/dev/null 2>&1; then
    echo "✅ OpenClaw image: openclaw:2026.3.12 (already built)"
else
    echo "   Image openclaw:local not found — building locally..."

    echo "   Building openclaw:local (npm install + desktop packages)..."
    # Build using the Dockerfile at the skill root
    # Build context is the skill root so COPY scripts/setup-desktop.sh works
    docker build -t openclaw:2026.3.12 "$SCRIPT_DIR"
    # Also tag as openclaw:local for backward compatibility
    docker tag openclaw:2026.3.12 openclaw:local

    if docker image inspect openclaw:2026.3.12 &>/dev/null 2>&1; then
        echo "✅ OpenClaw image: openclaw:2026.3.12 (built locally)"
    else
        echo "❌ Failed to build OpenClaw image"
        exit 1
    fi
fi

# ── Verify docker-compose.yml ──────────────────────────────────────────────────

echo ""
if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" config --quiet 2>/dev/null && \
        echo "✅ docker-compose.yml: valid" || \
        echo "⚠️  docker-compose.yml: validation warning (may still work)"
else
    echo "❌ docker-compose.yml: missing"
    exit 1
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────"
echo "✅ CameraClaw ready (Docker mode)"
echo "   Run: $NODE_BIN scripts/monitor.js"
echo ""
echo "Deploy complete."
