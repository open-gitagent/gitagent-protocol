import { existsSync, readFileSync, readdirSync, cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkillMetadata } from '../utils/skill-loader.js';

/**
 * Merge parent agent content into the current agent directory.
 * Resolution rules per spec Section 15:
 *   - SOUL.md: child replaces parent entirely
 *   - RULES.md: child rules append to parent rules (union)
 *   - skills/, tools/: union with child shadowing parent on name collision
 *   - memory/: isolated per agent (not inherited)
 */
function mergeParentContent(agentDir: string, parentDir: string): {
  mergedSoul: string | null;
  mergedRules: string | null;
} {
  const childSoul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  const parentSoul = loadFileIfExists(join(parentDir, 'SOUL.md'));

  const childRules = loadFileIfExists(join(agentDir, 'RULES.md'));
  const parentRules = loadFileIfExists(join(parentDir, 'RULES.md'));

  // SOUL.md: child replaces parent entirely; fall back to parent if child has none
  const mergedSoul = childSoul ?? parentSoul;

  // RULES.md: union — parent first, then child appended
  let mergedRules: string | null = null;
  if (parentRules && childRules) {
    mergedRules = parentRules + '\n\n' + childRules;
  } else {
    mergedRules = childRules ?? parentRules;
  }

  // skills/: copy parent skills that don't exist in child
  const parentSkillsDir = join(parentDir, 'skills');
  const childSkillsDir = join(agentDir, 'skills');
  if (existsSync(parentSkillsDir)) {
    mkdirSync(childSkillsDir, { recursive: true });
    const parentSkills = readdirSync(parentSkillsDir, { withFileTypes: true });
    for (const entry of parentSkills) {
      if (!entry.isDirectory()) continue;
      const childSkillPath = join(childSkillsDir, entry.name);
      if (!existsSync(childSkillPath)) {
        cpSync(join(parentSkillsDir, entry.name), childSkillPath, { recursive: true });
      }
    }
  }

  return { mergedSoul, mergedRules };
}

export function exportToClaudeCode(dir: string): string {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  // Check for installed parent agent (extends)
  const parentDir = join(agentDir, '.gitagent', 'parent');
  const hasParent = existsSync(parentDir) && existsSync(join(parentDir, 'agent.yaml'));

  let soul: string | null;
  let rules: string | null;

  if (hasParent) {
    const merged = mergeParentContent(agentDir, parentDir);
    soul = merged.mergedSoul;
    rules = merged.mergedRules;
  } else {
    soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
    rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  }

  // Build CLAUDE.md content
  const parts: string[] = [];

  parts.push(`# ${manifest.name}`);
  parts.push(`${manifest.description}\n`);

  // SOUL.md → identity section
  if (soul) {
    parts.push(soul);
  }

  // RULES.md → constraints section
  if (rules) {
    parts.push(rules);
  }

  // DUTIES.md → segregation of duties policy
  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
  }

  // Skills — loaded via skill-loader (metadata only for progressive disclosure)
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkillMetadata(skillsDir);
  if (skills.length > 0) {
    const skillParts: string[] = ['## Skills\n'];
    for (const skill of skills) {
      const skillDirName = skill.directory.split('/').pop()!;
      skillParts.push(`### ${skill.name}`);
      skillParts.push(skill.description);
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        skillParts.push(`Allowed tools: ${skill.allowedTools.join(', ')}`);
      }
      skillParts.push(`Full instructions: \`skills/${skillDirName}/SKILL.md\``);
      skillParts.push('');
    }
    parts.push(skillParts.join('\n'));
  }

  // Model preferences as comments
  if (manifest.model?.preferred) {
    parts.push(`<!-- Model: ${manifest.model.preferred} -->`);
  }

  // Compliance constraints
  if (manifest.compliance) {
    const c = manifest.compliance;
    const complianceParts: string[] = ['## Compliance\n'];

    if (c.risk_tier) {
      complianceParts.push(`Risk Tier: ${c.risk_tier.toUpperCase()}`);
    }
    if (c.frameworks) {
      complianceParts.push(`Frameworks: ${c.frameworks.join(', ')}`);
    }
    if (c.supervision?.human_in_the_loop === 'always') {
      complianceParts.push('\n**All decisions require human approval.**');
    }
    if (c.communications?.fair_balanced) {
      complianceParts.push('- All outputs must be fair and balanced (FINRA 2210)');
    }
    if (c.communications?.no_misleading) {
      complianceParts.push('- Never make misleading or exaggerated statements');
    }
    if (c.data_governance?.pii_handling === 'redact') {
      complianceParts.push('- Redact all PII from outputs');
    }
    if (c.recordkeeping?.audit_logging) {
      complianceParts.push('- All actions are audit-logged');
    }

    if (c.segregation_of_duties) {
      const sod = c.segregation_of_duties;
      complianceParts.push('\n### Segregation of Duties');
      complianceParts.push(`Enforcement: ${sod.enforcement ?? 'strict'}`);
      if (sod.assignments) {
        complianceParts.push('\nRole assignments:');
        for (const [agent, roles] of Object.entries(sod.assignments)) {
          complianceParts.push(`- ${agent}: ${roles.join(', ')}`);
        }
      }
      if (sod.conflicts) {
        complianceParts.push('\nConflict rules (must not be same agent):');
        for (const [a, b] of sod.conflicts) {
          complianceParts.push(`- ${a} <-> ${b}`);
        }
      }
      if (sod.handoffs) {
        complianceParts.push('\nRequired handoffs:');
        for (const h of sod.handoffs) {
          complianceParts.push(`- ${h.action}: ${h.required_roles.join(' → ')}`);
        }
      }
      if (sod.isolation?.state === 'full') {
        complianceParts.push('- Agent state is fully isolated per role');
      }
      if (sod.isolation?.credentials === 'separate') {
        complianceParts.push('- Credentials are segregated per role');
      }
    }

    parts.push(complianceParts.join('\n'));
  }

  // Knowledge (always_load)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };

    if (index.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      for (const doc of alwaysLoad) {
        const content = loadFileIfExists(join(knowledgeDir, doc.path));
        if (content) {
          parts.push(`## Reference: ${doc.path}\n${content}`);
        }
      }
    }
  }

  return parts.join('\n\n');
}
