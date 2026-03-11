---
name: camera-claw
description: "Security camera for your AI agent — sandbox, record, and monitor OpenClaw"
version: 1.1.0
icon: assets/camera-claw-icon.png
entry: scripts/monitor.js
deploy: deploy.sh

requirements:
  docker: true
  platforms: ["linux", "macos", "windows"]

parameters:
  # ── Lifecycle ──────────────────────────────────────────────────────────────
  - name: auto_start
    label: "Auto Start"
    type: boolean
    default: true
    description: "Start CameraClaw automatically when Aegis launches"
    group: Lifecycle

  # ── Sandbox ────────────────────────────────────────────────────────────────

  - name: openclaw_version
    label: "OpenClaw Version"
    type: string
    default: "latest"
    description: "Docker image tag or git ref for OpenClaw"
    group: Sandbox

  # ── Recording ──────────────────────────────────────────────────────────────
  - name: recording_mode
    label: "Recording Mode"
    type: select
    options: ["continuous", "activity", "manual"]
    default: "continuous"
    description: "continuous = always record, activity = record on events, manual = user-triggered"
    group: Recording

  - name: clip_duration
    label: "Clip Duration (seconds)"
    type: number
    min: 30
    max: 600
    default: 300
    description: "Length of each recording clip. Clips stored in Aegis media directory."
    group: Recording

  # ── Monitoring ─────────────────────────────────────────────────────────────
  - name: network_monitoring
    label: "Network Monitoring"
    type: boolean
    default: true
    description: "Log all outbound network connections from OpenClaw"
    group: Monitoring

  - name: alert_unknown_connections
    label: "Alert: Unknown Connections"
    type: boolean
    default: true
    description: "Flag connections to unrecognized IP addresses"
    group: Monitoring

  - name: audit_level
    label: "Audit Detail Level"
    type: select
    options: ["full", "summary"]
    default: "full"
    description: "full = log every event, summary = aggregate counts only"
    group: Monitoring

  # ── OpenClaw Gateway (real env vars from docker-compose.yml) ───────────────
  - name: openclaw_config_dir
    label: "Config Directory"
    type: string
    default: "~/.openclaw"
    description: "Path to OpenClaw config dir. Mounted into container as /home/node/.openclaw. Contains openclaw.json, .env, credentials."
    group: OpenClaw

  - name: openclaw_gateway_token
    label: "Gateway Token"
    type: string
    default: ""
    description: "Auth token for OpenClaw Control UI. Auto-generated if empty."
    group: OpenClaw
    secret: true

  - name: openclaw_gateway_port
    label: "Gateway Port"
    type: number
    min: 1024
    max: 65535
    default: 18789
    description: "Host port for first OpenClaw instance. Additional instances auto-increment."
    group: OpenClaw

  - name: openclaw_gateway_bind
    label: "Gateway Bind"
    type: select
    options: ["loopback", "lan"]
    default: "loopback"
    description: "loopback = localhost only, lan = accessible on LAN"
    group: OpenClaw

capabilities:
  live_detection:
    script: scripts/monitor.js
    description: "Real-time monitoring and audit of OpenClaw agent activity"
---

# Camera Claw

> **A security camera for your AI agent.**

Security cameras watch people. Camera Claw watches AI agents. You wouldn't let a stranger into your house without a security camera — why let an AI agent run on your machine without one?

## What It Does

Camera Claw provides three layers:

1. **The Room** — A clean sandbox (Docker container) to run OpenClaw
2. **The Camera** — Records everything OpenClaw does: console, network, skills, channel messages
3. **The DVR** — Playback, search, and alert rules for reviewing agent activity

> **Note:** Recordings are stored in the standard Aegis media directory (`~/.aegis-ai/media/`). Retention and cleanup are handled by Aegis's built-in storage manager — no separate retention config needed.

## Docker Architecture

CameraClaw manages OpenClaw via `docker-compose.yml`. Each instance is an isolated stack:

| Service | Image | Purpose |
|---------|-------|---------|
| `openclaw-gateway` | `openclaw:local` | AI agent gateway + Control UI (port 18789) |
| `openclaw-cli` | Same image | CLI for onboarding, channel setup, management |

**Single port = UI + Gateway** — OpenClaw serves its Control UI on the same port as the gateway. The webview URL IS the gateway URL (`http://localhost:<port>/`).

### Multi-Instance Support

Each instance = separate docker-compose stack with unique env:
- `OPENCLAW_GATEWAY_PORT` — unique host port per instance
- `OPENCLAW_CONFIG_DIR` — isolated config at `~/.openclaw/instances/<id>/`
- `OPENCLAW_GATEWAY_TOKEN` — unique auth token per instance

## OpenClaw Configuration

**OpenClaw has its own Config UI** — users configure model, channels, API keys, sandbox, and tools via the Control UI at `http://localhost:<port>/config` or by editing `~/.openclaw/openclaw.json` directly. CameraClaw does NOT duplicate this.

CameraClaw controls only the Docker orchestration layer:

| CameraClaw Parameter | OpenClaw Env Var | Purpose |
|---------------------|------------------|---------|
| `openclaw_config_dir` | volume mount → `/home/node/.openclaw` | Config directory |
| `openclaw_gateway_token` | `OPENCLAW_GATEWAY_TOKEN` | Auth for Control UI |
| `openclaw_gateway_port` | `OPENCLAW_GATEWAY_PORT` | Host port mapping |
| `openclaw_gateway_bind` | `OPENCLAW_GATEWAY_BIND` | Network bind mode |

## Protocol

Communicates via **JSON lines** over stdin/stdout.

### Camera Claw → Aegis (stdout)
```jsonl
{"event": "ready", "mode": "docker", "openclaw_version": "latest", "monitoring": true}
{"event": "instance_started", "instance_id": "home", "gateway_url": "http://localhost:28001", "name": "Home Agent", "token": "abc123..."}
{"event": "instance_stopped", "instance_id": "home"}
{"event": "console", "timestamp": "...", "instance_id": "home", "stream": "stdout", "line": "Agent started"}
{"event": "network", "timestamp": "...", "instance_id": "home", "remote_ip": "142.250.80.46", "remote_port": 443, "direction": "outbound"}
{"event": "alert", "timestamp": "...", "instance_id": "home", "type": "unknown_connection", "detail": "Connection to 185.43.210.1:8080"}
{"event": "health", "timestamp": "...", "instance_id": "home", "cpu_percent": 12.3, "memory_mb": 256, "uptime_seconds": 3600}
{"event": "error", "message": "...", "retriable": true}
```

### Aegis → Camera Claw (stdin)
```jsonl
{"command": "create_instance", "instance_id": "work", "name": "Work Agent"}
{"command": "stop_instance", "instance_id": "work"}
{"command": "list_instances"}
{"command": "stop"}
{"command": "pause_recording"}
{"command": "resume_recording"}
```

## Installation

The `deploy.sh` / `deploy.bat` bootstrapper handles everything:

```bash
./deploy.sh
```

1. Checks for Node.js ≥18
2. Runs `npm install`
3. Detects Docker and Docker Compose
4. Pulls OpenClaw Docker image (if Docker is available)

## Configuration

All parameters can be set via the Aegis skill config panel or `config.yaml`:

```yaml
params:
  sandbox_mode: auto
  recording_mode: continuous
  clip_duration: 300
  network_monitoring: true
  alert_unknown_connections: true
  audit_level: full
  # OpenClaw gateway
  openclaw_config_dir: "~/.openclaw"
  openclaw_gateway_port: 18789
  openclaw_gateway_bind: loopback
```
