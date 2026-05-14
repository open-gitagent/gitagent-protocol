import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools, type ParsedSkill } from '../utils/skill-loader.js';
import { buildComplianceSection } from './shared.js';

/**
 * Export a gitagent to LangGraph Python code.
 *
 * Mapping:
 *   agent.yaml (model.preferred, runtime.max_turns) → StateGraph config + recursion limit
 *   SOUL.md + RULES.md + DUTIES.md                  → system prompt on the agent node
 *   skills/<name>/SKILL.md                          → graph node (def skill_<name>(state))
 *   skillflows/*.yaml (steps, depends_on)           → add_edge / add_conditional_edges
 *   tools/*.yaml                                    → ToolNode([...]) bindings
 *   hooks/hooks.yaml (pre_tool_use)                 → before_tool callback
 *   agents/<name>/                                  → nested compiled StateGraph per sub-agent
 *
 * Reference: https://langchain-ai.github.io/langgraph/
 */
export interface LangGraphExport {
  /** Generated Python source for the LangGraph application. */
  code: string;
}

interface ToolDef {
  name: string;
  description: string;
  params: Array<{ name: string; pyType: string; required: boolean }>;
}

interface FlowStep {
  id: string;
  depends_on?: string[];
  skill?: string;
  agent?: string;
  tool?: string;
  conditions?: unknown[];
  action?: string;
}

interface Skillflow {
  name?: string;
  steps: FlowStep[];
}

export function exportToLangGraph(dir: string): LangGraphExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const systemPrompt = buildInstructions(agentDir, manifest);
  const skills = loadAllSkills(join(agentDir, 'skills'));
  const tools = collectTools(agentDir);
  const flows = collectSkillflows(agentDir);
  const preToolUseScripts = collectPreToolUseHooks(agentDir);
  const subAgents = collectSubAgents(agentDir);

  const code = renderPython({
    manifest,
    systemPrompt,
    skills,
    tools,
    flows,
    preToolUseScripts,
    subAgents,
  });

  return { code };
}

export function exportToLangGraphString(dir: string): string {
  return exportToLangGraph(dir).code;
}

// System prompt assembly (SOUL + RULES + DUTIES + compliance)

function buildInstructions(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const parts: string[] = [];

  parts.push(`# ${manifest.name}`);
  parts.push(manifest.description);
  parts.push('');

  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul.trim());
    parts.push('');
  }

  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules.trim());
    parts.push('');
  }

  const duties = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duties) {
    parts.push(duties.trim());
    parts.push('');
  }

  if (manifest.compliance) {
    const compliance = buildComplianceSection(manifest.compliance);
    if (compliance) {
      parts.push(compliance);
      parts.push('');
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

// Tool / skillflow / hook / sub-agent discovery

function collectTools(agentDir: string): ToolDef[] {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return [];

  const out: ToolDef[] = [];
  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const cfg = yaml.load(content) as {
        name?: string;
        description?: string;
        input_schema?: {
          type?: string;
          properties?: Record<string, { type?: string; description?: string }>;
          required?: string[];
        };
      };
      if (!cfg?.name) continue;

      const props = cfg.input_schema?.properties ?? {};
      const required = new Set(cfg.input_schema?.required ?? []);
      const params = Object.entries(props).map(([name, schema]) => ({
        name,
        pyType: jsonTypeToPython(schema?.type),
        required: required.has(name),
      }));

      out.push({
        name: cfg.name,
        description: cfg.description ?? '',
        params,
      });
    } catch {
      // skip malformed tools
    }
  }
  return out;
}

function collectSkillflows(agentDir: string): Skillflow[] {
  // Primary location per LangGraph adapter spec: skillflows/
  // Also accept workflows/ for backward-compatibility with existing gitagent layouts.
  const dirs = [join(agentDir, 'skillflows'), join(agentDir, 'workflows')];

  const out: Skillflow[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const cfg = yaml.load(content) as { name?: string; steps?: FlowStep[] };
        if (Array.isArray(cfg?.steps) && cfg.steps.length > 0) {
          out.push({ name: cfg.name ?? file.replace(/\.ya?ml$/, ''), steps: cfg.steps });
        }
      } catch {
        // skip malformed flows
      }
    }
  }
  return out;
}

function collectPreToolUseHooks(agentDir: string): string[] {
  const hooksPath = join(agentDir, 'hooks', 'hooks.yaml');
  if (!existsSync(hooksPath)) return [];
  try {
    const cfg = yaml.load(readFileSync(hooksPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ script?: string }>>;
    };
    const entries = cfg?.hooks?.pre_tool_use ?? [];
    return entries.map(h => h.script ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

function collectSubAgents(agentDir: string): string[] {
  const agentsDir = join(agentDir, 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(agentsDir, e.name, 'agent.yaml')))
    .map(e => e.name);
}

// Python code rendering

interface RenderContext {
  manifest: ReturnType<typeof loadAgentManifest>;
  systemPrompt: string;
  skills: ParsedSkill[];
  tools: ToolDef[];
  flows: Skillflow[];
  preToolUseScripts: string[];
  subAgents: string[];
}

function renderPython(ctx: RenderContext): string {
  const { manifest, systemPrompt, skills, tools, flows, preToolUseScripts, subAgents } = ctx;

  const lines: string[] = [];
  const recursionLimit = manifest.runtime?.max_turns ?? 25;
  const model = manifest.model?.preferred ?? 'gpt-4o-mini';

  // Header
  lines.push('"""');
  lines.push(`LangGraph definition for ${manifest.name} v${manifest.version}`);
  lines.push('Generated by gitagent export --format langgraph');
  lines.push('"""');
  lines.push('');

  // Imports
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('from typing import Annotated, TypedDict');
  lines.push('');
  lines.push('from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage');
  lines.push('from langchain_core.tools import tool');
  lines.push('from langchain.chat_models import init_chat_model');
  lines.push('from langgraph.graph import END, START, StateGraph');
  lines.push('from langgraph.graph.message import add_messages');
  lines.push('from langgraph.prebuilt import ToolNode');
  lines.push('');

  // Agent metadata
  lines.push('# Agent metadata');
  lines.push(`AGENT_NAME = ${pyStr(manifest.name)}`);
  lines.push(`AGENT_VERSION = ${pyStr(manifest.version)}`);
  lines.push(`AGENT_DESCRIPTION = ${pyStr(manifest.description)}`);
  lines.push(`MODEL = ${pyStr(model)}`);
  lines.push(`RECURSION_LIMIT = ${recursionLimit}`);
  lines.push('');

  // System prompt
  lines.push('# System prompt (SOUL.md + RULES.md + DUTIES.md + compliance)');
  lines.push(`SYSTEM_PROMPT = ${pyTripleStr(systemPrompt)}`);
  lines.push('');

  // Per-skill instruction constants
  if (skills.length > 0) {
    lines.push('# Skill instructions');
    for (const skill of skills) {
      const constName = `SKILL_${pyIdent(skill.frontmatter.name).toUpperCase()}_INSTRUCTIONS`;
      const allowed = getAllowedTools(skill.frontmatter);
      const allowedNote = allowed.length > 0 ? `\nAllowed tools: ${allowed.join(', ')}` : '';
      const body = `${skill.frontmatter.description}${allowedNote}\n\n${skill.instructions}`;
      lines.push(`${constName} = ${pyTripleStr(body)}`);
      lines.push('');
    }
  }

  // State definition
  lines.push('# Graph state');
  lines.push('class AgentState(TypedDict):');
  lines.push('    messages: Annotated[list[BaseMessage], add_messages]');
  lines.push('');

  // Tool definitions
  lines.push('# Tools (from tools/*.yaml)');
  if (tools.length > 0) {
    for (const t of tools) {
      const fnName = pyIdent(t.name);
      const sig = t.params.length > 0
        ? t.params.map(p => `${pyIdent(p.name)}: ${p.pyType}`).join(', ')
        : '';
      lines.push('@tool');
      lines.push(`def ${fnName}(${sig}) -> str:`);
      lines.push(`    ${pyTripleStr(t.description || `Tool: ${t.name}`)}`);
      lines.push(`    raise NotImplementedError("Implement tool: ${t.name}")`);
      lines.push('');
    }
    const toolList = tools.map(t => pyIdent(t.name)).join(', ');
    lines.push(`TOOLS = [${toolList}]`);
  } else {
    lines.push('# No tools defined in tools/');
    lines.push('TOOLS: list = []');
  }
  lines.push('tool_node = ToolNode(TOOLS)');
  lines.push('');

  // Model binding
  lines.push('llm = init_chat_model(MODEL)');
  lines.push('llm_with_tools = llm.bind_tools(TOOLS) if TOOLS else llm');
  lines.push('');

  // Pre-tool-use hook (before_tool callback)
  lines.push('# Hooks (pre_tool_use → before_tool callback)');
  lines.push('def before_tool(state: AgentState) -> AgentState:');
  if (preToolUseScripts.length > 0) {
    lines.push('    """Pre-tool-use hook — runs the configured hook scripts before any tool call."""');
    lines.push('    import subprocess');
    for (const script of preToolUseScripts) {
      lines.push(`    subprocess.run([${pyStr(`hooks/${script}`)}], check=False)`);
    }
    lines.push('    return state');
  } else {
    lines.push('    """No pre_tool_use hooks configured in hooks/hooks.yaml."""');
    lines.push('    return state');
  }
  lines.push('');
  lines.push('# NOTE: post_tool_use, on_session_start, etc. have no LangGraph equivalent — skipped.');
  lines.push('# NOTE: memory/ has no direct LangGraph equivalent — implement via a checkpointer.');
  lines.push('');

  // Skill node functions
  lines.push('# Skill nodes (one per skills/<name>/SKILL.md)');
  if (skills.length === 0) {
    lines.push('# No skills declared — emitting a single default agent node.');
    lines.push('def agent_node(state: AgentState) -> dict:');
    lines.push('    """Default agent node — uses SYSTEM_PROMPT and the bound LLM."""');
    lines.push('    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]');
    lines.push('    response = llm_with_tools.invoke(messages)');
    lines.push('    return {"messages": [response]}');
    lines.push('');
  } else {
    for (const skill of skills) {
      const fnName = `skill_${pyIdent(skill.frontmatter.name)}`;
      const constName = `SKILL_${pyIdent(skill.frontmatter.name).toUpperCase()}_INSTRUCTIONS`;
      lines.push(`def ${fnName}(state: AgentState) -> dict:`);
      lines.push(`    """Skill node: ${escapeForComment(skill.frontmatter.name)} — ${escapeForComment(skill.frontmatter.description)}"""`);
      lines.push(`    prompt = SYSTEM_PROMPT + "\\n\\n" + ${constName}`);
      lines.push('    messages = [SystemMessage(content=prompt), *state["messages"]]');
      lines.push('    response = llm_with_tools.invoke(messages)');
      lines.push('    return {"messages": [response]}');
      lines.push('');
    }
  }

  // Sub-agent stubs (nested compiled StateGraphs)
  if (subAgents.length > 0) {
    lines.push('# Sub-agents (agents/<name>/) — nested compiled StateGraphs');
    for (const name of subAgents) {
      const ident = pyIdent(name);
      lines.push(`def _build_${ident}_subgraph() -> object:`);
      lines.push(`    """Nested LangGraph for sub-agent '${escapeForComment(name)}'.`);
      lines.push('');
      lines.push(`    Re-export the sub-agent at agents/${name}/ via gitagent and wire its compiled`);
      lines.push('    StateGraph into this function. Returning the parent llm as a placeholder.');
      lines.push('    """');
      lines.push('    sub = StateGraph(AgentState)');
      lines.push('    def _passthrough(state: AgentState) -> dict:');
      lines.push('        messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]');
      lines.push('        return {"messages": [llm_with_tools.invoke(messages)]}');
      lines.push(`    sub.add_node(${pyStr(name)}, _passthrough)`);
      lines.push(`    sub.add_edge(START, ${pyStr(name)})`);
      lines.push(`    sub.add_edge(${pyStr(name)}, END)`);
      lines.push('    return sub.compile()');
      lines.push('');
      lines.push(`${ident}_subgraph = _build_${ident}_subgraph()`);
      lines.push('');
    }
  }

  // Graph construction
  lines.push('# Graph construction');
  lines.push('graph = StateGraph(AgentState)');
  lines.push('');

  // Build a registry: node_id → handler reference
  const skillByName = new Map(skills.map(s => [s.frontmatter.name, s]));
  const subAgentSet = new Set(subAgents);
  const registeredNodes = new Set<string>();

  // Register tool node up front if there are tools
  if (tools.length > 0) {
    lines.push('graph.add_node("tools", tool_node)');
    registeredNodes.add('tools');
    lines.push('');
  }

  if (flows.length === 0) {
    // No skillflows: register skill nodes (or a single agent node) and wire START → node → END.
    if (skills.length === 0) {
      lines.push('graph.add_node("agent", agent_node)');
      lines.push('graph.add_edge(START, "agent")');
      if (tools.length > 0) {
        lines.push('graph.add_edge("agent", "tools")');
        lines.push('graph.add_edge("tools", END)');
      } else {
        lines.push('graph.add_edge("agent", END)');
      }
      registeredNodes.add('agent');
    } else {
      // Chain skills sequentially in declared order.
      let prev: string = 'START';
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        const nodeId = skill.frontmatter.name;
        const handler = `skill_${pyIdent(skill.frontmatter.name)}`;
        lines.push(`graph.add_node(${pyStr(nodeId)}, ${handler})`);
        registeredNodes.add(nodeId);
        const fromExpr = prev === 'START' ? 'START' : pyStr(prev);
        lines.push(`graph.add_edge(${fromExpr}, ${pyStr(nodeId)})`);
        prev = nodeId;
      }
      if (tools.length > 0) {
        lines.push(`graph.add_edge(${pyStr(prev)}, "tools")`);
        lines.push('graph.add_edge("tools", END)');
      } else {
        lines.push(`graph.add_edge(${pyStr(prev)}, END)`);
      }
    }
  } else {
    // Skillflow-driven wiring.
    for (const flow of flows) {
      lines.push(`# Skillflow: ${flow.name ?? ''}`);

      // Pass 1 — register a node for every step (resolving its handler).
      for (const step of flow.steps) {
        const handler = resolveHandler(step, skillByName, subAgentSet);
        if (!registeredNodes.has(step.id)) {
          lines.push(`graph.add_node(${pyStr(step.id)}, ${handler})`);
          registeredNodes.add(step.id);
        }
      }

      // Pass 2 — index dependents so we know which nodes are terminal.
      const dependentsOf = new Map<string, string[]>();
      for (const step of flow.steps) {
        for (const dep of step.depends_on ?? []) {
          if (!dependentsOf.has(dep)) dependentsOf.set(dep, []);
          dependentsOf.get(dep)!.push(step.id);
        }
      }

      // Pass 3 — edges. START → roots, dep → step, terminal → END.
      for (const step of flow.steps) {
        const deps = step.depends_on ?? [];
        if (deps.length === 0) {
          lines.push(`graph.add_edge(START, ${pyStr(step.id)})`);
        } else if (deps.length === 1) {
          lines.push(`graph.add_edge(${pyStr(deps[0])}, ${pyStr(step.id)})`);
        } else {
          // Multiple dependencies → fan-in via add_conditional_edges from each dep.
          lines.push(
            `graph.add_conditional_edges(${pyStr(deps[0])}, lambda s: ${pyStr(step.id)}, {${pyStr(step.id)}: ${pyStr(step.id)}})`,
          );
          for (const dep of deps.slice(1)) {
            lines.push(`graph.add_edge(${pyStr(dep)}, ${pyStr(step.id)})`);
          }
        }
      }
      for (const step of flow.steps) {
        const dependents = dependentsOf.get(step.id) ?? [];
        if (dependents.length === 0) {
          lines.push(`graph.add_edge(${pyStr(step.id)}, END)`);
        }
      }
      lines.push('');
    }
  }

  lines.push('');
  lines.push('# Compile');
  lines.push('app = graph.compile()');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    result = app.invoke(');
  lines.push('        {"messages": [HumanMessage(content="Hello")]},');
  lines.push('        config={"recursion_limit": RECURSION_LIMIT},');
  lines.push('    )');
  lines.push('    for message in result["messages"]:');
  lines.push('        print(message)');
  lines.push('');

  return lines.join('\n');
}

// Helpers

function resolveHandler(
  step: FlowStep,
  skills: Map<string, ParsedSkill>,
  subAgents: Set<string>,
): string {
  if (step.skill && skills.has(step.skill)) {
    return `skill_${pyIdent(step.skill)}`;
  }
  if (step.agent && subAgents.has(step.agent)) {
    return `${pyIdent(step.agent)}_subgraph`;
  }
  if (step.tool) {
    return 'tool_node';
  }
  // Fall back to a lambda that just forwards state — keeps the graph compilable.
  return `lambda state: state`;
}

/** Turn an arbitrary identifier (kebab, dotted, etc.) into a valid Python identifier. */
function pyIdent(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(out)) out = `_${out}`;
  return out || '_';
}

/** Python single-line string literal. */
function pyStr(value: string): string {
  return JSON.stringify(value);
}

/** Python triple-quoted string literal, safe for arbitrary content. */
function pyTripleStr(value: string): string {
  // Escape embedded triple-quotes by splitting and rejoining.
  const safe = value.replace(/"""/g, '\\"\\"\\"').replace(/\\$/gm, '\\\\');
  return `"""${safe}"""`;
}

function escapeForComment(value: string): string {
  return value.replace(/"""/g, '"\\""');
}

function jsonTypeToPython(jsonType: string | undefined): string {
  switch (jsonType) {
    case 'string': return 'str';
    case 'integer': return 'int';
    case 'number': return 'float';
    case 'boolean': return 'bool';
    case 'array': return 'list';
    case 'object': return 'dict';
    default: return 'str';
  }
}
