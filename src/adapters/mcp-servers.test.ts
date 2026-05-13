/**
 * Tests for MCP server definitions in agent.yaml exports.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMcpServersConfig, buildMcpServersMarkdown } from './shared.js';
import { exportToCodex } from './codex.js';
import { exportToClaudeCode } from './claude-code.js';
import { exportToCursor } from './cursor.js';
import { exportToGemini } from './gemini.js';
import { exportToOpenCode } from './opencode.js';
import { exportToSystemPrompt } from './system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STDIO_SERVER = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-postgres'],
  env: { DATABASE_URL: '${DATABASE_URL}' },
};

const HTTP_SERVER = {
  url: 'https://mcp.example.com/sse',
  headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
};

function makeAgentDir(opts: {
  name?: string;
  mcpServers?: Record<string, unknown>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-mcp-test-'));

  const mcpBlock = opts.mcpServers
    ? `mcp_servers:\n${Object.entries(opts.mcpServers)
        .map(([name, config]) => {
          const c = config as Record<string, unknown>;
          let block = `  ${name}:\n`;
          if (c.command) block += `    command: ${c.command}\n`;
          if (c.args) block += `    args:\n${(c.args as string[]).map(a => `      - '${a}'`).join('\n')}\n`;
          if (c.env) {
            block += `    env:\n`;
            for (const [k, v] of Object.entries(c.env as Record<string, string>)) {
              block += `      ${k}: '${v}'\n`;
            }
          }
          if (c.url) block += `    url: '${c.url}'\n`;
          if (c.headers) {
            block += `    headers:\n`;
            for (const [k, v] of Object.entries(c.headers as Record<string, string>)) {
              block += `      ${k}: '${v}'\n`;
            }
          }
          return block;
        })
        .join('')}`
    : '';

  writeFileSync(
    join(dir, 'agent.yaml'),
    `spec_version: '0.1.0'\nname: ${opts.name ?? 'test-agent'}\nversion: '0.1.0'\ndescription: 'A test agent'\n${mcpBlock}`,
    'utf-8',
  );

  writeFileSync(join(dir, 'SOUL.md'), '# Test Agent\nA test agent soul.', 'utf-8');

  return dir;
}

// ---------------------------------------------------------------------------
// buildMcpServersConfig
// ---------------------------------------------------------------------------

describe('buildMcpServersConfig', () => {
  test('returns null for undefined input', () => {
    assert.equal(buildMcpServersConfig(undefined), null);
  });

  test('returns null for empty object', () => {
    assert.equal(buildMcpServersConfig({}), null);
  });

  test('maps stdio server correctly', () => {
    const result = buildMcpServersConfig({ 'my-db': STDIO_SERVER });
    assert.ok(result);
    const entry = result['my-db'] as Record<string, unknown>;
    assert.equal(entry.command, 'npx');
    assert.deepEqual(entry.args, ['-y', '@modelcontextprotocol/server-postgres']);
    assert.deepEqual(entry.env, { DATABASE_URL: '${DATABASE_URL}' });
    assert.equal(entry.url, undefined);
  });

  test('maps HTTP server correctly', () => {
    const result = buildMcpServersConfig({ remote: HTTP_SERVER });
    assert.ok(result);
    const entry = result['remote'] as Record<string, unknown>;
    assert.equal(entry.url, 'https://mcp.example.com/sse');
    assert.deepEqual(entry.headers, { Authorization: 'Bearer ${MCP_TOKEN}' });
    assert.equal(entry.command, undefined);
  });

  test('handles multiple servers', () => {
    const result = buildMcpServersConfig({
      db: STDIO_SERVER,
      remote: HTTP_SERVER,
    });
    assert.ok(result);
    assert.ok(result['db']);
    assert.ok(result['remote']);
  });
});

// ---------------------------------------------------------------------------
// buildMcpServersMarkdown
// ---------------------------------------------------------------------------

describe('buildMcpServersMarkdown', () => {
  test('returns empty string for undefined input', () => {
    assert.equal(buildMcpServersMarkdown(undefined), '');
  });

  test('returns empty string for empty object', () => {
    assert.equal(buildMcpServersMarkdown({}), '');
  });

  test('includes server name and type for stdio server', () => {
    const result = buildMcpServersMarkdown({ 'my-db': STDIO_SERVER });
    assert.match(result, /### my-db/);
    assert.match(result, /Type: stdio/);
    assert.match(result, /npx/);
  });

  test('includes server name and type for HTTP server', () => {
    const result = buildMcpServersMarkdown({ remote: HTTP_SERVER });
    assert.match(result, /### remote/);
    assert.match(result, /Type: HTTP/);
    assert.match(result, /mcp\.example\.com/);
  });

  test('includes environment variable names', () => {
    const result = buildMcpServersMarkdown({ db: STDIO_SERVER });
    assert.match(result, /DATABASE_URL/);
  });
});

// ---------------------------------------------------------------------------
// Tier 1 adapter integration tests
// ---------------------------------------------------------------------------

describe('Tier 1 adapters: MCP config in structured output', () => {
  test('Codex: mcpServers in config when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { db: STDIO_SERVER } });
    const { config } = exportToCodex(dir);
    assert.ok(config.mcpServers);
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.db.command, 'npx');
  });

  test('Codex: no mcpServers in config when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const { config } = exportToCodex(dir);
    assert.equal(config.mcpServers, undefined);
  });

  test('Claude Code: mcpConfig populated when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { remote: HTTP_SERVER } });
    const result = exportToClaudeCode(dir);
    assert.ok(result.mcpConfig);
    const servers = (result.mcpConfig as Record<string, unknown>).mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.remote.url, 'https://mcp.example.com/sse');
  });

  test('Claude Code: mcpConfig is null when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const result = exportToClaudeCode(dir);
    assert.equal(result.mcpConfig, null);
  });

  test('Cursor: mcpConfig populated when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { db: STDIO_SERVER } });
    const result = exportToCursor(dir);
    assert.ok(result.mcpConfig);
    const servers = (result.mcpConfig as Record<string, unknown>).mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.db.command, 'npx');
  });

  test('Cursor: mcpConfig is null when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const result = exportToCursor(dir);
    assert.equal(result.mcpConfig, null);
  });

  test('Gemini: settings.mcpServers populated when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { db: STDIO_SERVER } });
    const { settings } = exportToGemini(dir);
    const servers = settings.mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.db.command, 'npx');
  });

  test('Gemini: settings.mcpServers is empty object when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const { settings } = exportToGemini(dir);
    assert.deepEqual(settings.mcpServers, {});
  });

  test('OpenCode: mcpServers in config when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { remote: HTTP_SERVER } });
    const { config } = exportToOpenCode(dir);
    assert.ok(config.mcpServers);
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.remote.url, 'https://mcp.example.com/sse');
  });

  test('OpenCode: no mcpServers in config when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const { config } = exportToOpenCode(dir);
    assert.equal(config.mcpServers, undefined);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 adapter integration tests
// ---------------------------------------------------------------------------

describe('Tier 2 adapters: MCP servers in markdown output', () => {
  test('system-prompt includes MCP section when mcp_servers defined', () => {
    const dir = makeAgentDir({ mcpServers: { db: STDIO_SERVER } });
    const result = exportToSystemPrompt(dir);
    assert.match(result, /MCP Servers/);
    assert.match(result, /my-db|db/);
  });

  test('system-prompt omits MCP section when mcp_servers absent', () => {
    const dir = makeAgentDir({});
    const result = exportToSystemPrompt(dir);
    assert.ok(!result.includes('MCP Servers'));
  });
});
