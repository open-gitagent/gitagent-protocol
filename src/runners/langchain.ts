import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToLangChain } from '../adapters/langchain.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

interface RunOptions {
  prompt?: string;
}

export function runWithLangChain(agentDir: string, _manifest: AgentManifest, _options: RunOptions = {}): void {
  const script = exportToLangChain(agentDir);
  const tmpFile = join(tmpdir(), `gitagent-langchain-${randomBytes(4).toString('hex')}.py`);

  writeFileSync(tmpFile, script, 'utf-8');

  info(`Running LangChain agent from "${agentDir}"...`);
  info('Make sure langchain, langchain-core, and a model package (langchain-openai / langchain-anthropic) are installed.');

  try {
    const result = spawnSync('python3', [tmpFile], {
      stdio: 'inherit',
      cwd: agentDir,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run Python: ${result.error.message}`);
      info('Install: pip install langchain langchain-core langchain-openai');
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}