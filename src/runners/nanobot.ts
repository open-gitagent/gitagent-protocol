import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToNanobot } from '../adapters/nanobot.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info, warn } from '../utils/format.js';
import { ensureNanobotAuth } from '../utils/auth-provision.js';

export interface NanobotRunOptions {
  prompt?: string;
  workspace?: string;
}

export function runWithNanobot(agentDir: string, manifest: AgentManifest, options: NanobotRunOptions = {}): void {
  ensureNanobotAuth();
  const exp = exportToNanobot(agentDir);

  // Write config to a temp directory
  const tmpConfigDir = join(tmpdir(), `gitagent-nanobot-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmpConfigDir, { recursive: true });

  const configFile = join(tmpConfigDir, 'config.json');
  writeFileSync(configFile, JSON.stringify(exp.config, null, 2), 'utf-8');

  // Write system prompt to a file nanobot can reference
  const promptFile = join(tmpConfigDir, 'system-prompt.md');
  writeFileSync(promptFile, exp.systemPrompt, 'utf-8');

  info(`Nanobot config prepared at ${tmpConfigDir}`);

  // Build nanobot CLI args
  // `nanobot agent` starts the interactive agent
  const args: string[] = ['agent'];

  // If a prompt is provided, pass it as --message for single-shot mode
  if (options.prompt) {
    args.push('--message', options.prompt);
  }

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Launching Nanobot agent "${manifest.name}"...`);
  info(`Working directory: ${runCwd}`);
  if (!options.prompt) {
    info('Starting interactive mode. Type your messages to chat.');
  }

  try {
    const result = spawnSync('nanobot', args, {
      stdio: 'inherit',
      cwd: runCwd,
      env: {
        ...process.env,
        NANOBOT_CONFIG: configFile,
        NANOBOT_SYSTEM_PROMPT: exp.systemPrompt,
      },
    });

    if (result.error) {
      error(`Failed to launch Nanobot: ${result.error.message}`);
      info('Install Nanobot with: pip install nanobot-ai');
      info('Or: uv tool install nanobot-ai');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    try { rmSync(tmpConfigDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
