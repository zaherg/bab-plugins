const PROVIDER_ID = "claude";
const CLAUDE_ARGS = [
  "--print",
  "--output-format",
  "json",
  "--permission-mode",
  "plan",
  "--model",
  "sonnet",
];

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractClaudeMessage(
  payload: Record<string, unknown>,
): string | undefined {
  const message = normalizeText(payload.message);

  if (message) {
    return message;
  }

  const errorField = payload.error;

  if (errorField && typeof errorField === "object") {
    return normalizeText((errorField as Record<string, unknown>).message);
  }

  return undefined;
}

function buildClaudeMetadata(
  payload: Record<string, unknown>,
  stderr: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    is_error: Boolean(payload.is_error),
  };

  const durationMs = payload.duration_ms;

  if (typeof durationMs === "number") {
    metadata.duration_ms = durationMs;
  }

  const durationApiMs = payload.duration_api_ms;

  if (typeof durationApiMs === "number") {
    metadata.duration_api_ms = durationApiMs;
  }

  const usage = payload.usage;

  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    metadata.usage = usage as Record<string, unknown>;
  }

  const modelUsed = normalizeText(payload.model_used);

  if (modelUsed) {
    metadata.model_used = modelUsed;
  }

  const modelUsage = payload.modelUsage;

  if (
    modelUsage &&
    typeof modelUsage === "object" &&
    !Array.isArray(modelUsage)
  ) {
    metadata.model_usage = modelUsage;

    if (!metadata.model_used) {
      const firstModel = Object.keys(modelUsage as Record<string, unknown>)[0];

      if (firstModel) {
        metadata.model_used = firstModel;
      }
    }
  }

  const sessionId = normalizeText(payload.session_id);

  if (sessionId) {
    metadata.session_id = sessionId;
  }

  const uuid = normalizeText(payload.uuid);

  if (uuid) {
    metadata.uuid = uuid;
  }

  const stderrText = stderr.trim();

  if (stderrText) {
    metadata.stderr = stderrText;
  }

  return metadata;
}

export function parseClaudeJsonOutput(
  stdout: string,
  stderr = "",
): { content: string; metadata: Record<string, unknown> } {
  if (!stdout.trim()) {
    throw new Error(
      "Claude CLI returned empty stdout while JSON output was expected",
    );
  }

  let loaded: unknown;

  try {
    loaded = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Failed to decode Claude CLI JSON output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let payload: Record<string, unknown>;
  let assistantEntry: Record<string, unknown> | undefined;

  if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
    payload = loaded as Record<string, unknown>;
  } else if (Array.isArray(loaded)) {
    const events = loaded.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );

    const resultEntry = events.find(
      (item) => item.type === "result" || typeof item.result === "string",
    );

    assistantEntry = [...events]
      .reverse()
      .find((item) => item.type === "assistant");
    payload = resultEntry ?? assistantEntry ?? events.at(-1) ?? {};

    if (Object.keys(payload).length === 0) {
      throw new Error(
        "Claude CLI JSON array did not contain any parsable objects",
      );
    }
  } else {
    throw new Error("Claude CLI returned unexpected JSON payload");
  }

  const metadata = buildClaudeMetadata(payload, stderr);

  const result = payload.result;

  if (typeof result === "string" && result.trim()) {
    return {
      content: result.trim(),
      metadata,
    };
  }

  if (Array.isArray(result)) {
    const content = result
      .filter(
        (part): part is string =>
          typeof part === "string" && part.trim().length > 0,
      )
      .map((part) => part.trim())
      .join("\n");

    if (content) {
      return {
        content,
        metadata,
      };
    }
  }

  const message =
    extractClaudeMessage(payload) ??
    (assistantEntry ? extractClaudeMessage(assistantEntry) : undefined);

  if (message) {
    return {
      content: message,
      metadata,
    };
  }

  if (metadata.stderr) {
    return {
      content:
        "Claude CLI returned no textual result. Raw stderr was preserved for troubleshooting.",
      metadata,
    };
  }

  throw new Error("Claude CLI response did not contain a textual result");
}

const adapter = {
  buildCommand(input: {
    env?: Record<string, string>;
    prompt: string;
    role: {
      args: Record<string, string | number | boolean>;
      name: string;
      prompt: string;
    };
  }) {
    const args = [...CLAUDE_ARGS];
    const systemPrompt = input.role.prompt.trim();

    if (systemPrompt && !args.includes("--append-system-prompt")) {
      args.push("--append-system-prompt", systemPrompt);
    }

    const ALLOWED_FLAGS = new Set([
      "model", "max-turns", "temperature", "stop-sequences", "max-tokens",
    ]);

    for (const [name, value] of Object.entries(input.role.args ?? {})) {
      const normalized = name.replaceAll("_", "-");

      if (!ALLOWED_FLAGS.has(normalized)) {
        continue;
      }

      const flag = `--${normalized}`;

      if (typeof value === "boolean") {
        if (value) {
          args.push(flag);
        }
        continue;
      }

      args.push(flag, String(value));
    }

    // Strip CLAUDE_* env vars to avoid conflicts with the spawned Claude CLI
    const commandEnv: Record<string, string> = {};
    const sourceEnv = input.env ?? process.env;

    for (const [key, value] of Object.entries(sourceEnv)) {
      if (key.startsWith("CLAUDE_") || key === "CLAUDECODE") {
        continue;
      }

      if (typeof value === "string") {
        commandEnv[key] = value;
      }
    }

    return { args, stdin: input.prompt, env: commandEnv };
  },
  discover() {
    return {
      command: PROVIDER_ID,
      id: PROVIDER_ID,
      name: "Claude Code",
      output_format: "json",
      roles: ["default", "planner", "codereviewer"],
    };
  },
  parseResult(
    result: { exitCode: number | null; stderr: string; stdout: string },
  ) {
    const parsed = parseClaudeJsonOutput(result.stdout, result.stderr);

    if (result.exitCode !== 0) {
      const details = parsed.content
        ? ` Partial output: ${parsed.content}`
        : "";
      throw new Error(
        `Claude Code CLI exited with status ${result.exitCode}.${details}`,
      );
    }

    return parsed;
  },
  validate() {
    if (!Bun.which(PROVIDER_ID)) {
      throw new Error("Claude Code CLI binary `claude` was not found on PATH");
    }
  },
};

export default adapter;
