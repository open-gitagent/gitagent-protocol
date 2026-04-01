---
name: compute-ladder
version: 1.0.0
description: >
  Model selection by provider health, not task complexity.
  Tier 0 (local) handles most tasks. Paid models are break-glass only.
  Fallbacks activate on 429 or timeout — never on perceived task difficulty.
---

# Compute Ladder

## Tier Definitions

```
Tier 0 — Local (never dies, zero cost)
  ollama/qwen3-coder:latest    primary, MoE, 128 TPS, 64k ctx
  ollama/gpt-oss:20b           fallback, 32k ctx HARD LIMIT

Tier 1 — Fast Free Cloud (up to 2100 TPS)
  cerebras/qwen-3-235b-a22b-instruct-2507   235B MoE, fast free
  cerebras/llama3.1-8b                      8B, ultra-fast light tasks

Tier 2 — Free Cloud (normal latency)
  openrouter/z-ai/glm-4.5-air
  openrouter/qwen/qwen3-coder

Tier 3 — Free Cloud Deep Reasoning
  openrouter/nousresearch/hermes-3-llama-3.1-405b:free

Tier 4 — Break-Glass (paid, restricted use)
  openrouter/anthropic/claude-opus-4.6  [narco-check and audit ONLY]
```

## Fallback Rules

**DO fallback when:**
- HTTP 429 (rate limited)
- Connection timeout (> 90s)
- Stream death / incomplete response

**DO NOT fallback when:**
- Task seems "complex" or "important"
- You want "better" output quality
- Previous attempt gave a poor answer

Use the primary model. Iterate. Fallback is for infrastructure failure, not preference.

## Health Check

```bash
# Tier 0
curl -s localhost:11434/api/tags | python3 -c "import json,sys; d=json.load(sys.stdin); print('TIER-0 OK:', len(d['models']), 'models')"

# Tier 1
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CEREBRAS_API_KEY" \
  https://api.cerebras.ai/v1/models

# Tier 4
curl -s -o /dev/null -w "%{http_code}" \
  https://openrouter.ai/api/v1/models
```

## Cost Guard

```bash
# Check today's OpenRouter spend
curl -s "https://openrouter.ai/api/v1/auth/key" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
print(f'today: \${d[\"usage_daily\"]:.2f} | week: \${d[\"usage_weekly\"]:.2f} | month: \${d[\"usage_monthly\"]:.2f}')
"
```

Daily > $5: flag to Ludo.
Weekly > $50: flag immediately — tier-4 model is likely being over-used.
