import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToLangGraph } from '../adapters/langgraph.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface LangGraphRunOptions {
  prompt?: string;
}

/**
 * Run a gitagent agent using LangGraph.
 *
 * Creates a temporary Python workspace with:
 *   - agent.py          (StateGraph definition)
 *   - requirements.txt  (pip dependencies)
 *   - .env.example      (credential template)
 *
 * Requires Python 3.11+ and pip to be available on PATH.
 * Dependencies are installed into an isolated venv in the workspace.
 *
 * Supports both interactive mode (no prompt) and single-shot mode (`--prompt`).
 */
export function runWithLangGraph(
  agentDir: string,
  manifest: AgentManifest,
  options: LangGraphRunOptions = {},
): void {
  const exp = exportToLangGraph(agentDir);

  // Create a temporary workspace
  const workspaceDir = join(
    tmpdir(),
    `gitagent-langgraph-${randomBytes(4).toString('hex')}`,
  );
  mkdirSync(workspaceDir, { recursive: true });

  // Write generated files
  writeFileSync(join(workspaceDir, 'agent.py'), exp.agentPy, 'utf-8');
  writeFileSync(join(workspaceDir, 'requirements.txt'), exp.requirements, 'utf-8');
  writeFileSync(join(workspaceDir, '.env.example'), exp.envExample, 'utf-8');

  info(`Workspace prepared at ${workspaceDir}`);
  info('  agent.py, requirements.txt, .env.example');
  if (manifest.model?.preferred) {
    info(`  Model: ${manifest.model.preferred}`);
  }

  // Detect python executable (python3 first, then python)
  const pythonBin = detectPython();
  if (!pythonBin) {
    error('Python 3.11+ is required to run LangGraph agents.');
    info('Install from https://python.org or via your package manager.');
    process.exit(1);
  }

  // Create venv and install dependencies
  info('Creating Python virtual environment…');
  const venvDir = join(workspaceDir, '.venv');

  const venvResult = spawnSync(pythonBin, ['-m', 'venv', venvDir], {
    stdio: 'inherit',
    cwd: workspaceDir,
  });
  if (venvResult.error || venvResult.status !== 0) {
    error('Failed to create virtual environment.');
    process.exit(1);
  }

  // pip install
  const pipBin = process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'pip')
    : join(venvDir, 'bin', 'pip');

  info('Installing dependencies (langgraph, langchain-core, …)…');
  const pipResult = spawnSync(pipBin, ['install', '-r', 'requirements.txt', '-q'], {
    stdio: 'inherit',
    cwd: workspaceDir,
  });
  if (pipResult.error || pipResult.status !== 0) {
    error('pip install failed — check your network connection and try again.');
    process.exit(1);
  }

  // Resolve venv python
  const venvPython = process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python')
    : join(venvDir, 'bin', 'python');

  // Build args
  const args: string[] = ['agent.py'];
  if (options.prompt) {
    args.push('--prompt', options.prompt);
  }

  info(`Launching LangGraph agent "${manifest.name}"…`);
  if (!options.prompt) {
    info("Starting interactive mode. Type 'exit' to quit.");
  }

  const result = spawnSync(venvPython, args, {
    stdio: 'inherit',
    cwd: workspaceDir,
    env: { ...process.env },
  });

  // Cleanup
  try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (result.error) {
    error(`Failed to launch LangGraph agent: ${result.error.message}`);
    info('Ensure Python 3.11+ and pip are available on PATH.');
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/Python (\d+)\.(\d+)/);
      if (match && parseInt(match[1], 10) >= 3 && parseInt(match[2], 10) >= 11) {
        return candidate;
      }
    }
  }
  return null;
}
