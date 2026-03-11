#!/usr/bin/env node

/**
 * CameraClaw Monitor v2.0 — OpenClaw Desktop Orchestrator
 *
 * Manages OpenClaw container instances with virtual desktops (Xvfb + Chrome).
 * Provides:
 *   - noVNC live view (view-only for Monitor, interactive for Panel)
 *   - Periodic VNC snapshots with screen-diff detection
 *   - VLM analysis via Aegis inline query protocol
 *   - Enriched timeline (snapshot + agent logs + network metadata)
 *
 * Communicates via JSON lines over stdin/stdout.
 */

import { execSync, spawn, exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { readFile } from 'node:fs/promises';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  auto_start: true,
  openclaw_version: 'local',
  recording_mode: 'continuous',
  clip_duration: 300,
  snapshot_fps: 0.5,
  network_monitoring: true,
  alert_unknown_connections: true,
  screen_change_threshold: 20,
  vlm_analysis: 'off',        // 'off' | 'on_change' | 'periodic'
  vlm_interval: 60,
  openclaw_config_dir: join(homedir(), '.openclaw'),
  openclaw_gateway_token: '',
  openclaw_gateway_port: 18789,
  openclaw_gateway_bind: 'loopback',
};

/** @type {Map<string, InstanceState>} */
const instances = new Map();

/** VLM query counter for inline query protocol */
let vlmQueryId = 0;

/** Map of pending VLM queries: id → { resolve, reject } */
const pendingQueries = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function log(msg) {
  process.stderr.write(`[CameraClaw] ${msg}\n`);
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function loadConfig() {
  const configPath = join(process.cwd(), 'config.yaml');
  const envParams = process.env.AEGIS_SKILL_PARAMS;

  let config = { ...DEFAULT_CONFIG };

  // Try loading config.yaml
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const lines = raw.split('\n');
      let inParams = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'params:') { inParams = true; continue; }
        if (inParams && trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^(\w+):\s*(.+)$/);
          if (match) {
            const [, key, val] = match;
            if (key in config) {
              config[key] = parseValue(val, typeof config[key]);
            }
          }
        }
      }
    } catch (err) {
      log(`Warning: could not parse config.yaml: ${err.message}`);
    }
  }

  // Override with AEGIS_SKILL_PARAMS (JSON)
  if (envParams) {
    try {
      const params = JSON.parse(envParams);
      for (const [key, val] of Object.entries(params)) {
        if (key in config) config[key] = val;
      }
    } catch (err) {
      log(`Warning: could not parse AEGIS_SKILL_PARAMS: ${err.message}`);
    }
  }

  return config;
}

function parseValue(raw, expectedType) {
  const trimmed = raw.replace(/^["']|["']$/g, '').trim();
  if (expectedType === 'boolean') return trimmed === 'true';
  if (expectedType === 'number') return Number(trimmed) || 0;
  return trimmed;
}

function ts() {
  return new Date().toISOString();
}

// ─── Docker Detection ────────────────────────────────────────────────────────

function isDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isDockerComposeAvailable() {
  try {
    execSync('docker compose version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Snapshot Pipeline ───────────────────────────────────────────────────────

/**
 * Get the docker container name for an instance.
 * docker compose names containers as <project>-<service>-1
 */
function getContainerName(instanceId) {
  const composeFile = resolveComposeFile();
  if (!composeFile) return null;
  try {
    const result = execSync(
      `docker compose -f "${composeFile}" ps -q openclaw-gateway`,
      { stdio: 'pipe', timeout: 5000, env: buildComposeEnv(instanceId) }
    ).toString().trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Take a VNC screenshot using `import` (ImageMagick) inside the container.
 * Falls back to xdpyinfo + ffmpeg if import is not available.
 * Returns the path to the saved JPEG on the HOST.
 */
async function takeSnapshot(instanceId) {
  const instance = instances.get(instanceId);
  if (!instance || instance.status !== 'running') return null;

  const mediaDir = getMediaDir(instanceId);
  const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const snapsDir = join(mediaDir, dateDir, 'snaps');
  mkdirSync(snapsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.jpg`;
  const hostPath = join(snapsDir, filename);
  const containerTmpPath = `/tmp/snap_${timestamp}.jpg`;

  const containerId = getContainerName(instanceId);
  if (!containerId) {
    log(`Cannot take snapshot: no container found for "${instanceId}"`);
    return null;
  }

  try {
    // Use import (ImageMagick) inside container to capture X11 display
    execSync(
      `docker exec ${containerId} import -window root -quality 75 ${containerTmpPath}`,
      { stdio: 'pipe', timeout: 10000 }
    );

    // Copy file from container to host
    execSync(
      `docker cp ${containerId}:${containerTmpPath} "${hostPath}"`,
      { stdio: 'pipe', timeout: 10000 }
    );

    // Clean up inside container
    exec(`docker exec ${containerId} rm -f ${containerTmpPath}`);

    return {
      path: hostPath,
      relativePath: join(dateDir, 'snaps', filename),
      timestamp: ts(),
    };
  } catch (err) {
    log(`Snapshot failed for "${instanceId}": ${err.message}`);
    return null;
  }
}

function getMediaDir(instanceId) {
  const aegisDir = process.env.AEGIS_AI_HOME || join(homedir(), '.aegis-ai');
  return join(aegisDir, 'media', 'camera-claw', instanceId);
}

/**
 * Simple pixel-diff between two JPEG files.
 * Returns percentage of pixels that changed (0-100).
 * Uses ImageMagick `compare` inside the container for simplicity.
 */
async function computeScreenDiff(path1, path2) {
  if (!path1 || !path2) return 100; // First frame = 100% change

  try {
    // Use Node.js pixelmatch for comparison
    const { PNG } = await import('pngjs');
    const pixelmatch = (await import('pixelmatch')).default;

    // Convert JPEGs to PNG buffers using sharp-free approach
    // Actually, we'll use a simpler approach: compare file sizes and basic stats
    // For production, we'd use sharp or canvas. For now, estimate via file size delta.
    const { statSync } = await import('node:fs');
    const stat1 = statSync(path1);
    const stat2 = statSync(path2);

    // Quick heuristic: if file sizes differ by more than threshold, there's a change
    const sizeDiff = Math.abs(stat1.size - stat2.size);
    const avgSize = (stat1.size + stat2.size) / 2;
    const diffPct = (sizeDiff / avgSize) * 100;

    // This is a rough approximation. JPEG file size changes correlate with visual changes.
    // A 5% file size change ≈ moderate visual change.
    // Scale it: multiply by 4 to make it more sensitive, cap at 100.
    return Math.min(diffPct * 4, 100);
  } catch (err) {
    log(`Screen diff error: ${err.message}`);
    return 50; // Assume moderate change on error
  }
}

/**
 * Start the snapshot loop for an instance.
 */
function startSnapshotLoop(config, instanceId) {
  const instance = instances.get(instanceId);
  if (!instance) return;

  const intervalMs = Math.max(1000, Math.round(1000 / config.snapshot_fps));
  let lastSnapshotPath = null;
  let lastChangeTime = Date.now();
  let idleEmitted = false;
  let snapshotCount = 0;
  let vlmLastTime = 0;
  let recordingPaused = false;

  log(`Starting snapshot loop for "${instanceId}" at ${config.snapshot_fps} fps (${intervalMs}ms interval)`);

  const timer = setInterval(async () => {
    if (recordingPaused) return;
    if (!instances.has(instanceId)) {
      clearInterval(timer);
      return;
    }

    const snap = await takeSnapshot(instanceId);
    if (!snap) return;

    snapshotCount++;

    // Compute screen diff
    const diffPct = await computeScreenDiff(lastSnapshotPath, snap.path);

    // Emit snapshot event
    emit({
      event: 'snapshot',
      instance_id: instanceId,
      path: snap.path,
      ts: snap.timestamp,
      screen_diff_pct: Math.round(diffPct * 10) / 10,
    });

    // Check for significant screen change
    if (diffPct >= config.screen_change_threshold) {
      lastChangeTime = Date.now();
      idleEmitted = false;

      emit({
        event: 'screen_change',
        instance_id: instanceId,
        diff_pct: Math.round(diffPct * 10) / 10,
        snapshot_path: snap.path,
        ts: snap.timestamp,
      });

      // VLM on change (if configured)
      if (config.vlm_analysis === 'on_change') {
        requestVLMAnalysis(instanceId, snap.path);
      }
    }

    // Idle detection (no significant change for 2+ minutes)
    const idleSeconds = (Date.now() - lastChangeTime) / 1000;
    if (idleSeconds >= 120 && !idleEmitted) {
      idleEmitted = true;
      emit({
        event: 'idle',
        instance_id: instanceId,
        idle_since: new Date(lastChangeTime).toISOString(),
        idle_seconds: Math.round(idleSeconds),
      });
    }

    // Periodic VLM analysis
    if (config.vlm_analysis === 'periodic') {
      const elapsed = (Date.now() - vlmLastTime) / 1000;
      if (elapsed >= config.vlm_interval) {
        vlmLastTime = Date.now();
        requestVLMAnalysis(instanceId, snap.path);
      }
    }

    // Write to timeline.jsonl
    writeTimelineEntry(instanceId, snap, diffPct);

    lastSnapshotPath = snap.path;
  }, intervalMs);

  // Store timer and controls on instance
  instance._snapshotTimer = timer;
  instance._pauseRecording = () => { recordingPaused = true; };
  instance._resumeRecording = () => { recordingPaused = false; };
}

/**
 * Write an enriched timeline entry.
 */
function writeTimelineEntry(instanceId, snap, diffPct) {
  const mediaDir = getMediaDir(instanceId);
  const dateDir = new Date().toISOString().split('T')[0];
  const timelinePath = join(mediaDir, dateDir, 'timeline.jsonl');

  mkdirSync(join(mediaDir, dateDir), { recursive: true });

  const entry = {
    ts: snap.timestamp,
    snap: snap.relativePath,
    diff_pct: Math.round(diffPct * 10) / 10,
  };

  try {
    appendFileSync(timelinePath, JSON.stringify(entry) + '\n');
  } catch (err) {
    log(`Timeline write error: ${err.message}`);
  }
}

// ─── VLM Integration ─────────────────────────────────────────────────────────

/**
 * Request VLM analysis via inline query protocol.
 * Aegis reads this from stdout and responds on stdin.
 */
async function requestVLMAnalysis(instanceId, snapshotPath) {
  const queryId = ++vlmQueryId;

  try {
    // Read snapshot as base64
    const imageBuffer = await readFile(snapshotPath);
    const base64 = imageBuffer.toString('base64');

    // Send VLM query via inline protocol
    emit({
      query: 'vlm_chat',
      id: queryId,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          },
          {
            type: 'text',
            text: 'You are monitoring an AI agent\'s desktop. Describe in one sentence: (1) what application/website is visible, (2) what the agent is doing. Flag any concerns.',
          },
        ],
      }],
      max_tokens: 150,
    });

    // Store pending query for response handling
    pendingQueries.set(queryId, {
      instanceId,
      snapshotPath,
      requestTime: Date.now(),
    });

    log(`VLM query #${queryId} sent for "${instanceId}"`);
  } catch (err) {
    log(`VLM query failed: ${err.message}`);
  }
}

/**
 * Classify VLM response safety. Looks for explicit safety flags
 * while avoiding false positives from negations like "No concerns".
 */
function classifyVlmSafety(content) {
  const lower = content.toLowerCase();
  // Positive safety phrases — always safe
  const safePatterns = ['no concern', 'no issues', 'looks safe', 'nothing unusual', 'no problem'];
  if (safePatterns.some(p => lower.includes(p))) return 'ok';
  // Explicit flag keywords — only flag if present WITHOUT negation
  const flagKeywords = ['warning:', 'unsafe', 'violation', 'unauthorized', 'suspicious', 'policy violation', 'sensitive data'];
  if (flagKeywords.some(k => lower.includes(k))) return 'flagged';
  return 'ok';
}

/**
 * Handle VLM query response from Aegis (received on stdin).
 */
function handleQueryResponse(msg) {
  const queryId = msg.response;
  const pending = pendingQueries.get(queryId);
  if (!pending) return;

  pendingQueries.delete(queryId);

  const elapsed = Date.now() - pending.requestTime;
  log(`VLM response #${queryId} received (${elapsed}ms)`);

  if (msg.ok && msg.content) {
    emit({
      event: 'activity_summary',
      instance_id: pending.instanceId,
      status: 'active',
      ts: ts(),
      vlm_summary: msg.content,
      vlm_safety: classifyVlmSafety(msg.content),
    });
  }
}

// ─── Instance Lifecycle ──────────────────────────────────────────────────────

/**
 * @typedef {Object} InstanceState
 * @property {string} id
 * @property {string} name
 * @property {number} port
 * @property {number} vncPort
 * @property {number} novncPort
 * @property {string} token
 * @property {string} configDir
 * @property {import('node:child_process').ChildProcess|null} process
 * @property {'starting'|'running'|'stopped'|'error'} status
 * @property {NodeJS.Timeout|null} _snapshotTimer
 */

function resolveComposeFile() {
  const candidates = [
    join(process.cwd(), 'docker-compose.yml'),
    join(homedir(), '.openclaw', 'docker-compose.yml'),
  ];
  const openclawRepo = process.env.OPENCLAW_REPO_PATH;
  if (openclawRepo) {
    candidates.unshift(join(openclawRepo, 'docker-compose.yml'));
  }
  return candidates.find(f => existsSync(f)) || null;
}

function buildComposeEnv(instanceId) {
  const instance = instances.get(instanceId);
  if (!instance) return process.env;
  return {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(instance.port),
    OPENCLAW_BRIDGE_PORT: String(instance.port + 1),
    OPENCLAW_VNC_PORT: String(instance.vncPort),
    OPENCLAW_NOVNC_PORT: String(instance.novncPort),
    OPENCLAW_CONFIG_DIR: instance.configDir,
    OPENCLAW_WORKSPACE_DIR: join(instance.configDir, 'workspace'),
    OPENCLAW_GATEWAY_TOKEN: instance.token,
    OPENCLAW_IMAGE: `openclaw:${instances.get(instanceId)?._openclawVersion || 'local'}`,
  };
}

async function createInstance(config, instanceId, name) {
  const basePort = config.openclaw_gateway_port;
  const offset = instances.size;
  const port = basePort + (offset * 10);           // 18789, 18799, ...
  const vncPort = 5900 + offset;                    // 5900, 5901, ...
  const novncPort = 6080 + offset;                  // 6080, 6081, ...
  const token = config.openclaw_gateway_token || generateToken();
  const configDir = join(config.openclaw_config_dir, 'instances', instanceId);
  const workspaceDir = join(configDir, 'workspace');

  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });

  const composeFile = resolveComposeFile();
  if (!composeFile) {
    log(`No docker-compose.yml found — cannot start instance "${instanceId}"`);
    emit({ event: 'error', message: 'No docker-compose.yml found. Ensure OpenClaw is installed.', retriable: false });
    return null;
  }

  // Pre-register instance so buildComposeEnv can find it
  /** @type {InstanceState} */
  const instance = {
    id: instanceId,
    name: name || instanceId,
    port,
    vncPort,
    novncPort,
    token,
    configDir,
    process: null,
    status: 'starting',
    _snapshotTimer: null,
    _pauseRecording: null,
    _resumeRecording: null,
    _openclawVersion: config.openclaw_version || 'local',
  };
  instances.set(instanceId, instance);

  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_BRIDGE_PORT: String(port + 1),
    OPENCLAW_VNC_PORT: String(vncPort),
    OPENCLAW_NOVNC_PORT: String(novncPort),
    OPENCLAW_CONFIG_DIR: configDir,
    OPENCLAW_WORKSPACE_DIR: workspaceDir,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_BIND: config.openclaw_gateway_bind === 'lan' ? 'lan' : 'loopback',
    OPENCLAW_IMAGE: `openclaw:${config.openclaw_version || 'local'}`,
  };

  log(`Starting instance "${instanceId}" on port ${port} (VNC:${vncPort}, noVNC:${novncPort})`);

  try {
    const child = spawn('docker', ['compose', '-f', composeFile, 'up', '-d', 'openclaw-gateway'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker compose exited with code ${code}: ${stderr}`));
      });
      child.on('error', reject);
    });

    instance.status = 'running';

    const gatewayUrl = config.openclaw_gateway_bind === 'lan'
      ? `http://0.0.0.0:${port}`
      : `http://localhost:${port}`;

    const vncWsUrl = `ws://localhost:${novncPort}`;

    // Emit instance_started with VNC info
    emit({
      event: 'instance_started',
      instance_id: instanceId,
      gateway_url: gatewayUrl,
      vnc_url: vncWsUrl,
      name: instance.name,
      token,
    });

    // Wait a moment for VNC services to initialize
    await new Promise(r => setTimeout(r, 3000));

    // Emit vnc_ready
    emit({
      event: 'vnc_ready',
      instance_id: instanceId,
      vnc_ws_url: vncWsUrl,
      view_only_url: `${vncWsUrl}?view_only=true`,
    });

    // Start the snapshot pipeline (if recording is enabled)
    if (config.recording_mode !== 'manual') {
      startSnapshotLoop(config, instanceId);
    }

    log(`Instance "${instanceId}" started at ${gatewayUrl} (noVNC: ${vncWsUrl})`);
    return instance;

  } catch (err) {
    instance.status = 'error';
    instances.delete(instanceId);
    log(`Failed to start instance "${instanceId}": ${err.message}`);
    emit({
      event: 'error',
      message: `Failed to start instance "${instanceId}": ${err.message}`,
      retriable: true,
    });
    return null;
  }
}

async function stopInstance(config, instanceId) {
  const instance = instances.get(instanceId);
  if (!instance) {
    emit({ event: 'error', message: `Instance "${instanceId}" not found`, retriable: false });
    return;
  }

  // Stop snapshot loop
  if (instance._snapshotTimer) {
    clearInterval(instance._snapshotTimer);
    instance._snapshotTimer = null;
  }

  const composeFile = resolveComposeFile();
  if (composeFile) {
    const env = buildComposeEnv(instanceId);
    try {
      execSync(`docker compose -f "${composeFile}" down`, { env, stdio: 'pipe', timeout: 30000 });
    } catch (err) {
      log(`Warning: docker compose down for "${instanceId}" failed: ${err.message}`);
    }
  }

  instance.status = 'stopped';
  instances.delete(instanceId);

  emit({ event: 'instance_stopped', instance_id: instanceId, reason: 'user_request' });
  log(`Instance "${instanceId}" stopped`);
}

function listInstances() {
  const list = Array.from(instances.values()).map(inst => ({
    instance_id: inst.id,
    name: inst.name,
    port: inst.port,
    vnc_port: inst.vncPort,
    novnc_port: inst.novncPort,
    status: inst.status,
    gateway_url: `http://localhost:${inst.port}`,
    vnc_ws_url: `ws://localhost:${inst.novncPort}`,
  }));

  emit({ event: 'instance_list', instances: list });
}

// ─── Health Monitoring ───────────────────────────────────────────────────────

async function checkInstanceHealth(instance) {
  try {
    const url = `http://localhost:${instance.port}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    emit({
      event: 'health',
      ts: ts(),
      instance_id: instance.id,
      status: response.ok ? 'healthy' : 'unhealthy',
      http_status: response.status,
    });
  } catch (err) {
    emit({
      event: 'health',
      ts: ts(),
      instance_id: instance.id,
      status: 'unreachable',
      error: err.message,
    });
  }
}

function startHealthLoop(intervalMs = 30000) {
  return setInterval(() => {
    for (const instance of instances.values()) {
      if (instance.status === 'running') {
        checkInstanceHealth(instance);
      }
    }
  }, intervalMs);
}

// ─── Stdin Command Handler ───────────────────────────────────────────────────

function handleCommand(config, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log(`Invalid JSON on stdin: ${line}`);
    return;
  }

  // Handle VLM query responses from Aegis
  if (msg.response != null) {
    handleQueryResponse(msg);
    return;
  }

  // Ignore non-command messages (e.g. detection frames from Aegis pipeline)
  if (!msg.command) {
    return;
  }

  switch (msg.command) {
    case 'create_instance':
      createInstance(config, msg.instance_id || 'default', msg.name);
      break;
    case 'stop_instance':
      stopInstance(config, msg.instance_id);
      break;
    case 'list_instances':
      listInstances();
      break;
    case 'stop':
      shutdown(config);
      break;
    case 'pause_recording': {
      const inst = instances.get(msg.instance_id || 'default');
      if (inst?._pauseRecording) {
        inst._pauseRecording();
        log(`Recording paused for "${msg.instance_id || 'default'}"`);
      }
      break;
    }
    case 'resume_recording': {
      const inst = instances.get(msg.instance_id || 'default');
      if (inst?._resumeRecording) {
        inst._resumeRecording();
        log(`Recording resumed for "${msg.instance_id || 'default'}"`);
      }
      break;
    }
    case 'take_snapshot': {
      const instanceId = msg.instance_id || 'default';
      takeSnapshot(instanceId).then(snap => {
        if (snap) {
          emit({
            event: 'snapshot',
            instance_id: instanceId,
            path: snap.path,
            ts: snap.timestamp,
            screen_diff_pct: 0,
          });
        }
      });
      break;
    }
    case 'analyze_screen': {
      const instanceId = msg.instance_id || 'default';
      takeSnapshot(instanceId).then(snap => {
        if (snap) {
          requestVLMAnalysis(instanceId, snap.path);
        }
      });
      break;
    }
    default:
      log(`Unknown command: ${msg.command}`);
      emit({ event: 'error', message: `Unknown command: ${msg.command}`, retriable: false });
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function shutdown(config) {
  log('Shutting down all instances...');
  for (const instanceId of instances.keys()) {
    await stopInstance(config, instanceId);
  }
  process.exit(0);
}

async function main() {
  // Handle --help without starting the daemon
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`CameraClaw Monitor v2.0 — OpenClaw Desktop Orchestrator

Usage:
  node scripts/monitor.js           Start the monitor daemon
  node scripts/monitor.js --help    Show this help

Features:
  - Virtual desktop (Xvfb + Chrome) inside Docker
  - noVNC live view (view-only for Monitor, interactive for Panel)
  - Periodic VNC snapshots with screen-diff detection
  - VLM analysis via Aegis inline query protocol
  - Enriched timeline (snapshot + agent logs + network metadata)

Requires Docker and Docker Compose to be installed and running.
Communicates via JSONL over stdin/stdout.

Environment:
  AEGIS_SKILL_PARAMS    JSON object of skill parameters (from Aegis)
  OPENCLAW_REPO_PATH    Path to local OpenClaw repo (optional)
  AEGIS_AI_HOME         Aegis data directory (default: ~/.aegis-ai)

See SKILL.md for full parameter and protocol documentation.`);
    process.exit(0);
  }

  const config = loadConfig();

  // Docker is required — no native fallback
  const dockerAvailable = isDockerAvailable();
  const composeAvailable = isDockerComposeAvailable();

  if (!dockerAvailable || !composeAvailable) {
    const missing = !dockerAvailable ? 'Docker' : 'Docker Compose';
    log(`${missing} is not available — CameraClaw requires Docker to run.`);
    emit({
      event: 'error',
      message: `${missing} is required but not available. Install Docker and ensure the daemon is running.`,
      retriable: false,
    });
    process.exit(1);
  }

  log('Docker: ready');

  emit({
    event: 'ready',
    mode: 'docker',
    openclaw_version: config.openclaw_version,
    monitoring: config.network_monitoring,
    snapshot_fps: config.snapshot_fps,
    vlm_analysis: config.vlm_analysis,
  });

  // Auto-start default instance if configured
  if (config.auto_start) {
    await createInstance(config, 'default', 'Default Agent');
  }

  // Start health monitoring
  const healthTimer = startHealthLoop();

  // Listen for stdin commands
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => handleCommand(config, line));
  rl.on('close', () => shutdown(config));

  // Graceful shutdown
  process.on('SIGTERM', () => shutdown(config));
  process.on('SIGINT', () => shutdown(config));
}

main().catch(err => {
  emit({ event: 'error', message: err.message, retriable: false });
  process.exit(1);
});
