import { spawnSync } from "node:child_process";

const PROVIDER_ID = "copilot";
const BASE_ARGS = [
  "--output-format",
  "json",
] as const;

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractErrorMessage(
  event: Record<string, unknown>,
): string | undefined {
  const directMessage = normalizeText(event.message);

  if (directMessage) {
    return directMessage;
  }

  const error = event.error;

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const typedError = error as Record<string, unknown>;
    return normalizeText(typedError.message);
  }

  return undefined;
}

export function parseCopilotJsonOutput(
  stdout: string,
  stderr = "",
): { content: string; metadata: Record<string, unknown> } {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const assistantMessages: string[] = [];
  const errors: string[] = [];
  const metadata: Record<string, unknown> = {};

  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }

    let parsedLine: unknown;

    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      !parsedLine ||
      typeof parsedLine !== "object" ||
      Array.isArray(parsedLine)
    ) {
      continue;
    }

    const event = parsedLine as Record<string, unknown>;
    const eventType = normalizeText(event.type);

    if (eventType === "assistant.message" || eventType === "message") {
      const data = event.data;

      if (data && typeof data === "object" && !Array.isArray(data)) {
        const content = normalizeText(
          (data as Record<string, unknown>).content,
        );

        if (content) {
          assistantMessages.push(content);
        }
      }

      const directContent = normalizeText(event.content);

      if (directContent) {
        assistantMessages.push(directContent);
      }
    } else if (eventType === "text") {
      const content = normalizeText(event.content) ?? normalizeText(event.text);

      if (content) {
        assistantMessages.push(content);
      }
    } else if (eventType === "error") {
      const message = extractErrorMessage(event);

      if (message) {
        errors.push(message);
      }
    } else if (eventType === "result") {
      const sessionId = normalizeText(event.sessionId);

      if (sessionId) {
        metadata.session_id = sessionId;
      }

      const usage = event.usage;

      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        metadata.usage = usage as Record<string, unknown>;
      }

      const exitCode = event.exitCode;

      if (typeof exitCode === "number") {
        metadata.exit_code = exitCode;
      }
    }
  }

  if (assistantMessages.length === 0 && errors.length > 0) {
    assistantMessages.push(...errors);
    metadata.errors = errors;
  }

  if (stderr.trim()) {
    metadata.stderr = stderr.trim();
  }

  if (assistantMessages.length === 0) {
    const plaintext = lines
      .filter((line) => !line.startsWith("{"))
      .join("\n")
      .trim();

    if (plaintext) {
      assistantMessages.push(plaintext);
      metadata.fallback_plaintext = true;
    }
  }

  if (assistantMessages.length === 0) {
    throw new Error(
      "Copilot CLI JSON output did not include an assistant message",
    );
  }

  return {
    content: assistantMessages.join("\n\n"),
    metadata,
  };
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
    const rolePrompt = input.role.prompt.trim();
    const fullPrompt = rolePrompt
      ? `${rolePrompt}\n\n${input.prompt}`
      : input.prompt;
    // Note: Copilot CLI requires -p for non-interactive mode and does not
    // support stdin input. The prompt is visible in the process table (ps).
    const args: string[] = [...BASE_ARGS, "-p", fullPrompt];

    const ALLOWED_FLAGS = new Set([
      "allow-all", "model", "temperature", "max-tokens",
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

    return { args, env: input.env };
  },
  discover() {
    return {
      command: "copilot",
      id: PROVIDER_ID,
      name: "GitHub Copilot CLI",
      output_format: "jsonl",
      roles: ["default", "planner", "codereviewer", "explainer"],
    };
  },
  listModels(): string[] {
    const result = spawnSync("copilot", ["--help"], {
      env: process.env,
      encoding: "utf8",
    });

    const output = `${result.stdout}\n${result.stderr}`;
    const match = output.match(/--model <model>\s+.*?\(choices:\s*(.*?)\)/s);

    if (!match?.[1]) {
      return [];
    }

    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  },
  parseResult(
    result: { exitCode: number | null; stderr: string; stdout: string },
  ) {
    if (result.exitCode !== 0 && !result.stdout.trim()) {
      const errorMessage =
        result.stderr.trim() || `Copilot CLI exited with status ${result.exitCode}`;
      throw new Error(errorMessage);
    }

    return parseCopilotJsonOutput(result.stdout, result.stderr);
  },
  validate() {
    if (!Bun.which("copilot")) {
      throw new Error("Copilot CLI binary `copilot` was not found on PATH");
    }
  },
};

export default adapter;
