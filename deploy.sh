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
if docker image inspect openclaw:local &>/dev/null 2>&1; then
    echo "✅ OpenClaw image: openclaw:local (already built)"
else
    echo "   Image openclaw:local not found — building from npm..."

    # Generate a Dockerfile that installs OpenClaw from npm + desktop packages
    TMPDIR_BUILD=$(mktemp -d)

    # Copy desktop setup script into build context
    cp "$SCRIPT_DIR/scripts/setup-desktop.sh" "$TMPDIR_BUILD/setup-desktop.sh"

    cat > "$TMPDIR_BUILD/Dockerfile" << 'DOCKERFILE'
FROM node:22-bookworm

# Install XFCE4 desktop environment + Chromium browser
RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    # Virtual display
    xvfb imagemagick wget \
    # XFCE4 desktop (Windows-like panel + window manager)
    xfce4 xfce4-terminal dbus-x11 at-spi2-core \
    # Chromium browser (for OpenClaw Control UI)
    chromium \
    # Fonts (so pages render properly)
    fonts-liberation fonts-noto-cjk fonts-dejavu-core \
    # Utilities
    xdg-utils procps && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install KasmVNC (integrated VNC server + web client)
# Supports both amd64 and arm64 architectures
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then \
      KASM_URL="https://github.com/kasmtech/KasmVNC/releases/download/v1.3.3/kasmvncserver_bookworm_1.3.3_arm64.deb"; \
    else \
      KASM_URL="https://github.com/kasmtech/KasmVNC/releases/download/v1.3.3/kasmvncserver_bookworm_1.3.3_amd64.deb"; \
    fi && \
    wget -qO /tmp/kasmvnc.deb "$KASM_URL" && \
    apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/kasmvnc.deb && \
    rm /tmp/kasmvnc.deb && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install OpenClaw from npm
RUN npm install -g openclaw@latest

# Pre-configure XFCE4 with Windows-like layout (panel, window controls, icons)
COPY setup-desktop.sh /tmp/setup-desktop.sh
RUN chmod +x /tmp/setup-desktop.sh && \
    /tmp/setup-desktop.sh /home/node && \
    rm /tmp/setup-desktop.sh

# Expose ports: gateway, bridge, KasmVNC
EXPOSE 18789 18790 6080

WORKDIR /home/node
ENV HOME=/home/node
ENV NODE_ENV=production
ENV DISPLAY=:99

CMD ["openclaw", "gateway", "--allow-unconfigured"]
DOCKERFILE

    echo "   Building openclaw:local (npm install + desktop packages)..."
    docker build -t openclaw:local "$TMPDIR_BUILD"
    rm -rf "$TMPDIR_BUILD"

    if docker image inspect openclaw:local &>/dev/null 2>&1; then
        echo "✅ OpenClaw image: openclaw:local (built from npm)"
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
