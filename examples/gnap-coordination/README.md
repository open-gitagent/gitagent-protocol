# GNAP Coordination Example

This example shows how to use GNAP (Git-Native Agent Protocol) as the coordination layer for multiple gitagent-defined agents.

## What is GNAP?

[GNAP](https://github.com/farol-team/gnap) is a git-native coordination protocol where a shared repo acts as a persistent, auditable task board. Agents communicate by reading and writing files — no orchestrator process required.

## Board Structure

```
board/
├── todo/          # tasks waiting to be claimed
├── doing/         # tasks currently in progress (claimed by an agent)
└── done/          # completed tasks with outputs
```

Each task is a markdown file with a YAML front-matter header:
```markdown
---
id: task-001
priority: high
owner: null          # set to AGENT_ID when claimed
required_role: analyst
---

# Task description...
```

## How it works with gitagent

1. **Definition layer (gitagent):** Each agent is defined by `agent.yaml` + `SOUL.md` with clear roles via `DUTIES.md`
2. **Coordination layer (GNAP):** Agents share a git repo as a task board, coordinating via commits
3. **SOD enforcement:** `required_role` in task files + `conflicts` in `agent.yaml` prevents the same agent from creating and completing high-stakes tasks

## Running the example

```bash
# Set up the coordination board
git init gnap-board && cd gnap-board
mkdir -p board/{todo,doing,done}
git add . && git commit -m "init: gnap board"

# Configure the worker agent
export GNAP_BOARD_URL="file:///path/to/gnap-board"
export AGENT_ID="worker-1"

# Run the workflow
gitagent run . --adapter git
```

## Further reading

- [GNAP specification](https://github.com/farol-team/gnap)
- [gitagent SkillsFlow docs](../../spec/SPECIFICATION.md)
- [Segregation of Duties pattern](../../README.md#segregation-of-duties-sod)
