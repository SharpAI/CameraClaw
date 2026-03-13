---
name: camera-claw
description: "Security camera for your AI agent — sandbox, record, and monitor OpenClaw"
version: 2.0.0
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

  - name: snapshot_fps
    label: "Snapshot FPS"
    type: select
    options: [0.2, 0.5, 1, 2]
    default: 0.5
    description: "Periodic VNC snapshot rate. Lower = less CPU. Desktop changes slowly."
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

  - name: screen_change_threshold
    label: "Screen Change Threshold (%)"
    type: number
    min: 5
    max: 80
    default: 20
    description: "Minimum % pixel change to trigger a screen_change event. Lower = more sensitive."
    group: Monitoring

  - name: vlm_analysis
    label: "VLM Analysis"
    type: select
    options: ["off", "on_change", "periodic"]
    default: "off"
    description: "off = no VLM, on_change = on significant screen change, periodic = every N snapshots"
    group: Monitoring

  - name: vlm_interval
    label: "VLM Analysis Interval"
    type: number
    min: 5
    max: 300
    default: 60
    description: "Seconds between periodic VLM analyses (when vlm_analysis = periodic)"
    group: Monitoring

  # ── OpenClaw Gateway ───────────────────────────────────────────────────────
  - name: openclaw_config_dir
    label: "Config Directory"
    type: string
    default: "~/.openclaw"
    description: "Path to OpenClaw config dir. Mounted into container."
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

  # ── API Keys ────────────────────────────────────────────────────────────────
  - name: api_key_source
    label: "API Key Source"
    type: select
    options: ["auto", "manual", "custom"]
    default: "auto"
    description: "auto = forward Aegis keys automatically, manual = configure inside OpenClaw, custom = use keys below"
    group: "API Keys"

  - name: openai_api_key
    label: "OpenAI API Key"
    type: string
    default: ""
    description: "OpenAI API key (only used when source = custom)"
    group: "API Keys"
    secret: true

  - name: anthropic_api_key
    label: "Anthropic API Key"
    type: string
    default: ""
    description: "Anthropic API key (only used when source = custom)"
    group: "API Keys"
    secret: true

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

1. **The Room** — A Docker sandbox with a virtual desktop (Xvfb + Chrome) for OpenClaw
2. **The Camera** — KasmVNC live view + periodic snapshots with metadata
3. **The DVR** — Snapshot timeline with agent logs, network events, and optional VLM analysis

## Docker Architecture

Each OpenClaw instance runs in an isolated Docker stack with a virtual desktop:

| Service | Image | Purpose |
|---------|-------|---------|
| `openclaw-gateway` | `openclaw:local` | AI agent gateway + Control UI (port 18789) |
| `openclaw-cli` | Same image | CLI for onboarding, channel setup |

Inside the container: **Xvfb** (virtual display :99) + **Chrome** + **KasmVNC** (integrated VNC server + web client on :6080).

### Multi-Instance Support

Each instance = separate docker-compose stack with unique ports and config.

---

## Protocol

Communicates via **JSON lines** over stdin/stdout.

All events emitted by CameraClaw on stdout reach the Aegis frontend via `skill-response` in `skill-runtime-manager.cjs`. The frontend filters by `skillId === 'camera-claw'` and dispatches to the appropriate handler.

CameraClaw can request Aegis services (LLM, VLM, system info) via the **inline query** protocol — no direct HTTP connection needed.

### CameraClaw → Aegis (stdout events)

#### Lifecycle Events

```jsonl
{"event":"ready", "mode":"docker", "openclaw_version":"latest", "monitoring":true}
{"event":"instance_started", "instance_id":"default", "gateway_url":"http://localhost:18789", "kasmvnc_url":"http://localhost:6080", "token":"abc123...", "name":"Default Agent"}
{"event":"instance_stopped", "instance_id":"default", "reason":"user_request"}
{"event":"error", "message":"Docker daemon not running", "retriable":false}
```

#### Desktop Monitoring Events

```jsonl
{"event":"vnc_ready", "instance_id":"default", "kasmvnc_url":"http://localhost:6080", "view_only_url":"http://localhost:6080/?viewOnly=true"}
{"event":"snapshot", "instance_id":"default", "path":"/abs/path/snap_001.jpg", "ts":"2026-03-11T14:00:05Z", "screen_diff_pct":42.3}
{"event":"screen_change", "instance_id":"default", "diff_pct":42.3, "snapshot_path":"/abs/path/snap_002.jpg", "ts":"2026-03-11T14:00:07Z"}
{"event":"activity_summary", "instance_id":"default", "status":"active", "ts":"2026-03-11T14:00:10Z", "vlm_summary":"Agent is composing a tweet about AI developments", "vlm_safety":"ok"}
{"event":"idle", "instance_id":"default", "idle_since":"2026-03-11T14:10:00Z", "idle_seconds":120}
```

#### Network & Console Events

```jsonl
{"event":"console", "instance_id":"default", "stream":"stdout", "line":"Agent started task: browse twitter", "ts":"..."}
{"event":"network", "instance_id":"default", "remote_ip":"104.244.42.1", "domain":"twitter.com", "remote_port":443, "direction":"outbound", "ts":"..."}
{"event":"alert", "instance_id":"default", "type":"unknown_connection", "detail":"Connection to 185.43.210.1:8080", "ts":"..."}
{"event":"health", "instance_id":"default", "cpu_percent":12.3, "memory_mb":256, "uptime_seconds":3600, "ts":"..."}
```

#### Inline Queries (request Aegis services)

CameraClaw can request VLM analysis from Aegis without direct HTTP:

```jsonl
{"query":"vlm_chat", "id":1, "messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}},{"type":"text","text":"Describe what the AI agent is doing on screen. Note any concerns."}]}], "max_tokens":256}
```

Aegis responds on stdin:
```jsonl
{"response":1, "ok":true, "content":"Agent is browsing twitter.com/home, scrolling through the feed. No concerns.", "model":"gemma-3-4b", "usage":{"prompt_tokens":800,"completion_tokens":45}}
```

### Aegis → CameraClaw (stdin commands)

#### Instance Management

```jsonl
{"command":"create_instance", "instance_id":"work", "name":"Work Agent"}
{"command":"stop_instance", "instance_id":"work"}
{"command":"list_instances"}
{"command":"stop"}
```

#### Recording Control

```jsonl
{"command":"pause_recording", "instance_id":"default"}
{"command":"resume_recording", "instance_id":"default"}
{"command":"take_snapshot", "instance_id":"default"}
```

#### Desktop Interaction

```jsonl
{"command":"analyze_screen", "instance_id":"default"}
```

> Triggers an immediate VLM analysis of the current screen. CameraClaw captures a snapshot, sends a `vlm_chat` query to Aegis, and emits an `activity_summary` event with the result.

#### Non-command messages

Messages without a `command` field (e.g. detection frame events from other skills) are **silently ignored**.

---

## Aegis Frontend Integration

### Monitor View (Camera Grid)

The OpenClaw desktop appears as a camera tile using **KasmVNC in view-only mode**:

```javascript
// Frontend: embed KasmVNC iframe with viewOnly=true for monitor tile
const iframe = document.createElement('iframe');
iframe.src = viewOnlyUrl;  // http://localhost:6080/?viewOnly=true
iframe.style.cssText = 'width:100%;height:100%;border:none';
tileElement.appendChild(iframe);
```

- Live desktop stream, scaled to thumbnail
- Click tile → opens OpenClaw Panel (switches to interactive)
- Motion indicator when `screen_change` events arrive

### OpenClaw Panel (Sidebar)

Full interactive KasmVNC session:

```javascript
// Frontend: embed KasmVNC iframe with full interaction for panel
const iframe = document.createElement('iframe');
iframe.src = kasmvncUrl;  // http://localhost:6080 (interactive)
iframe.style.cssText = 'width:100%;height:100%;border:none';
iframe.allow = 'clipboard-read; clipboard-write';
panelElement.appendChild(iframe);
```

- Full mouse/keyboard control
- Clipboard sharing enabled
- Used for onboarding, configuration, manual intervention

### Recording Pipeline

CameraClaw handles recording internally:

1. **Periodic snapshots** at `snapshot_fps` rate (default 0.5 fps)
2. **Screen diff** between consecutive snapshots
3. If diff > `screen_change_threshold` → emit `screen_change` event
4. **Metadata enrichment**: each snapshot paired with agent logs + network events
5. **VLM analysis** (if enabled): triggered on significant changes or periodically
6. **Storage**: snapshots + JSONL metadata in `~/.aegis-ai/media/camera-claw/<instance_id>/`

### Snapshot Timeline Format

```
~/.aegis-ai/media/camera-claw/default/
├── 2026-03-11/
│   ├── snaps/
│   │   ├── 14-00-01.jpg
│   │   ├── 14-00-03.jpg
│   │   └── 14-00-05.jpg
│   └── timeline.jsonl      ← enriched metadata per snapshot
```

Each line in `timeline.jsonl`:
```jsonl
{"ts":"2026-03-11T14:00:01Z", "snap":"snaps/14-00-01.jpg", "diff_pct":0, "agent_log":"Browsing feed", "network":[{"domain":"twitter.com","bytes":45200}]}
{"ts":"2026-03-11T14:00:05Z", "snap":"snaps/14-00-05.jpg", "diff_pct":42.3, "agent_log":"Composing tweet", "vlm":"Agent composing tweet about AI", "vlm_safety":"ok"}
```

---

## Installation

```bash
./deploy.sh    # Node.js deps + Docker image build (with KasmVNC) + config dir setup
```

1. Checks for Node.js ≥18
2. Runs `npm install`
3. Verifies Docker and Docker Compose
4. Creates `~/.openclaw/` config directory
5. Builds OpenClaw Docker image (with KasmVNC + desktop packages)
6. Validates `docker-compose.yml`
