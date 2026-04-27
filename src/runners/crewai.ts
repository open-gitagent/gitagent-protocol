import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToCrewAI } from '../adapters/crewai.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface CrewAIRunOptions {
  workspace?: string;
}

export function runWithCrewAI(agentDir: string, _manifest: AgentManifest, options: CrewAIRunOptions = {}): void {
  const config = exportToCrewAI(agentDir);
  const tmpFile = join(tmpdir(), `gitagent-${randomBytes(4).toString('hex')}.yaml`);

  writeFileSync(tmpFile, config, 'utf-8');

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Running CrewAI agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    const result = spawnSync('crewai', ['kickoff', '--config', tmpFile], {
      stdio: 'inherit',
      cwd: runCwd,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run CrewAI: ${result.error.message}`);
      info('Make sure the crewai CLI is installed: pip install crewai');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
