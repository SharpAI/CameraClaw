# Aegis-AI ↔ CameraClaw ↔ OpenClaw — Integration Note

> **For Aegis attention** — what the platform needs to know about CameraClaw's OpenClaw integration.

## Architecture

```
Aegis-AI ←JSONL→ CameraClaw (Node.js) ←docker compose→ OpenClaw container
                                                           ↕
                                                   ~/.openclaw/instances/<id>/
```

## Key Facts

### 1. Docker Required

`skills.json` declares `docker: true`. The deployment agent's existing Docker rules (lines 157-171 in `skill-deployment-agent.cjs`) handle installation.

### 2. Config is File-Based

OpenClaw config = `~/.openclaw/openclaw.json` (JSON5). CameraClaw mounts this directory into the container as `/home/node/.openclaw`. It does NOT pass config via env vars.

### 3. OpenClaw Has Its Own Config UI

OpenClaw serves a Control UI on the same port as the gateway (`http://localhost:<port>/`). Users configure model, channels, API keys, sandbox, and tools there — CameraClaw does NOT duplicate this.

Tabs: Chat · Overview · Channels · Agents · Sessions · Config · Debug · Logs · Skills · Nodes · Cron

### 4. Token Bridge

CameraClaw generates `OPENCLAW_GATEWAY_TOKEN` per instance and reports it via JSONL:

```jsonl
{"event": "instance_started", "instance_id": "home", "gateway_url": "http://localhost:28001", "token": "abc123..."}
```

Aegis needs this token to auto-authenticate webview access to the Control UI.

### 5. Multi-Instance = Separate Docker Stacks

Each instance gets:
- Unique `OPENCLAW_GATEWAY_PORT` (28001, 28003, etc.)
- Isolated `OPENCLAW_CONFIG_DIR` (`~/.openclaw/instances/<id>/`)
- Own `OPENCLAW_GATEWAY_TOKEN`

### 6. Post-Install Onboarding

OpenClaw's `onboard` CLI is **interactive**. After first deploy:

```bash
docker compose run --rm openclaw-cli onboard --no-install-daemon
```

This needs to run through Aegis terminal for user interaction (gateway bind, auth, channel setup).

### 7. Node.js Runtime

CameraClaw requires Node.js ≥18 (not Python). Entry: `node scripts/monitor.js`.

### 8. Stdin Commands

Aegis controls CameraClaw via JSONL on stdin:

```jsonl
{"command": "create_instance", "instance_id": "work", "name": "Work Agent"}
{"command": "stop_instance", "instance_id": "work"}
{"command": "list_instances"}
```

## Aegis Implementation (Separate Scope)

- 4th sidebar icon → `'openclaw'` view
- Webview panel with browser-like tabs per instance (`<webview src="gateway_url?token=xxx"/>`)
- IPC bridge in `openclaw-handler.cjs`
- Token auto-inject for webview authentication
