---
type: knowledge
topic: testing
---

# ClawLaw Test Harness

Full validation suite for the ClawLaw operating system. 42 tests across 10 groups.

Run: `bash skills/packet-factory/test-clawlaw.sh`

## Test Groups

### GROUP 1: Packet Factory Integrity (T01–T06)
- T01 — `new-packet.sh` creates DRAFT packet with all required fields
- T02 — `dispatch-packet.sh` refuses to dispatch DRAFT packet (exit ≠ 0)
- T03 — `dispatch-packet.sh` refuses to dispatch REJECTED packet
- T04 — `review-packet.sh` sets `scope_locked_at` on APPROVED
- T05 — `dispatch-packet.sh` sets `dispatched_at` and DISPATCHED status on success
- T06 — packet ID is unique (create 3 packets, verify no collision)

### GROUP 2: Compute Ladder (T07–T13)
- T07 — tier-0 health: `curl localhost:11434/api/tags` returns 200
- T08 — Groq health: `curl api.groq.com/openai/v1/models` with key returns 200
- T09 — OpenRouter health: `curl openrouter.ai/api/v1/models` returns 200
- T10 — fallback chain lists tier-0 first (grep `qwen3-coder` at position 1)
- T11 — fallback chain includes at least one free-tier OpenRouter model
- T12 — fallback chain includes `claude-opus-4.6` as break-glass (last or near-last)
- T13 — NO paid-only model appears before any free-tier model in chain

### GROUP 3: EXEC Rule Enforcement (T14–T17)
- T14 — `HEARTBEAT.md` contains "EXEC FAILED" instruction
- T15 — `narco-check/SKILL.md` contains "5-4-3-2-1 Grounding Check" section
- T16 — `narco-check/audit-prompt.md` instructs grounding check first
- T17 — `exa.sh` is executable and returns non-empty output for a test query

### GROUP 4: Scope Discipline (T18–T21)
- T18 — `SOUL.md` contains "One instruction = one action"
- T19 — `SOUL.md` contains "ClawCode Operator Loop"
- T20 — `CLAWLAW.md` exists and is non-empty
- T21 — `CLAWLAW.md` listed in `openclaw.json` systemFiles

### GROUP 5: Budget Limits (T22–T25)
- T22 — `SOUL.md` contains "40" context budget reference
- T23 — `SOUL.md` contains "15 tool calls" tool budget reference
- T24 — `openclaw.json` contextWindow for `gpt-oss:20b` == 32768
- T25 — `openclaw.json` maxTokens for `gpt-oss:20b` ≤ 4096

### GROUP 6: OpenRouter Cost Monitoring (T26–T29)
- T26 — `HEARTBEAT.md` contains OpenRouter usage curl block
- T27 — `HEARTBEAT.md` contains "$5" daily threshold
- T28 — `HEARTBEAT.md` contains "$50" weekly threshold
- T29 — live API call: today's OpenRouter spend is parseable float

### GROUP 7: Site Health (T30–T32)
- T30 — `geniewars.com` returns HTTP 200 (SKIP if not yet deployed)
- T31 — `siliconchimps.com` returns HTTP 200 (SKIP if not yet deployed)
- T32 — `HEARTBEAT.md` contains site health curl block for both domains

### GROUP 8: Narco-Check Integration (T33–T35)
- T33 — `skills/narco-check/` exists with `SKILL.md` and `audit-prompt.md`
- T34 — `HEARTBEAT.md` contains narco-check status line requirement
- T35 — `HEARTBEAT.md` contains "CLEAN / DEGRADED / POISONED" state machine

### GROUP 9: Exec Approvals Integrity (T36–T39)
- T36 — `exa.sh` path is in `exec-approvals.json` allowlist
- T37 — packet-factory scripts are in `exec-approvals.json` allowlist
- T38 — all entries in `exec-approvals.json` use absolute paths
- T39 — `*` allowlist count ≥ 33 (no entries removed)

### GROUP 10: Gateway Health (T40–T42)
- T40 — gateway responds on port 18789: HTTP 200
- T41 — `openclaw status` exits 0
- T42 — no "duplicate plugin" errors in last 10 gateway log lines

## Expected Output

```
[PASS] T01 — packet creates with DRAFT status
[PASS] T02 — dispatch refused for DRAFT packet
...
[SKIP] T30 — geniewars.com not yet deployed (expected)
[SKIP] T31 — siliconchimps.com not yet deployed (expected)
...
SUMMARY: 40 PASS | 0 FAIL | 2 SKIP
```

SKIP is valid for T30/T31 until sites are live. The harness distinguishes "not deployed" from "deployed but down."
