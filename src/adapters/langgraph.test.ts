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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDir(opts: {
  name?: string;
  description?: string;
  soul?: string;
  rules?: string;
  model?: string;
  compliance?: string;
  skills?: Array<{ name: string; description: string; instructions: string }>;
  tools?: Array<{ name: string; description: string; params?: Record<string, string> }>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-langgraph-test-'));

  const modelBlock = opts.model
    ? `model:\n  preferred: ${opts.model}\n`
    : '';

  const complianceBlock = opts.compliance ?? '';

  writeFileSync(
    join(dir, 'agent.yaml'),
    [
      `spec_version: '0.1.0'`,
      `name: ${opts.name ?? 'test-agent'}`,
      `version: '0.1.0'`,
      `description: '${opts.description ?? 'A test agent'}'`,
      modelBlock,
      complianceBlock,
    ].join('\n'),
    'utf-8',
  );

  if (opts.soul !== undefined) {
    writeFileSync(join(dir, 'SOUL.md'), opts.soul, 'utf-8');
  }

  if (opts.rules !== undefined) {
    writeFileSync(join(dir, 'RULES.md'), opts.rules, 'utf-8');
  }

  if (opts.skills) {
    for (const skill of opts.skills) {
      const skillDir = join(dir, 'skills', skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: '${skill.description}'\n---\n\n${skill.instructions}\n`,
        'utf-8',
      );
    }
  }

  if (opts.tools) {
    const toolsDir = join(dir, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    for (const t of opts.tools) {
      const propLines = t.params
        ? Object.entries(t.params).map(([k, v]) => `    ${k}:\n      type: ${v}`).join('\n')
        : '';
      const schemaBlock = propLines
        ? `input_schema:\n  properties:\n${propLines}\n  required: [${Object.keys(t.params ?? {}).join(', ')}]`
        : '';
      writeFileSync(
        join(toolsDir, `${t.name}.yaml`),
        `name: ${t.name}\ndescription: '${t.description}'\n${schemaBlock}\n`,
        'utf-8',
      );
    }
  }

  return dir;
}

// ---------------------------------------------------------------------------
// exportToLangGraph
// ---------------------------------------------------------------------------

describe('exportToLangGraph', () => {
  test('returns agentPy, requirements, and envExample', () => {
    const dir = makeAgentDir({ name: 'my-agent', description: 'My test agent' });
    const result = exportToLangGraph(dir);
    assert.ok(typeof result.agentPy === 'string');
    assert.ok(typeof result.requirements === 'string');
    assert.ok(typeof result.envExample === 'string');
  });

  test('agentPy contains agent name and description', () => {
    const dir = makeAgentDir({ name: 'demo-agent', description: 'Demo description' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /demo-agent/);
    assert.match(agentPy, /Demo description/);
  });

  test('agentPy includes SOUL.md content in system prompt', () => {
    const dir = makeAgentDir({ soul: 'Be helpful and precise.' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /Be helpful and precise/);
  });

  test('agentPy includes RULES.md content in system prompt', () => {
    const dir = makeAgentDir({ rules: 'Never share credentials.' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /Never share credentials/);
  });

  test('agentPy includes skill content in system prompt', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'web-search', description: 'Search the web', instructions: 'Use the search tool.' },
      ],
    });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /web-search/);
    assert.match(agentPy, /Use the search tool/);
  });

  test('agentPy imports ChatAnthropic for claude models', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4-5' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /ChatAnthropic/);
    assert.match(agentPy, /claude-opus-4-5/);
  });

  test('agentPy imports ChatOpenAI for gpt models', () => {
    const dir = makeAgentDir({ model: 'gpt-4o' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /ChatOpenAI/);
    assert.match(agentPy, /gpt-4o/);
  });

  test('agentPy imports ChatGoogleGenerativeAI for gemini models', () => {
    const dir = makeAgentDir({ model: 'gemini-2.0-flash' });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /ChatGoogleGenerativeAI/);
    assert.match(agentPy, /gemini-2.0-flash/);
  });

  test('agentPy wires StateGraph with agent node and END', () => {
    const dir = makeAgentDir({});
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /StateGraph/);
    assert.match(agentPy, /agent_node/);
    assert.match(agentPy, /should_continue/);
    assert.match(agentPy, /build_graph/);
  });

  test('agentPy includes ToolNode when tools are defined', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'my-tool', description: 'Does something', params: { query: 'string' } }],
    });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /ToolNode/);
    assert.match(agentPy, /my_tool/);
  });

  test('agentPy includes HITL node for human_in_the_loop: always', () => {
    const dir = makeAgentDir({
      compliance: 'compliance:\n  supervision:\n    human_in_the_loop: always',
    });
    const { agentPy } = exportToLangGraph(dir);
    assert.match(agentPy, /human_review_node/);
    assert.match(agentPy, /Approve\?/);
  });

  test('agentPy does NOT include HITL node when human_in_the_loop is none', () => {
    const dir = makeAgentDir({
      compliance: 'compliance:\n  supervision:\n    human_in_the_loop: none',
    });
    const { agentPy } = exportToLangGraph(dir);
    assert.doesNotMatch(agentPy, /human_review_node/);
  });

  test('requirements includes langgraph', () => {
    const dir = makeAgentDir({});
    const { requirements } = exportToLangGraph(dir);
    assert.match(requirements, /langgraph/);
    assert.match(requirements, /langchain-core/);
  });

  test('requirements includes langchain-anthropic for claude models', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4-5' });
    const { requirements } = exportToLangGraph(dir);
    assert.match(requirements, /langchain-anthropic/);
  });

  test('requirements includes langchain-openai for gpt models', () => {
    const dir = makeAgentDir({ model: 'gpt-4o' });
    const { requirements } = exportToLangGraph(dir);
    assert.match(requirements, /langchain-openai/);
  });

  test('envExample includes ANTHROPIC_API_KEY for claude models', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4-5' });
    const { envExample } = exportToLangGraph(dir);
    assert.match(envExample, /ANTHROPIC_API_KEY/);
  });

  test('envExample includes OPENAI_API_KEY for gpt models', () => {
    const dir = makeAgentDir({ model: 'gpt-4o' });
    const { envExample } = exportToLangGraph(dir);
    assert.match(envExample, /OPENAI_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangGraphString
// ---------------------------------------------------------------------------

describe('exportToLangGraphString', () => {
  test('contains agent.py, requirements.txt, and .env.example section headers', () => {
    const dir = makeAgentDir({ name: 'str-agent', description: 'String export test' });
    const result = exportToLangGraphString(dir);
    assert.match(result, /=== agent\.py ===/);
    assert.match(result, /=== requirements\.txt ===/);
    assert.match(result, /=== \.env\.example ===/);
  });

  test('contains agent name in output', () => {
    const dir = makeAgentDir({ name: 'string-agent', description: 'desc' });
    const result = exportToLangGraphString(dir);
    assert.match(result, /string-agent/);
  });
});
