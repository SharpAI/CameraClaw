#!/usr/bin/env node

/**
 * CameraClaw Monitor — OpenClaw Docker Orchestrator
 *
 * Manages OpenClaw container instances and reports their state to Aegis via JSONL.
 * Reads commands from stdin, emits events to stdout.
 *
 * This is the main entry script for the CameraClaw skill.
 */

import { execSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  auto_start: true,
  openclaw_version: 'latest',
  recording_mode: 'continuous',
  clip_duration: 300,
  network_monitoring: true,
  alert_unknown_connections: true,
  audit_level: 'full',
  openclaw_config_dir: join(homedir(), '.openclaw'),
  openclaw_gateway_token: '',
  openclaw_gateway_port: 18789,
  openclaw_gateway_bind: 'loopback',
};

/** @type {Map<string, InstanceState>} */
const instances = new Map();

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
      // Simple YAML parse for flat key-value (avoid heavy dependency)
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

// ─── Instance Lifecycle ──────────────────────────────────────────────────────

/**
 * @typedef {Object} InstanceState
 * @property {string} id
 * @property {string} name
 * @property {number} port
 * @property {string} token
 * @property {string} configDir
 * @property {import('node:child_process').ChildProcess|null} process
 * @property {'starting'|'running'|'stopped'|'error'} status
 */

function resolveComposeFile() {
  // Look for docker-compose.yml in the OpenClaw source
  const candidates = [
    join(process.cwd(), 'docker-compose.yml'),
    join(homedir(), '.openclaw', 'docker-compose.yml'),
  ];
  // If OpenClaw is cloned locally, use its compose file
  const openclawRepo = process.env.OPENCLAW_REPO_PATH;
  if (openclawRepo) {
    candidates.unshift(join(openclawRepo, 'docker-compose.yml'));
  }
  return candidates.find(f => existsSync(f)) || null;
}

async function createInstance(config, instanceId, name) {
  const basePort = config.openclaw_gateway_port;
  const offset = instances.size;
  const port = basePort + offset;
  const token = config.openclaw_gateway_token || generateToken();
  const configDir = join(config.openclaw_config_dir, 'instances', instanceId);
  const workspaceDir = join(configDir, 'workspace');

  // Ensure directories exist
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });

  const composeFile = resolveComposeFile();

  if (!composeFile) {
    log(`No docker-compose.yml found — cannot start instance "${instanceId}"`);
    emit({ event: 'error', message: 'No docker-compose.yml found. Ensure OpenClaw is installed.', retriable: false });
    return null;
  }

  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_BRIDGE_PORT: String(port + 1),
    OPENCLAW_CONFIG_DIR: configDir,
    OPENCLAW_WORKSPACE_DIR: workspaceDir,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_BIND: config.openclaw_gateway_bind === 'lan' ? 'lan' : 'loopback',
    OPENCLAW_IMAGE: `openclaw:${config.openclaw_version || 'local'}`,
  };

  log(`Starting instance "${instanceId}" on port ${port}`);

  try {
    // Start via docker compose
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

    /** @type {InstanceState} */
    const instance = {
      id: instanceId,
      name: name || instanceId,
      port,
      token,
      configDir,
      process: null,
      status: 'running',
    };
    instances.set(instanceId, instance);

    const gatewayUrl = config.openclaw_gateway_bind === 'lan'
      ? `http://0.0.0.0:${port}`
      : `http://localhost:${port}`;

    emit({
      event: 'instance_started',
      instance_id: instanceId,
      gateway_url: gatewayUrl,
      name: instance.name,
      token,
    });

    log(`Instance "${instanceId}" started at ${gatewayUrl}`);
    return instance;

  } catch (err) {
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

  const composeFile = resolveComposeFile();
  if (composeFile) {
    const env = {
      ...process.env,
      OPENCLAW_GATEWAY_PORT: String(instance.port),
      OPENCLAW_CONFIG_DIR: instance.configDir,
      OPENCLAW_WORKSPACE_DIR: join(instance.configDir, 'workspace'),
      OPENCLAW_GATEWAY_TOKEN: instance.token,
    };

    try {
      execSync(`docker compose -f "${composeFile}" down`, { env, stdio: 'pipe', timeout: 30000 });
    } catch (err) {
      log(`Warning: docker compose down for "${instanceId}" failed: ${err.message}`);
    }
  }

  instance.status = 'stopped';
  instances.delete(instanceId);

  emit({ event: 'instance_stopped', instance_id: instanceId });
  log(`Instance "${instanceId}" stopped`);
}

function listInstances() {
  const list = Array.from(instances.values()).map(inst => ({
    instance_id: inst.id,
    name: inst.name,
    port: inst.port,
    status: inst.status,
    gateway_url: `http://localhost:${inst.port}`,
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
      timestamp: new Date().toISOString(),
      instance_id: instance.id,
      status: response.ok ? 'healthy' : 'unhealthy',
      http_status: response.status,
    });
  } catch (err) {
    emit({
      event: 'health',
      timestamp: new Date().toISOString(),
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
    case 'pause_recording':
      log('Recording paused (placeholder)');
      break;
    case 'resume_recording':
      log('Recording resumed (placeholder)');
      break;
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
    console.log(`CameraClaw Monitor — OpenClaw Docker Orchestrator

Usage:
  node scripts/monitor.js           Start the monitor daemon
  node scripts/monitor.js --help    Show this help

Requires Docker and Docker Compose to be installed and running.
Communicates via JSONL over stdin/stdout.

Environment:
  AEGIS_SKILL_PARAMS    JSON object of skill parameters (from Aegis)
  OPENCLAW_REPO_PATH    Path to local OpenClaw repo (optional)

See SKILL.md for full parameter documentation.`);
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
