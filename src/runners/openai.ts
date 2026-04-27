import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToOpenAI } from '../adapters/openai.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';
import { resolveOpenAIKey } from '../utils/auth-provision.js';

export interface OpenAIRunOptions {
  workspace?: string;
}

export function runWithOpenAI(agentDir: string, _manifest: AgentManifest, options: OpenAIRunOptions = {}): void {
  if (!resolveOpenAIKey()) {
    error('OPENAI_API_KEY environment variable is not set');
    info('Set it with: export OPENAI_API_KEY="sk-..."');
    process.exit(1);
  }

  const script = exportToOpenAI(agentDir);
  const tmpFile = join(tmpdir(), `gitagent-${randomBytes(4).toString('hex')}.py`);

  writeFileSync(tmpFile, script, 'utf-8');

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Running OpenAI agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    const result = spawnSync('python3', [tmpFile], {
      stdio: 'inherit',
      cwd: runCwd,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run Python: ${result.error.message}`);
      info('Make sure python3 is installed and the openai-agents package is available');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
