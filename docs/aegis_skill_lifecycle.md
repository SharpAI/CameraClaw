# Aegis-AI: Skill Lifecycle Hooks

> **Audience**: Aegis-AI developers  
> **Purpose**: How Aegis should call skill-provided lifecycle scripts during install, deploy, and uninstall.

## Overview

Skills can provide lifecycle scripts that Aegis runs at key moments. This enables skills to set up and tear down external resources (Docker containers, images, databases, etc.) that can't be managed by simply adding/removing files.

## Hook Scripts

Skills may include any of these scripts in their root directory:

| Script | When Aegis Calls It | Purpose |
|--------|-------------------|---------|
| `deploy.sh` / `deploy.bat` | After `git clone` or `git pull` | Build images, install deps, run migrations |
| `uninstall.sh` / `uninstall.bat` | Before deleting skill directory | Stop containers, remove images, clean media |

> [!IMPORTANT]  
> Choose `.sh` on macOS/Linux, `.bat` on Windows. Skills should provide both.

---

## 1. Install Flow

```
User clicks "Install" for a skill
    ↓
Aegis clones the skill repo to ~/.aegis-ai/skills/<skill-id>/
    ↓
Aegis checks for deploy.sh / deploy.bat
    ↓ (if exists)
Aegis runs: bash deploy.sh   (or cmd /c deploy.bat on Windows)
    ↓
Aegis reads config.yaml → renders settings UI
    ↓
Aegis starts the skill's monitor script
```

**Aegis implementation** (pseudo-code):
```javascript
async function installSkill(repoUrl, skillId) {
  const skillDir = path.join(SKILLS_DIR, skillId);
  
  // 1. Clone
  await exec(`git clone ${repoUrl} ${skillDir}`);
  
  // 2. Run deploy hook
  const deployScript = getLifecycleScript(skillDir, 'deploy');
  if (deployScript) {
    log(`[${skillId}] Running deploy script...`);
    await exec(deployScript, { cwd: skillDir, timeout: 300_000 });
  }
  
  // 3. Parse config.yaml for settings UI
  const config = parseConfigYaml(path.join(skillDir, 'config.yaml'));
  registerSkill(skillId, config);
}
```

---

## 2. Uninstall Flow

> [!CAUTION]
> Without the uninstall hook, Docker containers and images from the previous installation persist indefinitely — consuming disk and ports.

```
User clicks "Uninstall" for a skill
    ↓
Aegis stops the skill's monitor script (SIGTERM)
    ↓
Aegis waits for graceful shutdown (monitor handles its own cleanup)
    ↓
Aegis checks for uninstall.sh / uninstall.bat
    ↓ (if exists)
Aegis runs: bash uninstall.sh   (or cmd /c uninstall.bat on Windows)
    ↓
Aegis deletes the skill directory
    ↓
Aegis removes skill from registry
```

**Aegis implementation** (pseudo-code):
```javascript
async function uninstallSkill(skillId) {
  const skillDir = path.join(SKILLS_DIR, skillId);
  
  // 1. Stop the running skill process
  await stopSkillProcess(skillId);  // sends SIGTERM, waits up to 10s
  
  // 2. Run uninstall hook (BEFORE deleting files)
  const uninstallScript = getLifecycleScript(skillDir, 'uninstall');
  if (uninstallScript) {
    log(`[${skillId}] Running uninstall script...`);
    try {
      await exec(uninstallScript, { cwd: skillDir, timeout: 60_000 });
    } catch (err) {
      log(`[${skillId}] Uninstall script failed: ${err.message}`);
      // Continue with deletion anyway
    }
  }
  
  // 3. Delete skill directory
  await fs.rm(skillDir, { recursive: true, force: true });
  
  // 4. Remove from registry
  deregisterSkill(skillId);
}
```

---

## 3. Helper: Cross-Platform Script Resolution

```javascript
function getLifecycleScript(skillDir, name) {
  if (process.platform === 'win32') {
    const bat = path.join(skillDir, `${name}.bat`);
    if (fs.existsSync(bat)) return `cmd /c "${bat}"`;
  } else {
    const sh = path.join(skillDir, `${name}.sh`);
    if (fs.existsSync(sh)) return `bash "${sh}"`;
  }
  return null;
}
```

---

## 4. LLM-Driven Uninstall (Prompt-Based)

For conversational uninstall via the Aegis chat:

```
User: "Uninstall Camera Claw"
    ↓
LLM tool call: uninstall_skill({ skill_id: "camera-claw" })
    ↓
Aegis runs the uninstall flow above
    ↓
LLM responds: "Camera Claw has been uninstalled. Docker containers
               and the openclaw:local image have been removed."
```

**Tool definition for the LLM**:
```json
{
  "name": "uninstall_skill",
  "description": "Uninstall a skill — stops processes, runs cleanup hooks, removes files",
  "parameters": {
    "skill_id": {
      "type": "string",
      "description": "The skill identifier (directory name under ~/.aegis-ai/skills/)"
    },
    "keep_data": {
      "type": "boolean",
      "default": false,
      "description": "If true, keep media/config data. If false, full cleanup."
    }
  }
}
```

---

## 5. What CameraClaw Provides

| File | Purpose |
|------|---------|
| `deploy.sh` / `deploy.bat` | Builds `openclaw:local` Docker image (~4GB) with desktop environment |
| `uninstall.sh` / `uninstall.bat` | Stops containers, removes `openclaw:local` image, cleans media |
| `scripts/monitor.js` | On startup: cleans stale containers. On SIGTERM: `docker compose down --remove-orphans` |
| `config.yaml` | Structured params array for Aegis settings UI |

The skill handles its own cleanup at 3 levels:
1. **Monitor startup** — cleans orphans from previous crashed run
2. **Monitor shutdown** — graceful `docker compose down`
3. **Uninstall script** — nuclear option: removes everything including the image
