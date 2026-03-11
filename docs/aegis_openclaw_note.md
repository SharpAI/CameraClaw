# CameraClaw → Aegis-AI Integration Protocol

> **For the Aegis-AI agent** — everything needed to implement CameraClaw support.

## Overview

CameraClaw is a skill (process managed by `skill-runtime-manager.cjs`) that orchestrates OpenClaw inside Docker with a virtual desktop. It communicates via **JSONL over stdin/stdout** — the standard skill protocol.

Aegis needs:
1. **IPC handlers** for CameraClaw-specific events
2. **noVNC integration** in two places (Monitor View + OpenClaw Panel)
3. **Snapshot storage** in the media directory

## Architecture

```
CameraClaw (Node.js)                    Aegis-AI
┌────────────────────────┐             ┌──────────────────────────────┐
│ Manages Docker stack:  │   stdout    │ skill-runtime-manager.cjs    │
│  - Xvfb + Chrome       │──(JSONL)──→│  → emit('skill-response')    │
│  - x11vnc + websockify │             │  → IPC to renderer           │
│  - OpenClaw gateway    │   stdin     │                               │
│                        │←─(JSONL)───│ Commands from frontend/agent  │
│ Takes snapshots        │             │                               │
│ Detects screen changes │             │ Frontend:                     │
│ Requests VLM analysis  │             │  - Monitor tile (noVNC RO)    │
│                        │             │  - OpenClaw Panel (noVNC RW)  │
└────────────────────────┘             └──────────────────────────────┘
```

## Events Aegis Must Handle

### From `skill-response` where `skillId === 'camera-claw'`:

| Event | Data | Frontend Action |
|-------|------|-----------------|
| `ready` | `mode, openclaw_version, monitoring` | Show CameraClaw as active in Console |
| `instance_started` | `instance_id, gateway_url, vnc_url, token, name` | Register VNC connection, enable Monitor tile, inject token into gateway webview sessionStorage |
| `instance_stopped` | `instance_id, reason` | Disconnect VNC, remove tile |
| `vnc_ready` | `instance_id, vnc_ws_url, view_only_url` | Connect noVNC to Monitor tile (view-only) and make OpenClaw Panel available |
| `snapshot` | `instance_id, path, ts, screen_diff_pct` | Update thumbnail in Monitor tile (if noVNC not connected) |
| `screen_change` | `instance_id, diff_pct, snapshot_path, ts` | Flash motion indicator on Monitor tile |
| `activity_summary` | `instance_id, status, vlm_summary, vlm_safety, ts` | Show summary in panel overlay or notification |
| `idle` | `instance_id, idle_since, idle_seconds` | Show idle badge on Monitor tile |
| `console` | `instance_id, stream, line, ts` | Append to Console tab output |
| `network` | `instance_id, remote_ip, domain, remote_port, ts` | Log in network panel (if built) |
| `alert` | `instance_id, type, detail, ts` | Show notification/badge |
| `health` | `instance_id, cpu_percent, memory_mb, uptime_seconds, ts` | Update health indicators |
| `error` | `message, retriable` | Show error in Console tab |

### Commands Aegis sends (via `skillRuntime.sendCommand('camera-claw', {...})`):

| Command | Parameters | When |
|---------|------------|------|
| `create_instance` | `instance_id, name` | User creates new OpenClaw instance |
| `stop_instance` | `instance_id` | User stops an instance |
| `list_instances` | (none) | On panel open |
| `stop` | (none) | Aegis shutdown |
| `pause_recording` | `instance_id` | User pauses recording |
| `resume_recording` | `instance_id` | User resumes recording |
| `take_snapshot` | `instance_id` | Manual snapshot request |
| `analyze_screen` | `instance_id` | Trigger immediate VLM analysis |

## Frontend: noVNC Integration

### Dependencies

```bash
npm install @novnc/novnc
# or load from CDN: https://cdn.jsdelivr.net/npm/@novnc/novnc/lib/rfb.js
```

### Monitor View (Camera Grid Tile)

```javascript
import RFB from '@novnc/novnc/lib/rfb.js';

// On instance_started / vnc_ready event:
const vnc = new RFB(tileElement, event.vnc_ws_url, {
  viewOnly: true,     // Read-only: no mouse/keyboard sent
  scaleViewport: true, // Scale to tile size
  background: '#1a1a2e',
});

// On instance_stopped:
vnc.disconnect();
```

### OpenClaw Panel (Sidebar Tab)

```javascript
// When user clicks tile or OpenClaw sidebar icon:
const vnc = new RFB(panelElement, event.vnc_ws_url, {
  viewOnly: false,    // Full interaction
  scaleViewport: true,
  resizeSession: true,
});

// User can click, type, onboard, configure
```

### Token Auto-Injection

When opening the OpenClaw Config UI (gateway_url), inject the token:

```javascript
// In webview preload or after load:
webview.executeJavaScript(`
  sessionStorage.setItem('gateway_token', '${token}');
`);
```

## Storage Layout

CameraClaw stores snapshots and timeline data:

```
~/.aegis-ai/media/camera-claw/
└── <instance_id>/
    └── YYYY-MM-DD/
        ├── snaps/            ← JPEG snapshots
        │   ├── 14-00-01.jpg
        │   └── 14-00-05.jpg
        └── timeline.jsonl    ← enriched metadata
```

Each timeline.jsonl line:
```jsonl
{"ts":"...", "snap":"snaps/14-00-01.jpg", "diff_pct":0, "agent_log":"...", "network":[...], "vlm":"...", "vlm_safety":"ok"}
```

## Docker Requirements

- Docker Desktop (macOS/Windows) or Docker Engine (Linux)
- Docker Compose v2+
- Ports: 18789 (gateway), 5900 (VNC), 6080 (noVNC/websockify) — per instance
- Image: `openclaw:local` (pulled by deploy.sh or built from source)

## Node.js Runtime

CameraClaw requires Node.js ≥18. The `runtime-resolver.cjs` will find it.
Entry script: `scripts/monitor.js`
