/**
 * Tests for the LangGraph adapter (export).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { exportToLangGraph, exportToLangGraphString } from './langgraph.js';

// Helpers

interface MakeAgentDirOpts {
  name?: string;
  description?: string;
  version?: string;
  soul?: string;
  rules?: string;
  duties?: string;
  model?: string;
  maxTurns?: number;
  skills?: Array<{ name: string; description: string; instructions: string; allowedTools?: string }>;
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  skillflows?: Array<{ filename?: string; name?: string; steps: Array<Record<string, unknown>> }>;
  hooks?: Record<string, Array<{ script: string }>>;
  subAgents?: string[];
}

function makeAgentDir(opts: MakeAgentDirOpts): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-langgraph-test-'));

  const modelBlock = opts.model ? `model:\n  preferred: ${opts.model}\n` : '';
  const runtimeBlock = opts.maxTurns !== undefined ? `runtime:\n  max_turns: ${opts.maxTurns}\n` : '';

  writeFileSync(
    join(dir, 'agent.yaml'),
    `spec_version: '0.1.0'\nname: ${opts.name ?? 'test-agent'}\nversion: '${opts.version ?? '0.1.0'}'\ndescription: '${opts.description ?? 'A test agent'}'\n${modelBlock}${runtimeBlock}`,
    'utf-8',
  );

  if (opts.soul !== undefined) writeFileSync(join(dir, 'SOUL.md'), opts.soul, 'utf-8');
  if (opts.rules !== undefined) writeFileSync(join(dir, 'RULES.md'), opts.rules, 'utf-8');
  if (opts.duties !== undefined) writeFileSync(join(dir, 'DUTIES.md'), opts.duties, 'utf-8');

  if (opts.skills) {
    for (const skill of opts.skills) {
      const skillDir = join(dir, 'skills', skill.name);
      mkdirSync(skillDir, { recursive: true });
      const allowed = skill.allowedTools ? `allowed-tools: ${skill.allowedTools}\n` : '';
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: '${skill.description}'\n${allowed}---\n\n${skill.instructions}\n`,
        'utf-8',
      );
    }
  }

  if (opts.tools) {
    const toolsDir = join(dir, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    for (const tool of opts.tools) {
      const lines = [
        `name: ${tool.name}`,
        `description: '${tool.description ?? ''}'`,
      ];
      if (tool.inputSchema) {
        const fmtSchema = JSON.stringify(tool.inputSchema)
          .replace(/"/g, '"');
        lines.push(`input_schema: ${fmtSchema}`);
      }
      writeFileSync(join(toolsDir, `${tool.name}.yaml`), lines.join('\n') + '\n', 'utf-8');
    }
  }

  if (opts.skillflows) {
    const flowsDir = join(dir, 'skillflows');
    mkdirSync(flowsDir, { recursive: true });
    for (const flow of opts.skillflows) {
      const filename = flow.filename ?? `${flow.name ?? 'flow'}.yaml`;
      const body: Record<string, unknown> = { steps: flow.steps };
      if (flow.name) body.name = flow.name;
      writeFileSync(join(flowsDir, filename), toYaml(body), 'utf-8');
    }
  }

  if (opts.hooks) {
    const hooksDir = join(dir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const lines: string[] = ['hooks:'];
    for (const [event, entries] of Object.entries(opts.hooks)) {
      lines.push(`  ${event}:`);
      for (const entry of entries) {
        lines.push(`    - script: ${entry.script}`);
      }
    }
    writeFileSync(join(hooksDir, 'hooks.yaml'), lines.join('\n') + '\n', 'utf-8');
  }

  if (opts.subAgents) {
    for (const subName of opts.subAgents) {
      const subDir = join(dir, 'agents', subName);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'agent.yaml'),
        `spec_version: '0.1.0'\nname: ${subName}\nversion: '0.1.0'\ndescription: 'Sub-agent ${subName}'\n`,
        'utf-8',
      );
    }
  }

  return dir;
}

/** Minimal recursive YAML emitter for the structured test fixtures used above. */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item !== null && typeof item === 'object') {
        const inner = toYaml(item, indent + 1).trimStart();
        return `${pad}- ${inner}`;
      }
      return `${pad}- ${formatScalar(item)}`;
    }).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      if (Array.isArray(v) || (v !== null && typeof v === 'object')) {
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${formatScalar(v)}`;
    }).join('\n');
  }
  return `${pad}${formatScalar(value)}`;
}

function formatScalar(v: unknown): string {
  if (typeof v === 'string') return v.includes(' ') || v.includes(':') ? `'${v.replace(/'/g, "''")}'` : v;
  if (v === null || v === undefined) return 'null';
  return String(v);
}


describe('exportToLangGraph', () => {
  test('returns { code: string }', () => {
    const dir = makeAgentDir({ name: 'demo-agent', description: 'Demo description' });
    const result = exportToLangGraph(dir);
    assert.equal(typeof result.code, 'string');
    assert.ok(result.code.length > 0);
  });

  test('output is a valid Python module shape (StateGraph + compile())', () => {
    const dir = makeAgentDir({ name: 'demo-agent', description: 'Demo' });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /StateGraph/);
    assert.match(code, /\.compile\(\)/);
  });

  test('imports the LangGraph constants used in the body', () => {
    const dir = makeAgentDir({});
    const { code } = exportToLangGraph(dir);
    assert.match(code, /from langgraph\.graph import .*StateGraph/);
    assert.match(code, /from langgraph\.prebuilt import ToolNode/);
  });

  test('embeds SOUL.md content into the generated Python', () => {
    const dir = makeAgentDir({ soul: '# Soul\n\nBe precise and helpful.' });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /Be precise and helpful/);
  });

  test('embeds RULES.md content into the generated Python', () => {
    const dir = makeAgentDir({ soul: '# Soul', rules: '# Rules\n\nNever share credentials.' });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /Never share credentials/);
  });

  test('embeds DUTIES.md content into the generated Python', () => {
    const dir = makeAgentDir({ duties: '# Duties\n\nOnly the maker may submit.' });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /Only the maker may submit/);
  });

  test('each skill name appears as a node function', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'web-search', description: 'Search the web', instructions: 'Use the search tool.' },
        { name: 'summarize', description: 'Summarize text', instructions: 'Condense the input.' },
      ],
    });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /def skill_web_search\(state:/);
    assert.match(code, /def skill_summarize\(state:/);
  });

  test('skill instructions appear as Python constants', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'web-search', description: 'Search the web', instructions: 'Use the search tool.' },
      ],
    });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /SKILL_WEB_SEARCH_INSTRUCTIONS\s*=/);
    assert.match(code, /Use the search tool/);
  });

  test('skillflow with depends_on produces correct add_edge calls', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'classify', description: 'Classify', instructions: 'classify body' },
        { name: 'analyze', description: 'Analyze', instructions: 'analyze body' },
        { name: 'report', description: 'Report', instructions: 'report body' },
      ],
      skillflows: [
        {
          name: 'review',
          steps: [
            { id: 'classify', skill: 'classify' },
            { id: 'analyze', skill: 'analyze', depends_on: ['classify'] },
            { id: 'report', skill: 'report', depends_on: ['analyze'] },
          ],
        },
      ],
    });
    const { code } = exportToLangGraph(dir);
    // The root step (no depends_on) is wired from START.
    assert.match(code, /graph\.add_edge\(START, "classify"\)/);
    // depends_on chain → add_edge(parent, child)
    assert.match(code, /graph\.add_edge\("classify", "analyze"\)/);
    assert.match(code, /graph\.add_edge\("analyze", "report"\)/);
    // Terminal step is wired to END.
    assert.match(code, /graph\.add_edge\("report", END\)/);
    // Skill steps are registered as nodes pointed at their skill_<name> handler.
    assert.match(code, /graph\.add_node\("classify", skill_classify\)/);
    assert.match(code, /graph\.add_node\("analyze", skill_analyze\)/);
  });

  test('fan-in (multiple depends_on) uses add_conditional_edges', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'a', description: 'A', instructions: 'a body' },
        { name: 'b', description: 'B', instructions: 'b body' },
        { name: 'join', description: 'Join', instructions: 'join body' },
      ],
      skillflows: [
        {
          name: 'fanin',
          steps: [
            { id: 'a', skill: 'a' },
            { id: 'b', skill: 'b' },
            { id: 'join', skill: 'join', depends_on: ['a', 'b'] },
          ],
        },
      ],
    });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /add_conditional_edges/);
    assert.match(code, /graph\.add_edge\("b", "join"\)/);
  });

  test('tools/*.yaml produces ToolNode([...]) bindings', () => {
    const dir = makeAgentDir({
      tools: [
        { name: 'search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      ],
    });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /@tool/);
    assert.match(code, /def search\(query: str\) -> str:/);
    assert.match(code, /TOOLS = \[search\]/);
    assert.match(code, /tool_node = ToolNode\(TOOLS\)/);
  });

  test('pre_tool_use hooks produce a before_tool callback', () => {
    const dir = makeAgentDir({
      hooks: {
        pre_tool_use: [{ script: 'audit.sh' }],
      },
    });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /def before_tool\(state: AgentState\) -> AgentState:/);
    assert.match(code, /hooks\/audit\.sh/);
  });

  test('sub-agents (agents/<name>/) emit nested compiled StateGraphs', () => {
    const dir = makeAgentDir({ subAgents: ['fact-checker'] });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /fact_checker_subgraph/);
    assert.match(code, /sub\.compile\(\)/);
  });

  test('model.preferred is emitted as MODEL', () => {
    const dir = makeAgentDir({ model: 'claude-sonnet-4-5' });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /MODEL = "claude-sonnet-4-5"/);
  });

  test('runtime.max_turns becomes RECURSION_LIMIT', () => {
    const dir = makeAgentDir({ maxTurns: 42 });
    const { code } = exportToLangGraph(dir);
    assert.match(code, /RECURSION_LIMIT = 42/);
  });

  test('default recursion limit is used when max_turns is absent', () => {
    const dir = makeAgentDir({});
    const { code } = exportToLangGraph(dir);
    assert.match(code, /RECURSION_LIMIT = 25/);
  });
});


describe('exportToLangGraphString', () => {
  test('returns the same Python string as exportToLangGraph().code', () => {
    const dir = makeAgentDir({ name: 'parity-agent', description: 'Parity check' });
    assert.equal(exportToLangGraphString(dir), exportToLangGraph(dir).code);
  });

  test('output contains StateGraph and compile()', () => {
    const dir = makeAgentDir({ name: 'string-agent' });
    const code = exportToLangGraphString(dir);
    assert.match(code, /StateGraph/);
    assert.match(code, /compile\(\)/);
  });
});
