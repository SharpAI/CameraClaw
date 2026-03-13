FROM node:22-bookworm

# Install XFCE4 desktop environment + Chromium browser
RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    # KasmVNC provides its own Xvnc — no Xvfb needed
    imagemagick wget \
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
RUN npm install -g openclaw@2026.3.12

# Pre-configure XFCE4 with Windows-like layout
COPY scripts/setup-desktop.sh /tmp/setup-desktop.sh
RUN sed -i 's/\r$//' /tmp/setup-desktop.sh && \
    chmod +x /tmp/setup-desktop.sh && \
    /tmp/setup-desktop.sh /home/node && \
    rm /tmp/setup-desktop.sh

# Expose ports: gateway, bridge, KasmVNC
EXPOSE 18789 18790 6080

WORKDIR /home/node
ENV HOME=/home/node
ENV NODE_ENV=production
ENV DISPLAY=:99

CMD ["openclaw", "gateway", "--allow-unconfigured"]
