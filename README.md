# bab-plugins

First-party Bab delegate plugins that are installed externally instead of being bundled with `bab`.

## Install

Install all plugins from this repository:

```bash
bab add git@github.com:zaherg/plugins.git
```

Install non-interactively:

```bash
bab add git@github.com:zaherg/plugins.git --yes
```

## Included Plugins

- `claude` — Claude Code
- `codex` — Codex CLI
- `copilot` — GitHub Copilot CLI

`opencode` stays bundled in the main `bab` repository as the reference plugin.

## Repository Layout

```text
claude/
codex/
copilot/
```

Each plugin directory contains:

- `manifest.yaml`
- `adapter.ts`
- `prompts/`
- optional supporting docs such as `RESEARCH.md`

## Requirements

Each plugin requires its underlying CLI to be installed and authenticated separately.

- `claude` requires the `claude` CLI
- `codex` requires the `codex` CLI
- `copilot` requires the standalone `copilot` CLI

For Copilot CLI installation and auth, use the official docs:

- https://github.com/features/copilot/cli
- https://docs.github.com/copilot/how-tos/copilot-cli

## Tool Prompts

Plugins can provide custom system prompts for bab's workflow tools. Add a `tool_prompts` section to your `manifest.yaml`:

```yaml
tool_prompts:
  codereview: prompts/codereview.txt
  debug: prompts/debug.txt
  secaudit: prompts/secaudit.txt
```

Each key is a tool name, and the value is a path to a plain text file relative to the plugin directory. The prompt **replaces** the built-in system prompt when a tool routes through a plugin model (e.g. `copilot/gpt-4`). If a tool is not listed, bab uses its built-in prompt.

Available tool names:

| Tool | Description |
|------|-------------|
| `chat` | General conversation |
| `challenge` | Challenge/critique ideas |
| `thinkdeep` | Deep thinking/reasoning |
| `codereview` | Code review |
| `debug` | Debugging assistance |
| `analyze` | Code analysis |
| `refactor` | Refactoring suggestions |
| `testgen` | Test generation |
| `secaudit` | Security audit |
| `docgen` | Documentation generation |
| `tracer` | Trace/flow analysis |
| `precommit` | Pre-commit checks |
| `planner` | Planning tasks |
| `consensus` | Multi-model consensus |

See [Plugin Authoring](https://zaherg.github.io/bab/plugin-authoring/#tool-prompts) for full details on precedence and behavior.

## Copilot Plugin — Permissions

By default the Copilot adapter does **not** pass `--allow-all` to the CLI. This means the Copilot CLI will run with its default (restricted) permissions.

To opt in to full filesystem and network access, add `allow_all: true` to the role's `args` in your manifest or role config:

```yaml
roles:
  - name: default
    args:
      allow_all: true
```

Or pass it at call time via the `delegate` tool's role args. Only enable this if you understand the implications — it grants the Copilot CLI process unrestricted access to your machine.
