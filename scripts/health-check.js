#!/usr/bin/env node

/**
 * CameraClaw Health Check
 *
 * Quick utility to check the health of OpenClaw instances managed by CameraClaw.
 * Exits 0 if all instances are healthy, 1 otherwise.
 *
 * Usage:
 *   node scripts/health-check.js                    # Check all instances
 *   node scripts/health-check.js --port 18789       # Check specific port
 *   node scripts/health-check.js --instance home    # Check specific instance
 */

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);

function parseArgs() {
  const opts = { port: null, instance: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) opts.port = Number(args[++i]);
    if (args[i] === '--instance' && args[i + 1]) opts.instance = args[++i];
    if (args[i] === '--help') {
      console.log(`CameraClaw Health Check

Usage:
  node scripts/health-check.js                    Check all running instances
  node scripts/health-check.js --port 18789       Check specific port
  node scripts/health-check.js --instance home    Check by instance name

Exit codes:
  0  All checked instances are healthy
  1  One or more instances are unhealthy or unreachable`);
      process.exit(0);
    }
  }
  return opts;
}

async function checkPort(port) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return { port, status: response.ok ? 'healthy' : 'unhealthy', httpStatus: response.status };
  } catch (err) {
    return { port, status: 'unreachable', error: err.message };
  }
}

function findRunningContainers() {
  try {
    const raw = execSync('docker ps --filter "ancestor=openclaw" --format "{{.Ports}}"', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).toString().trim();

    if (!raw) return [];

    const ports = [];
    for (const line of raw.split('\n')) {
      // Parse "0.0.0.0:28001->18789/tcp" format
      const match = line.match(/0\.0\.0\.0:(\d+)->18789/);
      if (match) ports.push(Number(match[1]));
    }
    return ports;
  } catch {
    return [];
  }
}

async function main() {
  const opts = parseArgs();

  // Docker check
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
  } catch {
    console.log('❌ Docker is not available');
    process.exit(1);
  }

  let ports;
  if (opts.port) {
    ports = [opts.port];
  } else {
    ports = findRunningContainers();
    if (ports.length === 0) {
      console.log('ℹ️  No OpenClaw containers found running');
      process.exit(0);
    }
  }

  let allHealthy = true;
  for (const port of ports) {
    const result = await checkPort(port);
    const icon = result.status === 'healthy' ? '✅' : '❌';
    console.log(`${icon} Port ${result.port}: ${result.status}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}${result.error ? ` — ${result.error}` : ''}`);
    if (result.status !== 'healthy') allHealthy = false;
  }

  process.exit(allHealthy ? 0 : 1);
}

main();
