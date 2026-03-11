# Camera Claw 🎥🔒

> **A security camera for your AI agent.**

Security cameras watch people. Camera Claw watches AI agents.

You wouldn't let a stranger into your house without a security camera — why let an AI agent run on your machine without one?

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Aegis Skill](https://img.shields.io/badge/Aegis-Skill-violet.svg)](https://github.com/SharpAI/DeepCamera)

---

## What Camera Claw Does

Camera Claw provides three layers of protection:

| Layer | What | Why |
|-------|------|-----|
| 🏠 **The Room** | Docker container sandbox for OpenClaw | Isolate the agent from your system |
| 📹 **The Camera** | Records everything: console, network, skills, messages | See exactly what the agent does |
| 📼 **The DVR** | Playback, search, and alert rules | Review activity, catch suspicious behavior |

## Architecture

```
Aegis-AI ←JSONL→ CameraClaw (Node.js) ←docker compose→ OpenClaw container(s)
                                                           ↕
                                                   ~/.openclaw/instances/<id>/
```

- **Single port = UI + Gateway** — OpenClaw serves its Control UI on the same port as the gateway
- **Multi-instance** — Each instance is a separate Docker stack with its own port, config, and auth token
- **Token auth** — CameraClaw generates tokens and reports them to Aegis for webview authentication

## Quick Start

### As an Aegis Skill (Recommended)

Camera Claw is available in the **Aegis Skill Store** under `integrations`. One-click install.

### Standalone

```bash
git clone https://github.com/SharpAI/CameraClaw.git
cd CameraClaw
./deploy.sh        # macOS/Linux
# or
deploy.bat         # Windows
```

The deploy script automatically:
1. Finds Node.js ≥18
2. Runs `npm install`
3. Detects Docker and Docker Compose
4. Reports readiness

## Configuration

Edit `config.yaml` or use the Aegis skill config panel:

```yaml
params:
  sandbox_mode: auto          # auto | docker | native
  openclaw_version: latest
  recording_mode: continuous  # continuous | activity | manual
  clip_duration: 300          # seconds per clip
  network_monitoring: true
  alert_unknown_connections: true
  audit_level: full           # full | summary
  # OpenClaw gateway
  openclaw_config_dir: "~/.openclaw"
  openclaw_gateway_port: 18789
  openclaw_gateway_bind: loopback
```

**Model, channels, API keys, and tools** are configured via OpenClaw's own Config UI at `http://localhost:<port>/config`.

## What Gets Monitored

| Category | What's Captured | Alert Triggers |
|----------|----------------|---------------|
| **Console** | All stdout/stderr with timestamps | — |
| **Network** | Every outbound connection (IP, port, timing) | Unknown IPs |
| **Health** | HTTP health checks on each instance | Unreachable |
| **Audit** | Timestamped JSONL log of all events | Configurable rules |

## Protocol (JSONL over stdio)

### Camera Claw → Aegis
```jsonl
{"event": "ready", "mode": "docker", "monitoring": true}
{"event": "instance_started", "instance_id": "home", "gateway_url": "http://localhost:28001", "token": "abc..."}
{"event": "instance_stopped", "instance_id": "home"}
{"event": "health", "instance_id": "home", "status": "healthy"}
{"event": "alert", "instance_id": "home", "type": "unknown_connection", "detail": "..."}
```

### Aegis → Camera Claw
```jsonl
{"command": "create_instance", "instance_id": "work", "name": "Work Agent"}
{"command": "stop_instance", "instance_id": "work"}
{"command": "list_instances"}
```

## Project Structure

```
CameraClaw/
├── SKILL.md              # DeepCamera skill manifest
├── package.json          # Node.js dependencies
├── config.yaml           # Default parameters
├── deploy.sh             # macOS/Linux bootstrapper
├── deploy.bat            # Windows bootstrapper
├── docs/
│   └── aegis_openclaw_note.md  # Aegis integration requirements
└── scripts/
    ├── monitor.js        # Main entry — Docker orchestrator + JSONL
    └── health-check.js   # Container health checker
```

## Health Check

```bash
# Check all running OpenClaw instances
node scripts/health-check.js

# Check specific port
node scripts/health-check.js --port 18789
```

## Roadmap

- **Phase 1** ✅ Foundation — Sandbox, monitoring, audit logging
- **Phase 1b** ✅ Node.js + OpenClaw integration fixes
- **Phase 2** 🔜 Recording — Video-style activity playback, timeline UI
- **Phase 3** 🔜 Aegis integration — Sidebar icon, webview panel, IPC bridge

## License

MIT — see [LICENSE](LICENSE).

---

*Built by [SharpAI](https://github.com/SharpAI) — the team behind [Aegis-AI](https://aegis-ai.com) and [DeepCamera](https://github.com/SharpAI/DeepCamera).*
