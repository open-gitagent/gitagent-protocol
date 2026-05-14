# DeepAgents example

A research agent with a fact-checker sub-agent, demonstrating the DeepAgents adapter:

- `agent.yaml` — manifest (model, skills, tools, sub-agent declaration)
- `SOUL.md` — agent identity, embedded in the generated `system_prompt`
- `skills/web-research/`, `skills/summarize/` — passed via `skills=["./skills"]`; DeepAgents loads each `SKILL.md` natively
- `tools/web-search.yaml` — emitted as a `@tool` function bound into `tools=[...]`
- `agents/fact-checker/` — emitted as a `SubAgent` dict in `subagents=[...]`
- `expected_output.py` — the Python module the adapter produces

DeepAgents is a higher-level harness on top of LangGraph — there is no graph
wiring: the model decides when to plan, when to delegate to sub-agents, and
when to call tools. If you need explicit per-step edges, use the `langgraph`
adapter instead.

## Regenerate

```bash
gapman export --dir examples/deepagents --format deepagents --output examples/deepagents/expected_output.py
```

## Run the generated agent

```bash
pip install deepagents langchain-anthropic
python examples/deepagents/expected_output.py
```

The generated file leaves tool implementations as `NotImplementedError` stubs — replace them with your own logic before invoking.
