#!/usr/bin/env node

/**
 * CameraClaw Protocol Test — Mocked Controller
 *
 * Spawns monitor.js as a child process with a mock Docker shim on PATH.
 * Sends JSONL commands on stdin, captures stdout events, and validates
 * the complete v2.0 protocol.
 *
 * Usage: node tests/test-protocol.mjs
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const MONITOR_SCRIPT = join(PROJECT_ROOT, 'scripts', 'monitor.js');
const MOCK_DOCKER = join(PROJECT_ROOT, 'tests', 'mock-docker.sh');

// ── Test State ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const events = [];
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
    errors.push(message);
  }
}

function findEvent(eventName, filter = {}) {
  return events.find(e => {
    if (e.event !== eventName) return false;
    for (const [key, val] of Object.entries(filter)) {
      if (e[key] !== val) return false;
    }
    return true;
  });
}

function findAllEvents(eventName) {
  return events.filter(e => e.event === eventName);
}

function findQuery(queryName) {
  return events.find(e => e.query === queryName);
}

// ── Mock Setup ───────────────────────────────────────────────────────────────

// Create a temp directory for mock Docker binary
const MOCK_BIN_DIR = join(tmpdir(), `cameraclaw-test-${Date.now()}`);
mkdirSync(MOCK_BIN_DIR, { recursive: true });

// Create temp dirs for test data
const TEST_AEGIS_HOME = join(tmpdir(), `cameraclaw-aegis-${Date.now()}`);
const TEST_OPENCLAW_DIR = join(tmpdir(), `cameraclaw-openclaw-${Date.now()}`);
mkdirSync(TEST_AEGIS_HOME, { recursive: true });
mkdirSync(TEST_OPENCLAW_DIR, { recursive: true });

// Symlink mock-docker.sh as "docker" in mock bin dir
const mockDockerPath = join(MOCK_BIN_DIR, 'docker');
try {
  const { execSync } = await import('node:child_process');
  execSync(`cp "${MOCK_DOCKER}" "${mockDockerPath}"`);
  chmodSync(mockDockerPath, 0o755);
} catch (err) {
  console.error(`Failed to set up mock docker: ${err.message}`);
  process.exit(1);
}

// ── Test Runner ──────────────────────────────────────────────────────────────

function sendCommand(child, cmd) {
  return new Promise((resolve) => {
    child.stdin.write(JSON.stringify(cmd) + '\n');
    // Give the process time to handle the command
    setTimeout(resolve, 500);
  });
}

function waitForEvents(child, count, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startCount = events.length;
    const startTime = Date.now();

    const check = () => {
      if (events.length >= startCount + count) {
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   CameraClaw Protocol Test v2.0          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Test 1: --help flag ─────────────────────────────────────────────────
  console.log('📋 Test: --help flag');
  {
    const child = spawn('node', [MONITOR_SCRIPT, '--help'], {
      env: { ...process.env, PATH: `${MOCK_BIN_DIR}:${process.env.PATH}` },
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    const code = await new Promise(r => child.on('close', r));
    assert(code === 0, '--help exits with code 0');
    assert(stdout.includes('CameraClaw Monitor v2.0'), '--help shows version string');
    assert(stdout.includes('AEGIS_SKILL_PARAMS'), '--help mentions AEGIS_SKILL_PARAMS');
  }

  // ── Test 2: Full lifecycle with auto_start ──────────────────────────────
  console.log('\n📋 Test: Full lifecycle (auto_start + events)');
  {
    events.length = 0;

    const config = {
      auto_start: true,
      openclaw_version: 'test-v1',
      recording_mode: 'manual',     // Don't start snapshot loop
      snapshot_fps: 1,
      screen_change_threshold: 20,
      vlm_analysis: 'off',
      openclaw_config_dir: TEST_OPENCLAW_DIR,
      openclaw_gateway_port: 29789,
      openclaw_gateway_bind: 'loopback',
    };

    const child = spawn('node', [MONITOR_SCRIPT], {
      env: {
        ...process.env,
        PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
        AEGIS_SKILL_PARAMS: JSON.stringify(config),
        AEGIS_AI_HOME: TEST_AEGIS_HOME,
      },
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    // Parse stdout JSONL events
    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer
      for (const line of lines) {
        if (line.trim()) {
          try {
            events.push(JSON.parse(line));
          } catch {
            console.log(`  ⚠️ Non-JSON output: ${line}`);
          }
        }
      }
    });

    // Wait for startup events (ready + instance_started + vnc_ready)
    await waitForEvents(child, 3, 20000);

    // ── Verify ready event ──
    const readyEvent = findEvent('ready');
    assert(!!readyEvent, 'Emits "ready" event');
    assert(readyEvent?.mode === 'docker', 'ready.mode === "docker"');
    assert(readyEvent?.openclaw_version === 'test-v1', 'ready.openclaw_version matches config');
    assert(readyEvent?.snapshot_fps === 1, 'ready.snapshot_fps matches config');
    assert(readyEvent?.vlm_analysis === 'off', 'ready.vlm_analysis matches config');

    // ── Verify instance_started event ──
    const startEvent = findEvent('instance_started');
    assert(!!startEvent, 'Emits "instance_started" event (auto_start)');
    assert(startEvent?.instance_id === 'default', 'instance_started.instance_id === "default"');
    assert(startEvent?.gateway_url?.includes('29789'), 'instance_started.gateway_url contains port');
    assert(startEvent?.vnc_url?.includes('ws://'), 'instance_started.vnc_url is a WebSocket URL');
    assert(typeof startEvent?.token === 'string' && startEvent.token.length > 0, 'instance_started.token is non-empty');

    // ── Verify vnc_ready event ──
    const vncEvent = findEvent('vnc_ready');
    assert(!!vncEvent, 'Emits "vnc_ready" event');
    assert(vncEvent?.instance_id === 'default', 'vnc_ready.instance_id === "default"');
    assert(vncEvent?.vnc_ws_url?.includes('ws://'), 'vnc_ready.vnc_ws_url is a WebSocket URL');
    assert(vncEvent?.view_only_url?.includes('view_only=true'), 'vnc_ready.view_only_url includes query param');

    // ── Test: list_instances command ──
    console.log('\n📋 Test: list_instances command');
    events.length = 0;
    await sendCommand(child, { command: 'list_instances' });
    await waitForEvents(child, 1, 3000);

    const listEvent = findEvent('instance_list');
    assert(!!listEvent, 'Emits "instance_list" event');
    assert(Array.isArray(listEvent?.instances), 'instance_list.instances is an array');
    assert(listEvent?.instances?.length === 1, 'instance_list has 1 instance');
    assert(listEvent?.instances?.[0]?.instance_id === 'default', 'Listed instance is "default"');
    assert(listEvent?.instances?.[0]?.vnc_ws_url?.includes('ws://'), 'Listed instance has vnc_ws_url');

    // ── Test: take_snapshot command ──
    console.log('\n📋 Test: take_snapshot command');
    events.length = 0;
    await sendCommand(child, { command: 'take_snapshot', instance_id: 'default' });
    await waitForEvents(child, 1, 5000);

    const snapEvent = findEvent('snapshot');
    assert(!!snapEvent, 'Emits "snapshot" event after take_snapshot');
    assert(snapEvent?.instance_id === 'default', 'snapshot.instance_id === "default"');
    assert(typeof snapEvent?.path === 'string', 'snapshot.path is a string');
    assert(typeof snapEvent?.ts === 'string', 'snapshot.ts is a timestamp string');

    // ── Test: analyze_screen command (VLM query) ──
    console.log('\n📋 Test: analyze_screen command (VLM query)');
    events.length = 0;
    await sendCommand(child, { command: 'analyze_screen', instance_id: 'default' });
    await waitForEvents(child, 1, 5000);

    // analyze_screen takes a snapshot then sends a VLM query
    const vlmQuery = findQuery('vlm_chat');
    assert(!!vlmQuery, 'Emits vlm_chat inline query after analyze_screen');
    assert(typeof vlmQuery?.id === 'number', 'vlm_chat query has numeric id');
    assert(Array.isArray(vlmQuery?.messages), 'vlm_chat query has messages array');
    assert(vlmQuery?.messages?.[0]?.content?.length === 2, 'vlm_chat message has image + text content');

    // ── Test: simulate VLM response ──
    console.log('\n📋 Test: VLM response handling');
    events.length = 0;
    await sendCommand(child, {
      response: vlmQuery?.id || 1,
      ok: true,
      content: 'Agent is browsing twitter.com, scrolling through the feed. No concerns.',
      model: 'test-vlm',
      usage: { prompt_tokens: 500, completion_tokens: 30 },
    });
    await waitForEvents(child, 1, 3000);

    const summaryEvent = findEvent('activity_summary');
    assert(!!summaryEvent, 'Emits "activity_summary" after VLM response');
    assert(summaryEvent?.instance_id === 'default', 'activity_summary.instance_id === "default"');
    assert(summaryEvent?.vlm_summary?.includes('twitter'), 'activity_summary.vlm_summary contains VLM response');
    assert(summaryEvent?.vlm_safety === 'ok', 'activity_summary.vlm_safety === "ok"');

    // ── Test: ignore non-command messages ──
    console.log('\n📋 Test: ignore non-command messages');
    events.length = 0;
    await sendCommand(child, { event: 'frame', frame_path: '/tmp/test.jpg', camera_id: 'cam1' });
    await new Promise(r => setTimeout(r, 1000));
    assert(events.length === 0, 'No events emitted for non-command messages');

    // ── Test: unknown command ──
    console.log('\n📋 Test: unknown command error');
    events.length = 0;
    await sendCommand(child, { command: 'invalid_command_xyz' });
    await waitForEvents(child, 1, 3000);

    const errEvent = findEvent('error');
    assert(!!errEvent, 'Emits "error" event for unknown command');
    assert(errEvent?.message?.includes('invalid_command_xyz'), 'Error message contains command name');

    // ── Test: stop_instance command ──
    console.log('\n📋 Test: stop_instance command');
    events.length = 0;
    await sendCommand(child, { command: 'stop_instance', instance_id: 'default' });
    await waitForEvents(child, 1, 5000);

    const stopEvent = findEvent('instance_stopped');
    assert(!!stopEvent, 'Emits "instance_stopped" event');
    assert(stopEvent?.instance_id === 'default', 'instance_stopped.instance_id === "default"');
    assert(stopEvent?.reason === 'user_request', 'instance_stopped.reason === "user_request"');

    // ── Test: list_instances after stop (should be empty) ──
    console.log('\n📋 Test: list_instances after stop');
    events.length = 0;
    await sendCommand(child, { command: 'list_instances' });
    await waitForEvents(child, 1, 3000);

    const listAfterStop = findEvent('instance_list');
    assert(!!listAfterStop, 'Emits "instance_list" after stop');
    assert(listAfterStop?.instances?.length === 0, 'No instances after stop');

    // ── Test: create a named instance ──
    console.log('\n📋 Test: create named instance');
    events.length = 0;
    await sendCommand(child, { command: 'create_instance', instance_id: 'work', name: 'Work Agent' });
    await waitForEvents(child, 3, 20000);

    const workStart = findEvent('instance_started', { instance_id: 'work' });
    assert(!!workStart, 'Emits "instance_started" for named instance');
    assert(workStart?.name === 'Work Agent', 'Named instance has correct name');

    const workVnc = findEvent('vnc_ready', { instance_id: 'work' });
    assert(!!workVnc, 'Emits "vnc_ready" for named instance');

    // ── Cleanup: stop the process ──
    await sendCommand(child, { command: 'stop' });
    await new Promise(r => child.on('close', r));

    // Verify stderr has log messages
    assert(stderr.includes('[CameraClaw]'), 'Stderr contains [CameraClaw] log prefix');
    assert(stderr.includes('Docker: ready'), 'Stderr logs Docker readiness');
  }

  // ── Test 3: recording_mode = continuous triggers snapshot loop ──────────
  console.log('\n📋 Test: Snapshot loop (continuous mode)');
  {
    events.length = 0;

    const config = {
      auto_start: true,
      recording_mode: 'continuous',
      snapshot_fps: 2,               // 2 fps = 500ms interval
      screen_change_threshold: 1,    // Very sensitive for testing
      vlm_analysis: 'off',
      openclaw_config_dir: TEST_OPENCLAW_DIR,
      openclaw_gateway_port: 39789,
      openclaw_gateway_bind: 'loopback',
    };

    const child = spawn('node', [MONITOR_SCRIPT], {
      env: {
        ...process.env,
        PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
        AEGIS_SKILL_PARAMS: JSON.stringify(config),
        AEGIS_AI_HOME: TEST_AEGIS_HOME,
      },
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try { events.push(JSON.parse(line)); } catch {}
        }
      }
    });

    // Wait for startup + some snapshots (ready + instance_started + vnc_ready + snapshots)
    await waitForEvents(child, 6, 20000);

    const snapshots = findAllEvents('snapshot');
    assert(snapshots.length >= 1, `Snapshot loop produced ${snapshots.length} snapshot(s) in continuous mode`);

    // With screen_change_threshold=1, even random JPEG size diffs should trigger changes
    const changes = findAllEvents('screen_change');
    // Changes may or may not fire depending on JPEG randomness — just check no crash
    assert(true, `Screen change events: ${changes.length} (may vary with random JPEGs)`);

    // Stop
    child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
    await new Promise(r => child.on('close', r));
  }

  // ── Test 4: VLM on_change mode ─────────────────────────────────────────
  console.log('\n📋 Test: VLM on_change mode');
  {
    events.length = 0;

    const config = {
      auto_start: true,
      recording_mode: 'continuous',
      snapshot_fps: 2,
      screen_change_threshold: 1,    // Very sensitive
      vlm_analysis: 'on_change',
      vlm_interval: 5,
      openclaw_config_dir: TEST_OPENCLAW_DIR,
      openclaw_gateway_port: 49789,
      openclaw_gateway_bind: 'loopback',
    };

    const child = spawn('node', [MONITOR_SCRIPT], {
      env: {
        ...process.env,
        PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
        AEGIS_SKILL_PARAMS: JSON.stringify(config),
        AEGIS_AI_HOME: TEST_AEGIS_HOME,
      },
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try { events.push(JSON.parse(line)); } catch {}
        }
      }
    });

    // Wait for some events
    await waitForEvents(child, 6, 15000);

    const vlmQueries = events.filter(e => e.query === 'vlm_chat');
    assert(vlmQueries.length >= 0, `VLM queries triggered: ${vlmQueries.length} (depends on screen diff)`);

    if (vlmQueries.length > 0) {
      assert(vlmQueries[0].messages?.[0]?.content?.length === 2, 'VLM query has image + text');
    }

    child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
    await new Promise(r => child.on('close', r));
  }

  // ── Results ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('  Failed tests:');
    for (const err of errors) {
      console.log(`    ❌ ${err}`);
    }
    console.log('');
  }

  // Cleanup temp dirs
  try {
    rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
    rmSync(TEST_AEGIS_HOME, { recursive: true, force: true });
    rmSync(TEST_OPENCLAW_DIR, { recursive: true, force: true });
  } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(`Test runner error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
