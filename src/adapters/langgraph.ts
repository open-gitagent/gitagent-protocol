import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { buildComplianceSection } from './shared.js';

/**
 * Export a gitagent to LangGraph (Python) format.
 *
 * LangGraph uses:
 *   - agent.py          (StateGraph definition with nodes + edges)
 *   - requirements.txt  (Python dependencies)
 *   - .env.example      (required environment variables)
 *
 * Returns structured output with all files that should be written.
 *
 * @see https://langchain-ai.github.io/langgraph/
 */
export interface LangGraphExport {
  /** Python source for the LangGraph agent */
  agentPy: string;
  /** pip requirements */
  requirements: string;
  /** .env.example content */
  envExample: string;
}

export function exportToLangGraph(dir: string): LangGraphExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const agentPy = buildAgentPy(agentDir, manifest);
  const requirements = buildRequirements(manifest);
  const envExample = buildEnvExample(manifest);

  return { agentPy, requirements, envExample };
}

/**
 * Export as a single string (for `gitagent export -f langgraph`).
 */
export function exportToLangGraphString(dir: string): string {
  const exp = exportToLangGraph(dir);
  const parts: string[] = [];

  parts.push('# === agent.py ===');
  parts.push(exp.agentPy);
  parts.push('\n# === requirements.txt ===');
  parts.push(exp.requirements);
  parts.push('\n# === .env.example ===');
  parts.push(exp.envExample);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildAgentPy(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const agentName = manifest.name ?? 'gitagent';
  const agentSlug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const description = manifest.description ?? '';
  const modelId = resolveModel(manifest.model?.preferred);

  // Collect system prompt sections
  const systemParts: string[] = [];
  systemParts.push(`# ${agentName}`);
  systemParts.push(description);
  systemParts.push('');

  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) { systemParts.push(soul); systemParts.push(''); }

  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) { systemParts.push(rules); systemParts.push(''); }

  const duties = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duties) { systemParts.push(duties); systemParts.push(''); }

  // Skills
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  if (skills.length > 0) {
    systemParts.push('## Skills');
    systemParts.push('');
    for (const skill of skills) {
      const toolsList = getAllowedTools(skill.frontmatter);
      const toolsNote = toolsList.length > 0 ? `\nAllowed tools: ${toolsList.join(', ')}` : '';
      systemParts.push(`### ${skill.frontmatter.name}`);
      systemParts.push(`${skill.frontmatter.description}${toolsNote}`);
      systemParts.push('');
      systemParts.push(skill.instructions);
      systemParts.push('');
    }
  }

  // Knowledge (always_load)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };
    if (index?.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      if (alwaysLoad.length > 0) {
        systemParts.push('## Knowledge');
        systemParts.push('');
        for (const doc of alwaysLoad) {
          const content = loadFileIfExists(join(knowledgeDir, doc.path));
          if (content) {
            systemParts.push(`### ${doc.path}`);
            systemParts.push(content);
            systemParts.push('');
          }
        }
      }
    }
  }

  // Compliance
  if (manifest.compliance) {
    const section = buildComplianceSection(manifest.compliance);
    if (section) { systemParts.push(section); systemParts.push(''); }
  }

  const systemPrompt = systemParts.join('\n').trimEnd();

  // Build tool stubs from tools/*.yaml
  const toolStubs = buildToolStubs(agentDir);

  // Build LangGraph Python code
  const hitl = manifest.compliance?.supervision?.human_in_the_loop;
  const hitlComment = hitlComment_(hitl);

  const lines: string[] = [];

  lines.push(`"""
LangGraph agent generated from gitagent manifest.

Agent  : ${agentName}
Version: ${manifest.version ?? '0.1.0'}
Source : ${agentDir}

Usage:
    python agent.py                     # interactive REPL
    python agent.py --prompt "..."      # single-shot
"""
from __future__ import annotations

import argparse
import os
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode`);

  // Model import
  const { importLine, modelConstructor } = resolveModelImport(modelId);
  lines.push(importLine);
  lines.push('');

  // -------------------------------------------------------------------------
  // System prompt (embedded)
  // -------------------------------------------------------------------------
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# System prompt — generated from SOUL.md / RULES.md / skills');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  lines.push('SYSTEM_PROMPT = """\\');
  // Escape triple-quote inside the string
  lines.push(systemPrompt.replace(/"""/g, '\\"\\"\\"'));
  lines.push('"""');
  lines.push('');

  // -------------------------------------------------------------------------
  // Tool definitions
  // -------------------------------------------------------------------------
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# Tools — generated from tools/*.yaml');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  if (toolStubs.length > 0) {
    for (const stub of toolStubs) {
      lines.push(stub);
      lines.push('');
    }
    lines.push(`TOOLS = [${toolStubs.map(s => extractFunctionName(s)).join(', ')}]`);
  } else {
    lines.push('# No tools defined in this agent — add tools/*.yaml to declare tools.');
    lines.push('TOOLS: list = []');
  }
  lines.push('');

  // -------------------------------------------------------------------------
  // LangGraph state + nodes
  // -------------------------------------------------------------------------
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# LangGraph state');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  lines.push('class AgentState(TypedDict):');
  lines.push('    messages: Annotated[list[BaseMessage], add_messages]');
  lines.push('');
  lines.push('');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# Graph nodes');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  lines.push(`def _make_llm() -> ${modelConstructor.split('(')[0]}:  # type: ignore[return]`);
  lines.push(`    return ${modelConstructor}.bind_tools(TOOLS) if TOOLS else ${modelConstructor}`);
  lines.push('');
  lines.push('');
  lines.push('def agent_node(state: AgentState) -> AgentState:');
  lines.push('    """Core reasoning node — calls the LLM with tool bindings."""');
  lines.push('    llm = _make_llm()');
  lines.push('    messages = state["messages"]');
  lines.push('    # Prepend system prompt if not already present');
  lines.push('    if not messages or not isinstance(messages[0], SystemMessage):');
  lines.push('        messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]');
  lines.push('    response = llm.invoke(messages)');
  lines.push('    return {"messages": [response]}');
  lines.push('');
  lines.push('');
  lines.push('def should_continue(state: AgentState) -> str:');
  lines.push('    """Edge condition: route to tools or END."""');
  lines.push('    last = state["messages"][-1]');
  lines.push('    if isinstance(last, AIMessage) and last.tool_calls:');
  lines.push('        return "tools"');
  lines.push('    return END');
  lines.push('');
  lines.push('');

  // -------------------------------------------------------------------------
  // HITL node (if required)
  // -------------------------------------------------------------------------
  if (hitl === 'always' || hitl === 'conditional') {
    lines.push('# ---------------------------------------------------------------------------');
    lines.push(`# Human-in-the-loop — compliance.supervision.human_in_the_loop: "${hitl}"`);
    lines.push('# ---------------------------------------------------------------------------');
    lines.push('');
    lines.push('def human_review_node(state: AgentState) -> AgentState:');
    if (hitl === 'always') {
      lines.push('    """Blocks execution until the user explicitly approves every tool call."""');
      lines.push('    last = state["messages"][-1]');
      lines.push('    if isinstance(last, AIMessage) and last.tool_calls:');
      lines.push('        print("\\n[HITL] Agent wants to call tools:")');
      lines.push('        for tc in last.tool_calls:');
      lines.push('            print(f"  {tc[\'name\']}({tc[\'args\']})")');
      lines.push('        approval = input("Approve? [y/N]: ").strip().lower()');
      lines.push('        if approval != "y":');
      lines.push('            # Strip tool calls — agent will respond without executing');
      lines.push('            blocked = AIMessage(content=last.content or "(tool calls blocked by reviewer)")');
      lines.push('            return {"messages": [blocked]}');
      lines.push('    return state');
    } else {
      lines.push('    """Prompts the user for approval before high-risk tool calls."""');
      lines.push('    last = state["messages"][-1]');
      lines.push('    if isinstance(last, AIMessage) and last.tool_calls:');
      lines.push('        risky = [tc for tc in last.tool_calls if _is_risky_tool(tc["name"])]');
      lines.push('        if risky:');
      lines.push('            print("\\n[HITL] Approval needed for:")');
      lines.push('            for tc in risky:');
      lines.push('                print(f"  {tc[\'name\']}({tc[\'args\']})")');
      lines.push('            if input("Approve? [y/N]: ").strip().lower() != "y":');
      lines.push('                blocked = AIMessage(content="(blocked by reviewer)")');
      lines.push('                return {"messages": [blocked]}');
      lines.push('    return state');
      lines.push('');
      lines.push('');
      lines.push('def _is_risky_tool(name: str) -> bool:');
      lines.push('    """Heuristic: flag write/delete/send operations for approval."""');
      lines.push('    risky_keywords = {"write", "delete", "send", "post", "update", "create", "remove"}');
      lines.push('    return any(kw in name.lower() for kw in risky_keywords)');
    }
    lines.push('');
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // Graph wiring
  // -------------------------------------------------------------------------
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# Graph wiring');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  lines.push('def build_graph() -> StateGraph:');
  lines.push(`    graph = StateGraph(AgentState)`);
  lines.push('    graph.add_node("agent", agent_node)');
  if (hitl === 'always' || hitl === 'conditional') {
    lines.push('    graph.add_node("human_review", human_review_node)');
  }
  if (toolStubs.length > 0) {
    lines.push('    graph.add_node("tools", ToolNode(TOOLS))');
  }
  lines.push('');
  lines.push('    graph.set_entry_point("agent")');
  if (hitl === 'always' || hitl === 'conditional') {
    lines.push('    graph.add_edge("agent", "human_review")');
    lines.push('    graph.add_conditional_edges("human_review", should_continue, {"tools": "tools", END: END})');
  } else {
    lines.push('    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})');
  }
  if (toolStubs.length > 0) {
    lines.push('    graph.add_edge("tools", "agent")');
  }
  lines.push('');
  lines.push('    return graph.compile()');
  lines.push('');
  lines.push('');

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('# Entry point');
  lines.push('# ---------------------------------------------------------------------------');
  lines.push('');
  lines.push('def main() -> None:');
  lines.push('    parser = argparse.ArgumentParser(description="Run the LangGraph agent")');
  lines.push('    parser.add_argument("--prompt", "-p", type=str, default=None,');
  lines.push('                        help="Single-shot prompt (omit for interactive mode)")');
  lines.push('    args = parser.parse_args()');
  lines.push('');
  lines.push('    app = build_graph()');
  lines.push('');
  lines.push('    if args.prompt:');
  lines.push('        # Single-shot mode');
  lines.push('        result = app.invoke({"messages": [HumanMessage(content=args.prompt)]})');
  lines.push('        last = result["messages"][-1]');
  lines.push('        print(last.content)');
  lines.push('    else:');
  lines.push(`        # Interactive REPL`);
  lines.push(`        print(f"${agentName} — LangGraph agent (type 'exit' to quit)")`);
  lines.push('        conversation: list[BaseMessage] = []');
  lines.push('        while True:');
  lines.push('            try:');
  lines.push('                user_input = input("You: ").strip()');
  lines.push('            except (EOFError, KeyboardInterrupt):');
  lines.push('                break');
  lines.push('            if user_input.lower() in {"exit", "quit", "q"}:');
  lines.push('                break');
  lines.push('            if not user_input:');
  lines.push('                continue');
  lines.push('            conversation.append(HumanMessage(content=user_input))');
  lines.push('            result = app.invoke({"messages": conversation})');
  lines.push('            conversation = result["messages"]');
  lines.push('            last = conversation[-1]');
  lines.push(`            print(f"Agent: {last.content}")`);
  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    main()');

  return lines.join('\n') + '\n';
}

function buildRequirements(manifest: ReturnType<typeof loadAgentManifest>): string {
  const model = manifest.model?.preferred ?? '';
  const deps = [
    'langgraph>=0.2.0',
    'langchain-core>=0.3.0',
  ];

  if (model.startsWith('claude') || model.startsWith('anthropic/')) {
    deps.push('langchain-anthropic>=0.3.0');
  } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('openai/')) {
    deps.push('langchain-openai>=0.3.0');
  } else if (model.startsWith('gemini') || model.startsWith('google/')) {
    deps.push('langchain-google-genai>=2.0.0');
  } else {
    // Default: include all common providers
    deps.push('langchain-openai>=0.3.0');
    deps.push('# Uncomment to use Anthropic: langchain-anthropic>=0.3.0');
    deps.push('# Uncomment to use Google: langchain-google-genai>=2.0.0');
  }

  deps.push('python-dotenv>=1.0.0');
  return deps.join('\n') + '\n';
}

function buildEnvExample(manifest: ReturnType<typeof loadAgentManifest>): string {
  const model = manifest.model?.preferred ?? '';
  const lines = ['# Copy to .env and fill in your credentials'];

  if (model.startsWith('claude') || model.startsWith('anthropic/')) {
    lines.push('ANTHROPIC_API_KEY=your-anthropic-api-key');
  } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('openai/')) {
    lines.push('OPENAI_API_KEY=your-openai-api-key');
  } else if (model.startsWith('gemini') || model.startsWith('google/')) {
    lines.push('GOOGLE_API_KEY=your-google-api-key');
  } else {
    lines.push('OPENAI_API_KEY=your-openai-api-key');
    lines.push('# ANTHROPIC_API_KEY=your-anthropic-api-key');
    lines.push('# GOOGLE_API_KEY=your-google-api-key');
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveModel(preferred?: string): string {
  if (!preferred) return 'gpt-4o';
  // Strip provider prefix if present
  if (preferred.startsWith('anthropic/')) return preferred.slice('anthropic/'.length);
  if (preferred.startsWith('openai/')) return preferred.slice('openai/'.length);
  if (preferred.startsWith('google/')) return preferred.slice('google/'.length);
  return preferred;
}

function resolveModelImport(modelId: string): { importLine: string; modelConstructor: string } {
  if (modelId.startsWith('claude-')) {
    return {
      importLine: 'from langchain_anthropic import ChatAnthropic',
      modelConstructor: `ChatAnthropic(model="${modelId}", temperature=0)`,
    };
  }
  if (modelId.startsWith('gemini-')) {
    return {
      importLine: 'from langchain_google_genai import ChatGoogleGenerativeAI',
      modelConstructor: `ChatGoogleGenerativeAI(model="${modelId}", temperature=0)`,
    };
  }
  // Default: OpenAI-compatible
  return {
    importLine: 'from langchain_openai import ChatOpenAI',
    modelConstructor: `ChatOpenAI(model="${modelId}", temperature=0)`,
  };
}

function buildToolStubs(agentDir: string): string[] {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return [];

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
  const stubs: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const toolConfig = yaml.load(content) as {
        name?: string;
        description?: string;
        input_schema?: { properties?: Record<string, { type: string; description?: string }>; required?: string[] };
      };

      if (!toolConfig?.name) continue;

      const fnName = toolConfig.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      const description = toolConfig.description ?? toolConfig.name;

      // Build function signature from input_schema
      const props = toolConfig.input_schema?.properties ?? {};
      const required = new Set(toolConfig.input_schema?.required ?? []);
      const params = Object.entries(props)
        .map(([k, v]) => {
          const pyType = jsonTypeToPython(v.type);
          return required.has(k) ? `${k}: ${pyType}` : `${k}: ${pyType} | None = None`;
        });

      const sig = params.length > 0 ? params.join(', ') : '';
      const body = toolConfig.input_schema?.properties
        ? Object.keys(props).map(k => `    # TODO: implement ${k} handling`).join('\n')
        : '    # TODO: implement';

      stubs.push(`@tool\ndef ${fnName}(${sig}) -> str:\n    """${description}\"\"\"\n${body}\n    raise NotImplementedError("Implement ${fnName} tool")`);
    } catch { /* skip malformed tools */ }
  }

  return stubs;
}

function extractFunctionName(stub: string): string {
  const m = stub.match(/^def (\w+)\(/m);
  return m ? m[1] : 'unknown';
}

function jsonTypeToPython(jsonType: string): string {
  const map: Record<string, string> = {
    string: 'str',
    integer: 'int',
    number: 'float',
    boolean: 'bool',
    array: 'list',
    object: 'dict',
  };
  return map[jsonType] ?? 'str';
}

function hitlComment_(hitl: string | undefined): string {
  if (!hitl || hitl === 'none') return '# No human-in-the-loop required';
  if (hitl === 'always') return '# human_in_the_loop: always — all tool calls require approval';
  if (hitl === 'conditional') return '# human_in_the_loop: conditional — risky tool calls require approval';
  if (hitl === 'advisory') return '# human_in_the_loop: advisory — agent may proceed; log for review';
  return '';
}
