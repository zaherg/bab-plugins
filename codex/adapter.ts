const PROVIDER_ID = "codex";
const CODEX_ARGS = [
    "exec",
    "--json",
    "--skip-git-repo-check",
];

export function parseCodexJsonlOutput(
    stdout: string,
    stderr = "",
): { content: string; metadata: Record<string, unknown> } {
    const lines = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    const agentMessages: string[] = [];
    const errors: string[] = [];
    const metadata: Record<string, unknown> = {};
    let usage: Record<string, unknown> | undefined;

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
        const eventType = event.type;

        if (eventType === "item.completed") {
            const item = event.item;

            if (item && typeof item === "object" && !Array.isArray(item)) {
                const typedItem = item as Record<string, unknown>;

                if (typedItem.type === "agent_message") {
                    const text = typedItem.text;

                    if (typeof text === "string" && text.trim()) {
                        agentMessages.push(text.trim());
                    }
                }
            }
        } else if (eventType === "error") {
            const message = event.message;

            if (typeof message === "string" && message.trim()) {
                errors.push(message.trim());
            }
        } else if (eventType === "turn.completed") {
            const turnUsage = event.usage;

            if (
                turnUsage &&
                typeof turnUsage === "object" &&
                !Array.isArray(turnUsage)
            ) {
                usage = turnUsage as Record<string, unknown>;
            }
        }
    }

    if (agentMessages.length === 0 && errors.length > 0) {
        agentMessages.push(...errors);
    }

    if (agentMessages.length === 0) {
        throw new Error(
            "Codex CLI JSONL output did not include an agent_message item",
        );
    }

    if (errors.length > 0) {
        metadata.errors = errors;
    }

    if (usage) {
        metadata.usage = usage;
    }

    const stderrText = stderr.trim();

    if (stderrText) {
        metadata.stderr = stderrText;
    }

    return {
        content: agentMessages.join("\n\n"),
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
        const args = [...CODEX_ARGS];

        const ALLOWED_FLAGS = new Set([
            "model", "temperature", "max-tokens", "enable", "profile",
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

        // Strip CODEX_* env vars to avoid conflicts with the spawned Codex CLI
        const commandEnv: Record<string, string> = {};

        for (const [key, value] of Object.entries(input.env ?? {})) {
            if (key.startsWith("CODEX_")) {
                continue;
            }

            commandEnv[key] = value;
        }

        return { args, stdin: fullPrompt, env: commandEnv };
    },
    discover() {
        return {
            command: PROVIDER_ID,
            id: PROVIDER_ID,
            name: "Codex CLI",
            output_format: "jsonl",
            roles: ["default", "planner", "codereviewer"],
        };
    },
    parseResult(
        result: { stderr: string; stdout: string },
    ) {
        return parseCodexJsonlOutput(result.stdout, result.stderr);
    },
    validate() {
        if (!Bun.which(PROVIDER_ID)) {
            throw new Error("Codex CLI binary `codex` was not found on PATH");
        }
    },
};

export default adapter;
