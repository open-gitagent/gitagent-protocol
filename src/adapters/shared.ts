import { loadAgentManifest, type AgentManifest } from '../utils/loader.js';

/**
 * Build a markdown compliance constraints section from a gitagent manifest.
 * Shared across adapters that emit markdown instructions.
 */
export function buildComplianceSection(compliance: NonNullable<ReturnType<typeof loadAgentManifest>['compliance']>): string {
  const c = compliance;
  const constraints: string[] = [];

  if (c.supervision?.human_in_the_loop === 'always') {
    constraints.push('- All decisions require human approval before execution');
  }
  if (c.supervision?.escalation_triggers) {
    constraints.push('- Escalate to human supervisor when:');
    for (const trigger of c.supervision.escalation_triggers) {
      for (const [key, value] of Object.entries(trigger)) {
        constraints.push(`  - ${key}: ${value}`);
      }
    }
  }
  if (c.communications?.fair_balanced) {
    constraints.push('- All communications must be fair and balanced (FINRA 2210)');
  }
  if (c.communications?.no_misleading) {
    constraints.push('- Never make misleading, exaggerated, or promissory statements');
  }
  if (c.data_governance?.pii_handling === 'redact') {
    constraints.push('- Redact all PII from outputs');
  }
  if (c.data_governance?.pii_handling === 'prohibit') {
    constraints.push('- Do not process any personally identifiable information');
  }

  if (c.segregation_of_duties) {
    const sod = c.segregation_of_duties;
    constraints.push('- Segregation of duties is enforced:');
    if (sod.assignments) {
      for (const [agentName, roles] of Object.entries(sod.assignments)) {
        constraints.push(`  - Agent "${agentName}" has role(s): ${roles.join(', ')}`);
      }
    }
    if (sod.conflicts) {
      constraints.push('- Duty separation rules (no single agent may hold both):');
      for (const [a, b] of sod.conflicts) {
        constraints.push(`  - ${a} and ${b}`);
      }
    }
    if (sod.handoffs) {
      constraints.push('- The following actions require multi-agent handoff:');
      for (const h of sod.handoffs) {
        constraints.push(`  - ${h.action}: must pass through roles ${h.required_roles.join(' → ')}${h.approval_required !== false ? ' (approval required)' : ''}`);
      }
    }
    if (sod.isolation?.state === 'full') {
      constraints.push('- Agent state/memory is fully isolated per role');
    }
    if (sod.isolation?.credentials === 'separate') {
      constraints.push('- Credentials are segregated per role');
    }
if (sod.enforcement === 'strict') {
      constraints.push('- SOD enforcement is STRICT — violations will block execution');
    }
  }

  // Financial governance constraints
  if (c.financial_governance?.enabled) {
    const fg = c.financial_governance;
    constraints.push('- Financial governance is enforced:');
    if (fg.spending?.max_per_transaction_cents) {
      constraints.push(`  - Maximum per transaction: ${fg.spending.max_per_transaction_cents} cents`);
    }
    if (fg.spending?.max_monthly_cents) {
      constraints.push(`  - Maximum monthly spend: ${fg.spending.max_monthly_cents} cents`);
    }
    if (fg.spending?.allowed_categories && fg.spending.allowed_categories.length > 0) {
      constraints.push(`  - Allowed categories: ${fg.spending.allowed_categories.join(', ')}`);
    }
    if (fg.spending?.blocked_categories && fg.spending.blocked_categories.length > 0) {
      constraints.push(`  - Blocked categories: ${fg.spending.blocked_categories.join(', ')}`);
    }
    if (fg.approval?.require_above_cents !== undefined) {
      constraints.push(`  - Human approval required above: ${fg.approval.require_above_cents} cents`);
    }
    if (fg.approval?.auto_deny_on_timeout) {
      constraints.push('  - Unanswered approval requests are automatically DENIED');
    }
    if (fg.firewall) {
      constraints.push(`  - Financial firewall: ${fg.firewall}`);
    }
  }

  if (constraints.length === 0) return '';
  return `## Compliance Constraints\n\n${constraints.join('\n')}`;
}

/**
 * Convert agent.yaml mcp_servers to the standard mcpServers JSON format
 * used by Claude Code, Cursor, Gemini, Codex, and OpenCode.
 */
export function buildMcpServersConfig(
  mcpServers?: AgentManifest['mcp_servers'],
): Record<string, unknown> | null {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return null;

  const result: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    const entry: Record<string, unknown> = {};
    if (config.command) {
      entry.command = config.command;
      if (config.args) entry.args = config.args;
    }
    if (config.url) {
      entry.url = config.url;
      if (config.headers) entry.headers = config.headers;
    }
    if (config.env) entry.env = config.env;
    result[name] = entry;
  }
  return result;
}

/**
 * Build a markdown documentation section for MCP servers.
 * Used by adapters without native MCP config support.
 */
export function buildMcpServersMarkdown(
  mcpServers?: AgentManifest['mcp_servers'],
): string {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return '';

  const parts: string[] = ['## MCP Servers\n'];
  for (const [name, config] of Object.entries(mcpServers)) {
    parts.push(`### ${name}`);
    if (config.command) {
      const cmd = config.args
        ? `${config.command} ${config.args.join(' ')}`
        : config.command;
      parts.push(`- Type: stdio`);
      parts.push(`- Command: \`${cmd}\``);
    }
    if (config.url) {
      parts.push(`- Type: HTTP`);
      parts.push(`- URL: ${config.url}`);
    }
    if (config.env && Object.keys(config.env).length > 0) {
      parts.push(`- Environment: ${Object.keys(config.env).join(', ')}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}
