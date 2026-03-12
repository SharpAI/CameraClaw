# CameraClaw → Aegis-AI: JSONL Protocol Reference

> **For Aegis-AI frontend/backend engineers**  
> CameraClaw communicates via JSONL on **stdout**. Each line is one JSON object with an `event` field.

## Port Mapping Events

These events tell Aegis which local ports to connect to for each instance.

### `instance_started`

Emitted when an OpenClaw instance boots successfully. **This is the primary event for port mapping.**

```json
{
  "event": "instance_started",
  "instance_id": "default",
  "gateway_url": "http://localhost:18789",
  "kasmvnc_url": "http://localhost:6080",
  "name": "Default Agent",
  "token": "6b43577de39f4343baa388b26b868fbe9a38d4b7aa7012f5d95fdef666dd8382"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `gateway_url` | string | OpenClaw gateway HTTP URL — append `?token=<token>` for authenticated access |
| `kasmvnc_url` | string | **KasmVNC web client URL** — embed in iframe for desktop viewer |
| `token` | string | Gateway auth token — pass as `?token=` query param |
| `instance_id` | string | Unique instance identifier |
| `name` | string | Human-readable instance name |

**Aegis usage:**
```javascript
// When Aegis receives instance_started:
const gatewayWithAuth = `${event.gateway_url}?token=${event.token}`;
// → "http://localhost:18789?token=6b43..."

// Embed KasmVNC viewer (iframe):
const kasmUrl = event.kasmvnc_url;
// → "http://localhost:6080"
// View-only: `${kasmUrl}/?viewOnly=true`
// Interactive: kasmUrl (as-is)
```

---

### `vnc_ready`

Emitted ~3s after `instance_started`, once KasmVNC is confirmed running.

```json
{
  "event": "vnc_ready",
  "instance_id": "default",
  "kasmvnc_url": "http://localhost:6080",
  "view_only_url": "http://localhost:6080/?viewOnly=true"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `kasmvnc_url` | string | **KasmVNC web client URL** — embed in iframe for interactive desktop |
| `view_only_url` | string | KasmVNC URL with view-only mode (no mouse/keyboard input) |

> [!TIP]  
> Wait for `vnc_ready` before connecting a VNC viewer. The `instance_started` event fires before KasmVNC is fully initialized.

---

## Lifecycle Events

### `ready`

Emitted once on startup when Docker is confirmed available.

```json
{
  "event": "ready",
  "mode": "docker",
  "openclaw_version": "local",
  "monitoring": true,
  "snapshot_fps": 0,
  "vlm_analysis": "off"
}
```

### `instance_stopped`

```json
{
  "event": "instance_stopped",
  "instance_id": "default",
  "reason": "user_request"
}
```

### `error`

```json
{
  "event": "error",
  "message": "Failed to start instance: port 18789 in use",
  "retriable": true
}
```

---

## Port Allocation Rules

All ports are **dynamically allocated** to avoid conflicts:

| Port | Base | Purpose | Probed from |
|------|------|---------|-------------|
| Gateway | 18789 | OpenClaw HTTP API | 18789+ |
| Bridge | gateway+1 | Internal bridge | auto |
| KasmVNC | 6080 | Integrated VNC server + web client | 6080+ |

- Ports are probed by attempting `net.createServer().listen(port)` — if taken, increment and retry
- Multiple instances get unique ports (tracked in `usedPorts()`)

---

## Commands (stdin → skill)

Aegis sends JSON commands to CameraClaw via **stdin**:

```json
{"command": "create_instance", "instance_id": "agent-2", "name": "Research Agent"}
{"command": "stop_instance", "instance_id": "agent-2"}
{"command": "list_instances"}
{"command": "take_snapshot", "instance_id": "default"}
```

---

## Aegis Integration Checklist

- [ ] Parse JSONL on skill stdout for `event` field
- [ ] On `instance_started` → store `gateway_url`, `kasmvnc_url`, `token` per instance
- [ ] On `vnc_ready` → enable KasmVNC iframe (use `kasmvnc_url`, `view_only_url`)
- [ ] On `instance_stopped` → remove instance from UI
- [ ] On `error` with `retriable: true` → show retry button
- [ ] Send `create_instance` / `stop_instance` via stdin JSON
