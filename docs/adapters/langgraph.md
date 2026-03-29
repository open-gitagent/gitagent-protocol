# LangGraph Adapter

Complete mapping guide for converting between gitagent and LangGraph formats.

## Overview

[LangGraph](https://langchain-ai.github.io/langgraph/) is LangChain's graph-based agent orchestration framework for Python. It models agents as `StateGraph` objects where:

- **Nodes** are Python functions that receive and return state
- **Edges** are routing decisions (conditional or fixed)
- **State** is a typed dictionary (`TypedDict`) carrying messages between nodes
- **Tools** are Python functions decorated with `@tool`

The gitagent LangGraph adapter enables:
1. **Export**: Convert gitagent → LangGraph Python code (`agent.py`)
2. **Run**: Execute gitagent agents using the generated Python agent

## Installation

```bash
# LangGraph requires Python 3.11+
pip install langgraph langchain-core

# Provider-specific:
pip install langchain-openai        # for GPT models
pip install langchain-anthropic     # for Claude models
pip install langchain-google-genai  # for Gemini models
```

## Field Mapping

### Export: gitagent → LangGraph

| gitagent | LangGraph | Notes |
|----------|-----------|-------|
| `SOUL.md` | `SYSTEM_PROMPT` (identity section) | Embedded as Python string constant |
| `RULES.md` | `SYSTEM_PROMPT` (constraints section) | Appended to system prompt |
| `DUTIES.md` | `SYSTEM_PROMPT` (SOD section) | Appended to system prompt |
| `skills/*/SKILL.md` | `SYSTEM_PROMPT` (skills section) | Progressive disclosure, full instructions |
| `tools/*.yaml` | `@tool` decorated functions | Stub implementations — fill in logic |
| `knowledge/` (always_load) | `SYSTEM_PROMPT` (knowledge section) | Reference documents embedded |
| `manifest.model.preferred` | LLM constructor (`ChatOpenAI`, `ChatAnthropic`, `ChatGoogleGenerativeAI`) | Auto-detected from model name prefix |
| `compliance.supervision.human_in_the_loop: always` | `human_review_node` (blocks on every tool call) | Inserted between `agent` and `tools` nodes |
| `compliance.supervision.human_in_the_loop: conditional` | `human_review_node` (blocks on risky tools) | Heuristic based on tool name keywords |
| `compliance.supervision.human_in_the_loop: none` | No HITL node | Fully autonomous |
| `manifest.version` | Docstring | Recorded for traceability |

### Graph Structure

**Without HITL:**
```
START → agent → (should_continue) → tools → agent (loop)
                                  ↓
                                 END
```

**With HITL (`always` or `conditional`):**
```
START → agent → human_review → (should_continue) → tools → agent (loop)
                                                  ↓
                                                 END
```

## Model Resolution

| gitagent `model.preferred` | LangGraph import | Class |
|----------------------------|------------------|-------|
| `claude-*` or `anthropic/*` | `langchain_anthropic` | `ChatAnthropic` |
| `gpt-*`, `o1*`, `o3*`, `openai/*` | `langchain_openai` | `ChatOpenAI` |
| `gemini-*` or `google/*` | `langchain_google_genai` | `ChatGoogleGenerativeAI` |
| *(other)* | `langchain_openai` | `ChatOpenAI` |

## Usage Examples

### Export to LangGraph

```bash
# Export to stdout
gitagent export --format langgraph -d ./my-agent

# Save to file
gitagent export --format langgraph -d ./my-agent -o agent.py
```

**Output Structure:**
```
# === agent.py ===
"""LangGraph agent generated from gitagent manifest…"""
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
…

# === requirements.txt ===
langgraph>=0.2.0
langchain-core>=0.3.0
langchain-openai>=0.3.0
python-dotenv>=1.0.0

# === .env.example ===
OPENAI_API_KEY=your-openai-api-key
```

### Run with LangGraph

```bash
# Interactive mode
gitagent run --adapter langgraph -d ./my-agent

# Single-shot mode
gitagent run --adapter langgraph -d ./my-agent --prompt "Summarise the latest SEC filings"
```

The runner:
1. Generates `agent.py`, `requirements.txt`, and `.env.example` in a temp workspace
2. Creates a Python virtual environment
3. Installs dependencies via `pip install -r requirements.txt`
4. Executes `python agent.py [--prompt "…"]`
5. Cleans up the temp workspace on exit

### Running the generated agent directly

```bash
# After export:
cp .env.example .env && vim .env   # add your API key
pip install -r requirements.txt
python agent.py                     # interactive REPL
python agent.py --prompt "Hello"    # single-shot
```

## Compliance Mapping

| gitagent `human_in_the_loop` | LangGraph behaviour |
|------------------------------|---------------------|
| `always` | `human_review_node` inserted — user must type `y` to approve **every** tool call |
| `conditional` | `human_review_node` inserted — approval required only for write/delete/send/post operations |
| `advisory` | No HITL node — advisory note added in system prompt only |
| `none` | No HITL node — fully autonomous |

## Implementing Tools

The adapter generates stub `@tool` functions from `tools/*.yaml`. You need to fill in the implementation:

```python
# Before (generated stub)
@tool
def search_regulations(query: str) -> str:
    """Search regulatory database."""
    raise NotImplementedError("Implement search_regulations tool")

# After (your implementation)
@tool
def search_regulations(query: str) -> str:
    """Search regulatory database."""
    results = my_db.search(query)
    return "\n".join(r.text for r in results)
```

## Generated File Reference

### `agent.py`

| Section | Description |
|---------|-------------|
| `SYSTEM_PROMPT` | Full agent identity + rules + skills as string constant |
| `TOOLS` | List of `@tool`-decorated functions (stubs from `tools/*.yaml`) |
| `AgentState` | `TypedDict` with `messages: Annotated[list[BaseMessage], add_messages]` |
| `agent_node` | Calls LLM with tools bound; prepends system prompt |
| `should_continue` | Routes to `"tools"` if last message has tool calls, else `END` |
| `human_review_node` | (HITL only) Prompts user for approval before tool execution |
| `build_graph` | Wires nodes and edges into a compiled `StateGraph` |
| `main` | CLI entry point: `--prompt` for single-shot, interactive REPL otherwise |

### `requirements.txt`

Minimal set of pip packages needed to run the agent.

### `.env.example`

Template for environment variables (API keys). Copy to `.env` and fill in.

## Notes

- Tools are generated as **stubs** — the adapter cannot infer implementation from YAML declarations alone. Fill in the function body before use.
- The runner requires **Python 3.11+** and **pip** on PATH.
- For production use, replace the `tmpdir`-based approach with a persistent project directory.
- LangGraph does not natively support gitagent's agent versioning or branch deployment patterns — those remain in the git layer.
