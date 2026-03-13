# Copilot CLI Research

Date: 2026-03-10

## Sources

- GitHub Docs: https://docs.github.com/copilot/how-tos/copilot-cli
- GitHub CLI manual: https://cli.github.com/manual/gh_copilot
- GitHub product page: https://github.com/features/copilot/cli

## Local environment

- Current product docs position `copilot` as the direct install path
- `gh copilot` may exist as a wrapper entrypoint, but it is not the primary integration target for this plugin

## Findings

### Invocation

- Current installation is the standalone `copilot` CLI
- `gh copilot` exists as a launcher/wrapper, but it is not the primary install target
- The Copilot CLI accepts non-interactive prompts via:
  - `-p, --prompt <text>`
- Working headless example:

```bash
copilot -p "reply with exactly ok" \
  --allow-all \
  --output-format json \
  --no-ask-user \
  --no-color \
  --stream off
```

### Output format

- `--output-format json` emits JSONL-style events, one JSON object per line
- Observed event types include:
  - `user.message`
  - `assistant.turn_start`
  - `assistant.message`
  - `assistant.reasoning`
  - `tool.execution_start`
  - `tool.execution_complete`
  - `assistant.turn_end`
  - `result`
- The terminal `result` event includes:
  - `sessionId`
  - `exitCode`
  - `usage`

Observed success sample:

```json
{"type":"assistant.message","data":{"content":"ok"}}
{"type":"result","sessionId":"...","exitCode":0,"usage":{"premiumRequests":1}}
```

### Prompt injection

- Copilot has no native system-prompt flag comparable to Claude's `--append-system-prompt`
- The adapter should prepend the resolved role prompt to the user prompt and pass the combined string via `-p`

### Auth

- Authentication can happen through the standalone CLI flow or token-based env vars
- The adapter should not hard-require `gh auth status`
- No separate API key is required when the Copilot CLI is already authenticated

### Headless / auto-approve

- Headless mode exists and is suitable for delegated execution
- Required flags:
  - `-p` for non-interactive execution
  - `--allow-all-tools` or `--allow-all`
- Useful companion flags:
  - `--allow-all-paths`
  - `--allow-all-urls`
  - `--no-ask-user`
  - `--stream off`
  - `--no-color`

### PTY vs pipe

- Works with stdout piped
- JSON output is consumable without a PTY
- No color can be disabled explicitly

### Roles

- Built-in roles map cleanly: `default`, `planner`, `codereviewer`
- A Copilot-specific explanatory role is reasonable because the CLI is optimized around general coding assistance rather than fixed subcommands

### Decision

- Implement as an adapter-backed plugin
- Parse JSONL event output, recover content on non-zero exit if parseable, and emit a single `output` event plus `done` metadata
