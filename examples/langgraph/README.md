# LangGraph example

A two-step research agent that demonstrates the LangGraph adapter:

- `agent.yaml` — manifest (model, runtime, skill + tool references)
- `SOUL.md` — agent identity, embedded in the generated system prompt
- `skills/web-research/SKILL.md` — first node in the graph
- `skills/summarize/SKILL.md` — second node, depends on `web-research`
- `skillflows/research.yaml` — wiring (`steps`, `depends_on`) → `add_edge` calls
- `tools/web-search.yaml` — bound as a `ToolNode`
- `expected_output.py` — the Python module the adapter produces

## Regenerate

```bash
gapman export --dir examples/langgraph --format langgraph --output examples/langgraph/expected_output.py
```

## Run the generated graph

```bash
pip install "langgraph>=0.2" "langchain>=0.3" "langchain-core>=0.3" langchain-anthropic
python examples/langgraph/expected_output.py
```

The generated file leaves tool implementations as `NotImplementedError` stubs — replace them with your own logic before invoking.
