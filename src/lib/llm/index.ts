import { apiBackend } from "./api.ts";
import { cliBackend } from "./cli.ts";
import type {
  AskInput,
  CaptureInput,
  LlmBackend,
  MailInput,
  ParseResult,
} from "./types.ts";
import { normaliseCategory } from "../types.ts";

export type { AskInput, CaptureInput, MailInput, ParseResult, ToolCall } from "./types.ts";

/**
 * Which backend serves inference.
 *
 * `api` posts to the Messages API with real tool definitions — schema-enforced
 * arguments and typed errors, billed per token. `cli` shells out to `claude -p`
 * on a machine that is already signed in, asking for JSON instead of tools.
 *
 * Both produce the same tool calls, so everything downstream is identical. The
 * switch exists because which one holds up under a 3am mailbox scan is a
 * question you answer by running it, not by reasoning about it.
 */
export function backend(): LlmBackend {
  return (process.env.CLAUDE_BACKEND || "api").toLowerCase() === "cli"
    ? cliBackend
    : apiBackend;
}

export function claudeConfigured(): boolean {
  return backend().configured();
}

export function backendName(): "api" | "cli" {
  return backend().name;
}

export function backendHealth() {
  return backend().health();
}

/**
 * The model this deployment will actually use, which is backend-specific.
 *
 * It used to be `process.env.CLAUDE_MODEL` regardless, under a comment
 * promising exactly what it did not deliver: that is the API backend's
 * variable, and a machine running `CLAUDE_BACKEND=cli` takes its model from
 * `CLAUDE_CLI_MODEL` instead. So the settings screen confidently displayed a
 * model the machine was not using, and a wrong model id is a leading cause
 * of `claude -p` exiting 1.
 *
 * The email model is named when it differs, because the high-volume path is
 * deliberately a cheaper model and is therefore the one most likely to be
 * set to something the CLI will not accept.
 *
 * Read from the environment rather than through the backend's own accessor:
 * that one throws on a malformed name, and a settings screen that cannot
 * render because a value is wrong is the opposite of useful here.
 */
export function activeModel(): string {
  const cli = backendName() === "cli";
  const main = cli
    ? process.env.CLAUDE_CLI_MODEL || "opus"
    : process.env.CLAUDE_MODEL || "claude-opus-5";
  const email = cli ? process.env.CLAUDE_CLI_EMAIL_MODEL : process.env.CLAUDE_EMAIL_MODEL;
  return email && email !== main ? `${main}, email ${email}` : main;
}

export function parseCapture(input: CaptureInput): Promise<ParseResult> {
  return backend().parseCapture(input);
}

export function classifyEmail(input: MailInput): Promise<ParseResult> {
  return backend().classifyEmail(input);
}

/**
 * Answer a question about the household.
 *
 * The briefing is built by the caller and is all the model sees; nothing it
 * replies can change anything, because no tool call comes back.
 */
export function askHousehold(input: AskInput): Promise<string> {
  return backend().ask(input);
}

/** Aisle for an item typed straight onto the dashboard. */
export async function categoriseItem(name: string): Promise<string> {
  if (!claudeConfigured()) return "Other";
  try {
    return normaliseCategory(await backend().categorise(name));
  } catch (error) {
    console.error("[llm] categorise failed", error);
    return "Other";
  }
}
