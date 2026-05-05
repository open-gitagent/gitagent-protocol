# Google Gemini CLI Adapter

Complete mapping guide for converting between gitagent and Google Gemini CLI formats.

## Overview

Google Gemini CLI is Google's open-source AI agent for the terminal. It uses:

- **GEMINI.md** at the project root (or `~/.gemini/GEMINI.md` globally) for custom instructions
- **.gemini/settings.json** for model configuration, tool permissions, and approval modes
- Supports Gemini models via Google AI Studio or Vertex AI
- Has approval modes, policy engine, MCP servers, skills, hooks, and extensions

The gitagent Gemini adapter enables:
1. **Export**: Convert gitagent → Gemini CLI format
2. **Run**: Execute gitagent agents using `gemini` CLI
3. **Import**: Convert Gemini CLI projects → gitagent format

## Installation

```bash
# Install Gemini CLI
npm install -g @google/generative-ai-cli

# Or via Homebrew (macOS)
brew install google/tap/gemini

# Verify installation
gemini --version
```

## Field Mapping

### Export: gitagent → Gemini CLI

| gitagent | Gemini CLI | Notes |
|----------|-----------|-------|
| `SOUL.md` | `GEMINI.md` (identity section) | Core personality and communication style |
| `RULES.md` | `GEMINI.md` (constraints section) | Hard constraints and safety boundaries |
| `DUTIES.md` | `GEMINI.md` (SOD section) | Segregation of duties policy |
| `skills/*/SKILL.md` | `GEMINI.md` (skills section) | Progressive disclosure with full instructions |
| `tools/*.yaml` | `.gemini/settings.json` → `allowedTools` | Tool names extracted from YAML |
| `knowledge/` (always_load) | `GEMINI.md` (knowledge section) | Reference documents embedded |
| `manifest.model.preferred` | `.gemini/settings.json` → `model` | Model object with `id` and `provider` (e.g., `{"id": "gemini-2.0-flash-exp", "provider": "google"}`) |
| `manifest.compliance.supervision.human_in_the_loop` | CLI flag `--approval-mode` | Approval mode mapping (see below) |
| `hooks/hooks.yaml` | `.gemini/settings.json` → `hooks` | Lifecycle event handlers |
| `agents/` (sub-agents) | `GEMINI.md` (delegation section) | Documented as pattern (no native support) |
| `compliance/` (policy files) | `.gemini/settings.json` → `policy` | Policy file paths |

### Import: Gemini CLI → gitagent

| Gemini CLI | gitagent | Notes |
|-----------|----------|-------|
| `GEMINI.md` | `SOUL.md` + `RULES.md` + `DUTIES.md` | Split by section keywords |
| `.gemini/settings.json` → `model` | `agent.yaml` → `model.preferred` | Direct mapping |
| `.gemini/settings.json` → `approvalMode` | `compliance.supervision.human_in_the_loop` | Reverse approval mode mapping |
| `.gemini/settings.json` → `allowedTools` | `tools/*.yaml` | Creates tool YAML files |
| `.gemini/settings.json` → `hooks` | `hooks/hooks.yaml` | Event mapping |

## Approval Mode Mapping

### Export (gitagent → Gemini CLI)

| gitagent `human_in_the_loop` | Gemini CLI `approvalMode` | Behavior |
|------------------------------|---------------------------|----------|
| `always` | `plan` | Read-only mode, no actions executed |
| `conditional` | `default` | Prompt for approval on tool use |
| `none` | `yolo` | Auto-approve all actions |
| `advisory` | `auto_edit` | Auto-approve edit tools only |

### Import (Gemini CLI → gitagent)

| Gemini CLI `approvalMode` | gitagent `human_in_the_loop` |
|---------------------------|------------------------------|
| `plan` | `always` |
| `default` | `conditional` |
| `yolo` | `none` |
| `auto_edit` | `advisory` |

## Usage Examples

### Export to Gemini CLI

```bash
# Export to stdout
gapman export --format gemini -d ./my-agent

# Save to file
gapman export --format gemini -d ./my-agent -o gemini-export.txt

# The export includes both GEMINI.md and .gemini/settings.json content
```

**Output Structure:**
```
# === GEMINI.md ===
# agent-name
Agent description

## Soul
[SOUL.md content]

## Rules
[RULES.md content]

## Skills
[Skills with progressive disclosure]

## Tools
[Tool schemas]

# === .gemini/settings.json ===
{
  "model": {
    "id": "gemini-2.0-flash-exp",
    "provider": "google"
  },
  "allowedTools": ["bash", "edit", "read"],
  "approvalMode": "default",
  "hooks": {...}
}
```

### Run with Gemini CLI

```bash
# Interactive mode
gapman run ./my-agent --adapter gemini

# Single-shot mode with prompt
gapman run ./my-agent --adapter gemini -p "Explain quantum computing"

# From git repository
gapman run --repo https://github.com/user/agent.git --adapter gemini
```

**What Happens:**
1. Creates temporary workspace
2. Writes `GEMINI.md` at project root
3. Creates `.gemini/settings.json` with config
4. Launches `gemini` CLI in that workspace
5. Cleans up temporary files on exit

### Import from Gemini CLI

```bash
# Import from existing Gemini CLI project
gapman import --from gemini /path/to/gemini-project -d ./imported-agent

# Verify the imported agent
cd ./imported-agent
gapman validate
```

**What Gets Created:**
- `agent.yaml` - Manifest with model from settings.json
- `SOUL.md` - Identity sections from GEMINI.md
- `RULES.md` - Constraint sections from GEMINI.md
- `DUTIES.md` - SOD/delegation sections (if present)
- `tools/*.yaml` - Tool definitions from allowedTools
- `hooks/hooks.yaml` - Hooks from settings.json

## Section Detection (Import)

When importing `GEMINI.md`, sections are split based on keywords:

**→ SOUL.md:**
- Sections with: identity, personality, style, about, soul
- Default destination for unmatched sections

**→ RULES.md:**
- Sections with: rule, constraint, never, always, must, compliance

**→ DUTIES.md:**
- Sections with: duties, segregation, delegation

## What Maps Cleanly

✅ **Fully Supported:**
- Agent identity and personality (SOUL.md ↔ GEMINI.md)
- Rules and constraints (RULES.md ↔ GEMINI.md)
- Model preferences
- Tool permissions
- Approval modes
- Basic hooks
- Knowledge documents

## What Requires Manual Setup

⚠️ **Not Automatically Mapped:**

### 1. MCP Servers
**Issue:** Gemini CLI's MCP server config doesn't have a direct gitagent equivalent.

**Workaround:**
- Document MCP servers in GEMINI.md during export
- Manually configure `.gemini/settings.json` → `mcpServers` after export
- On import, MCP config is ignored (not portable)

**Example Manual Setup:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
    }
  }
}
```

### 2. Extensions
**Issue:** Gemini CLI extensions are runtime-specific and not portable.

**Workaround:**
- Extensions are not exported or imported
- Document extension requirements in README
- Users must install extensions separately

### 3. Policy Files
**Issue:** Gemini's policy engine uses separate policy files that need manual creation.

**Workaround:**
- Export references policy files in settings.json if they exist in `compliance/`
- Import does not create policy files (only references them)
- Users must manually create policy files based on RULES.md

### 4. Sub-agents
**Issue:** Gemini CLI doesn't have native sub-agent support like gitagent.

**Workaround:**
- Export documents sub-agents as a "Delegation Pattern" section in GEMINI.md
- Import does not create sub-agent directories
- Users must manually implement delegation logic

### 5. Workflows
**Issue:** gitagent's SkillsFlow YAML doesn't map to Gemini CLI.

**Workaround:**
- Convert workflows to skills or document in instructions
- Not preserved during import/export cycle

### 6. API Keys
**Issue:** Gemini CLI requires Google AI Studio or Vertex AI credentials.

**Workaround:**
- Set `GOOGLE_API_KEY` environment variable
- Or configure Vertex AI credentials
- Document in agent README

## Hooks Mapping

### Event Name Mapping

| gitagent Event | Gemini CLI Event | Notes |
|---------------|------------------|-------|
| `on_session_start` | `SessionStart` | Runs at session initialization |
| `pre_tool_use` | `BeforeTool` | Runs before tool execution |
| `post_tool_use` | `AfterTool` | Runs after tool execution |
| `pre_response` | `AfterModel` | Runs after model generates response |
| `post_response` | `AfterAgent` | Runs after agent loop completes |
| `on_error` | `Notification` | Error notifications |
| `on_session_end` | `SessionEnd` | Runs at session cleanup |

### Hook Format

**gitagent (hooks/hooks.yaml):**
```yaml
hooks:
  on_session_start:
    - script: scripts/init.sh
      description: Initialize session
```

**Gemini CLI (.gemini/settings.json):**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "hook-0",
            "type": "command",
            "command": "bash hooks/scripts/init.sh",
            "description": "Initialize session"
          }
        ]
      }
    ]
  }
}
```

**Note:** On Windows, commands are prefixed with `bash` to enable execution through PowerShell. On Linux/macOS, the `bash` prefix is omitted.

## Best Practices

### When Exporting

1. **Use Gemini-compatible models** in `agent.yaml`:
   - `gemini-2.0-flash-exp`
   - `gemini-1.5-pro`
   - `gemini-1.5-flash`

2. **Set appropriate approval mode** via compliance config:
   ```yaml
   compliance:
     supervision:
       human_in_the_loop: critical  # → approvalMode: default
   ```

3. **Document MCP requirements** in README if your agent needs external tools

4. **Keep skills self-contained** - full instructions in SKILL.md

### When Importing

1. **Review split sections** - verify SOUL.md/RULES.md split is correct

2. **Add missing metadata** to agent.yaml:
   - Author, license, tags
   - Compliance frameworks
   - Dependencies

3. **Create proper tool schemas** - imported tools have minimal schemas

4. **Test the agent** with `gapman validate`

### When Running

1. **Set API key** before running:
   ```bash
   export GOOGLE_API_KEY=your-api-key
   ```

2. **Use appropriate approval mode** for your use case:
   - Development: `--approval-mode default`
   - Production: `--approval-mode plan`
   - Testing: `--approval-mode yolo` (use with caution)

3. **Monitor temporary workspace** - cleaned up automatically on exit

## Troubleshooting

### "gemini: command not found"

**Solution:**
```bash
npm install -g @google/generative-ai-cli
# Or
brew install google/tap/gemini
```

### "API key not configured"

**Solution:**
```bash
export GOOGLE_API_KEY=your-api-key-here
# Or configure Vertex AI credentials
```

### "GEMINI.md not found" (import)

**Solution:**
- Ensure you're pointing to the project root directory
- Gemini CLI projects must have GEMINI.md at the root

### Tools not working after import

**Solution:**
- Imported tool schemas are minimal placeholders
- Manually update `tools/*.yaml` with proper input schemas
- Or use Gemini CLI's native tool configuration

## Resources

- [Gemini CLI GitHub](https://github.com/google/generative-ai-cli)
- [Gemini CLI Documentation](https://geminicli.com/docs)
- [Google AI Studio](https://aistudio.google.com/)
- [gitagent Specification](../../spec/SPECIFICATION.md)
- [Example Gemini Agent](../../examples/gemini-example/)

## Limitations Summary

| Feature | Export | Import | Run | Notes |
|---------|--------|--------|-----|-------|
| Identity (SOUL.md) | ✅ | ✅ | ✅ | Full support |
| Rules (RULES.md) | ✅ | ✅ | ✅ | Full support |
| Duties (DUTIES.md) | ✅ | ✅ | ✅ | Full support |
| Skills | ✅ | ⚠️ | ✅ | Import creates basic structure |
| Tools | ✅ | ⚠️ | ✅ | Import creates minimal schemas |
| Model preference | ✅ | ✅ | ✅ | Full support |
| Approval modes | ✅ | ✅ | ✅ | Full support |
| Hooks | ✅ | ✅ | ✅ | Full support |
| Knowledge | ✅ | ❌ | ✅ | Not preserved on import |
| Sub-agents | ⚠️ | ❌ | ⚠️ | Documented only, not executable |
| Workflows | ❌ | ❌ | ❌ | Not supported |
| MCP servers | ⚠️ | ❌ | ⚠️ | Manual setup required |
| Extensions | ❌ | ❌ | ❌ | Not portable |
| Policy files | ⚠️ | ⚠️ | ⚠️ | References only |

**Legend:**
- ✅ Fully supported
- ⚠️ Partial support or manual setup required
- ❌ Not supported
