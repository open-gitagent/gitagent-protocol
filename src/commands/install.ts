import { Command } from 'commander';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadAgentManifest } from '../utils/loader.js';
import { success, error, info, heading, divider, warn } from '../utils/format.js';

interface InstallOptions {
  dir: string;
  force: boolean;
}

function cloneGitRepo(source: string, targetDir: string, version?: string): void {
  const versionFlag = version ? `--branch ${version.replace('^', '')}` : '';
  mkdirSync(join(targetDir, '..'), { recursive: true });
  execSync(`git clone --depth 1 ${versionFlag} "${source}" "${targetDir}" 2>&1`, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

function isGitSource(source: string): boolean {
  return source.endsWith('.git') || source.includes('github.com') || source.includes('bitbucket.org') || source.includes('gitlab.com');
}

function removeIfExists(targetDir: string, force: boolean): boolean {
  if (existsSync(targetDir)) {
    if (!force) {
      warn(`${targetDir} already exists, skipping (use --force to update)`);
      return false;
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  return true;
}

export const installCommand = new Command('install')
  .description('Resolve and install agent dependencies and extends')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('-f, --force', 'Force re-install (remove existing before install)', false)
  .action((options: InstallOptions) => {
    const dir = resolve(options.dir);

    let manifest;
    try {
      manifest = loadAgentManifest(dir);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }

    heading('Installing dependencies');

    const hasExtends = !!manifest.extends;
    const hasDeps = manifest.dependencies && manifest.dependencies.length > 0;

    if (!hasExtends && !hasDeps) {
      info('No dependencies or extends to install');
      return;
    }

    const depsDir = join(dir, '.gitagent', 'deps');
    mkdirSync(depsDir, { recursive: true });

    // Handle extends — clone parent agent
    if (hasExtends) {
      divider();
      const extendsSource = manifest.extends!;
      info(`Installing parent agent from ${extendsSource}`);

      const parentDir = join(dir, '.gitagent', 'parent');

      if (!removeIfExists(parentDir, options.force)) {
        // skipped
      } else if (existsSync(resolve(dir, extendsSource))) {
        // Local extends
        const sourcePath = resolve(dir, extendsSource);
        try {
          mkdirSync(join(parentDir, '..'), { recursive: true });
          execSync(`cp -r "${sourcePath}" "${parentDir}"`, { stdio: 'pipe' });
          success('Installed parent agent (local)');
        } catch (e) {
          error(`Failed to install parent agent: ${(e as Error).message}`);
        }
      } else if (isGitSource(extendsSource)) {
        try {
          cloneGitRepo(extendsSource, parentDir);
          success('Installed parent agent (git)');
        } catch (e) {
          error(`Failed to clone parent agent: ${(e as Error).message}`);
        }
      } else {
        warn(`Unknown source type for extends: ${extendsSource}`);
      }

      // Validate parent
      if (existsSync(join(parentDir, 'agent.yaml'))) {
        success('Parent agent is a valid gitagent');
      } else if (existsSync(parentDir)) {
        warn('Parent agent does not contain agent.yaml');
      }
    }

    // Handle dependencies
    if (hasDeps) {
      for (const dep of manifest.dependencies!) {
        divider();
        info(`Installing ${dep.name} from ${dep.source}`);

        const targetDir = dep.mount
          ? join(dir, dep.mount)
          : join(depsDir, dep.name);

        if (!removeIfExists(targetDir, options.force)) {
          continue;
        }

        // Check if source is a local path
        if (existsSync(resolve(dir, dep.source))) {
          const sourcePath = resolve(dir, dep.source);
          try {
            mkdirSync(join(targetDir, '..'), { recursive: true });
            execSync(`cp -r "${sourcePath}" "${targetDir}"`, { stdio: 'pipe' });
            success(`Installed ${dep.name} (local)`);
          } catch (e) {
            error(`Failed to install ${dep.name}: ${(e as Error).message}`);
          }
        } else if (isGitSource(dep.source)) {
          try {
            cloneGitRepo(dep.source, targetDir, dep.version);
            success(`Installed ${dep.name} (git)`);
          } catch (e) {
            error(`Failed to clone ${dep.name}: ${(e as Error).message}`);
          }
        } else {
          warn(`Unknown source type for ${dep.name}: ${dep.source}`);
        }

        // Validate installed dependency
        const depAgentYaml = join(targetDir, 'agent.yaml');
        if (existsSync(depAgentYaml)) {
          success(`${dep.name} is a valid gitagent`);
        } else {
          warn(`${dep.name} does not contain agent.yaml — may not be a gitagent`);
        }
      }
    }

    divider();
    success('Installation complete');
  });
