---
name: narco-check
version: 1.0.0
description: >
  Memory integrity audit. Detects hallucinations, circular confirmations, and state poisoning.
  Runs automatically after 2 consecutive failures or at nightly deep dive.
  Uses Opus 4.6 as the auditor model.
---

# Narco-Check — Memory Integrity Audit

## When This Runs

1. **Failure trigger:** 2 consecutive failures on the same task or tool
2. **End-of-day trigger:** Nightly deep dive audit (~3 AM)

## Audit Model

Must use `openrouter/anthropic/claude-opus-4.6`. Never run narco-check on a tier-0 or tier-1 model.

```bash
openclaw agent --model openrouter/anthropic/claude-opus-4.6 \
  --message "$(cat ~/.openclaw/workspace/skills/narco-check/audit-prompt.md)" \
  --mode now
```

## 5-4-3-2-1 Grounding Check

Run this first — before reading any logs. Anchors the audit in real system state.

**5 — Run five commands, paste raw output verbatim:**
```bash
date
hostname
df -h /
docker ps --format "table {{.Names}}\t{{.Status}}"
cat ~/.openclaw/workspace/HEARTBEAT.md | head -3
```

**4 — Confirm four workspace files exist, paste first line:**
```bash
head -1 ~/.openclaw/workspace/IDENTITY.md
head -1 ~/.openclaw/workspace/SOUL.md
head -1 ~/.openclaw/workspace/MEMORY.md
head -1 ~/.openclaw/workspace/HEARTBEAT.md
```

**3 — Ping three endpoints, report HTTP codes:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:18789/health
curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://geniewars.com
curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://siliconchimps.com
```

**2 — Run one Exa search, paste first real result:**
```bash
~/.openclaw/workspace/skills/exa-search/exa.sh "$(date +%Y) advance reader community" 2
```

**1 — State one provable fact:**
```
GROUNDED: [claim] — verified by [command] — output: [exact output]
```

A grounded check with failures is valid. A grounded check with fabricated output is **POISONED**.

## Audit States

- `CLEAN` — no failures, no audit triggered
- `DEGRADED` — issues found, state acceptable, resumed with different approach
- `POISONED` — contaminated entries found, stop and notify Ludo

If POISONED: mark affected MEMORY.md entries `[QUARANTINE YYYY-MM-DD]`, notify Ludo via Slack DM before proceeding.
