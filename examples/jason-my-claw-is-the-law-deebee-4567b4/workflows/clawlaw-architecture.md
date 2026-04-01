---
name: clawlaw-architecture
version: 1.0.0
type: architecture
status: active
---

# ClawLaw Architecture — Jason / OpenClaw

**Date:** 2026-04-01
**Author:** bengii (Ludo Vecchio)
**Status:** Active implementation

Two source concepts, one operating system:

1. **Atomic Work Packet** — every task decomposes into one locked, reviewable unit before any side effect executes
2. **Compute Ladder** — models selected by provider health, not task complexity; fast/free handles most work, paid is break-glass only

---

## Architecture Overview

```
User Instruction
       │
       ▼
┌─────────────────┐
│  Packet Factory │  ← creates DRAFT packet
│  (scope lock)   │  ← review → APPROVED
└────────┬────────┘
         │ APPROVED only
         ▼
┌─────────────────┐
│ Compute Ladder  │  ← selects model by provider health
│ Tier 0→1→2→3→4  │  ← fallback on 429/timeout, not complexity
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   EXEC + Log    │  ← verbatim output or EXEC FAILED
│  (no faking)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Packet Dispatch│  ← dispatched_at set after real exec
│  (status→DONE)  │
└─────────────────┘
```

---

## Implementation Checklist

### Phase 1 — Foundations

- [x] Create `CLAWLAW.md` — canonical rules file loaded every session
- [x] Replace `BOOTSTRAP.md` with `CLAWLAW.md` in OpenClaw systemFiles
- [x] Create `PACKET.md` — packet schema reference
- [x] Create `skills/packet-factory/` (permissions 775)
- [x] Create `skills/compute-ladder/SKILL.md`

### Phase 2 — Model Chain Surgery

- [ ] Obtain Groq API key — add as `groq:default` in auth-profiles.json
- [ ] Add `GROQ_API_KEY` to systemd override.conf
- [ ] Restructure fallback chain: tier-0 local → tier-1 Groq → tier-2 free cloud → tier-3 deep free → tier-4 break-glass
- [ ] Remove paid-tier models that appeared before free-tier models
- [ ] Reload gateway, verify with `openclaw status --deep`

### Phase 3 — ClawCode Operator Loop

- [ ] Patch `SOUL.md` — add ClawCode loop as execution doctrine
- [ ] Patch `SOUL.md` — add budget definitions (40k tokens, 15 tool calls, 90s timeout)
- [ ] Patch `HEARTBEAT.md` — pre-flight adds packet queue check, ladder health check

### Phase 4 — Packet Factory Skill

- [ ] Write `skills/packet-factory/new-packet.sh`
- [ ] Write `skills/packet-factory/review-packet.sh`
- [ ] Write `skills/packet-factory/dispatch-packet.sh`
- [ ] Add packet scripts to `exec-approvals.json` allowlist
- [ ] Create `memory/packet-queue.md`

### Phase 5 — Wire + Validate

- [ ] Add `CLAWLAW.md` reference to `AGENTS.md`
- [ ] Add packet-factory and compute-ladder to `TOOLS.md`
- [ ] Update `MEMORY.md` integration status
- [ ] Run narco-check — verify CLEAN
- [ ] Run full test harness — all tests pass

---

## Test Harness

Full test harness at `skills/packet-factory/test-clawlaw.sh`. Test groups:

```
GROUP 1: Packet Factory Integrity       (T01–T06)
GROUP 2: Compute Ladder                 (T07–T13)
GROUP 3: EXEC Rule Enforcement          (T14–T17)
GROUP 4: Scope Discipline               (T18–T21)
GROUP 5: Budget Limits                  (T22–T25)
GROUP 6: OpenRouter Cost Monitoring     (T26–T29)
GROUP 7: Site Health                    (T30–T32)
GROUP 8: Narco-Check Integration        (T33–T35)
GROUP 9: Exec Approvals Integrity       (T36–T39)
GROUP 10: Gateway Health                (T40–T42)
```

Output format:
```
[PASS] T01 — packet creates with DRAFT status
[FAIL] T07 — tier-0 ollama unreachable
[SKIP] T30 — geniewars.com not yet deployed (expected)
...
SUMMARY: 38 PASS | 2 FAIL | 2 SKIP
```

---

## Budget Definitions

| Budget | Limit | On Breach |
|--------|-------|-----------|
| Context | 40,000 tokens | Forced handoff, new session |
| Tool calls | 15 per task chain | Scope review before continuing |
| Exec timeout | 90s | Retry with different approach |
| Retries | 3 max | Narco-check trigger |
| OpenRouter daily spend | $5 | Flag to Ludo |
| OpenRouter weekly spend | $50 | Flag immediately — fallbacks overrunning |

---

## Model Routing Table

| Tier | Model | Use case |
|------|-------|----------|
| 0 | `ollama/qwen3-coder:latest` | Primary — local, free, 64k ctx |
| 0 | `ollama/gpt-oss:20b` | Local fallback — 32k hard limit |
| 1 | `groq/llama-3.3-70b-versatile` | Fast free cloud |
| 1 | `groq/moonshotai/kimi-k2-instruct` | Fast free cloud alt |
| 2 | `openrouter/z-ai/glm-4.5-air` | Free cloud |
| 2 | `openrouter/qwen/qwen3-coder` | Free cloud alt |
| 3 | `openrouter/nousresearch/hermes-3-llama-3.1-405b:free` | Deep reasoning, free |
| 4 | `openrouter/anthropic/claude-opus-4.6` | Break-glass: narco-check + audit only |

---

## Known Failure Modes

| Failure | Root Cause | Fix |
|---------|-----------|-----|
| Stream death ("Ollama API stream ended") | contextWindow > 32768 for gpt-oss:20b | Hard cap at 32768 in openclaw.json |
| Session death from scope creep | One instruction expanded to 5 tasks | SOUL.md scope discipline rule |
| Hallucinated disk/system reports | No real exec run | EXEC RULE + 5-4-3-2-1 grounding check |
| Fallback chain poisoning | Paid model inserted before free tier | Compute ladder enforces tier order |
| Context overflow (101%) | Task chain exceeded 40k tokens | Context budget forces handoff |
| Circular confirmation | Failure → false success logged | Narco-check detects and quarantines |
