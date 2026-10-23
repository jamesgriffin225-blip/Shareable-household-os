import Anthropic from "@anthropic-ai/sdk";
import { HOUSEHOLD_TOOLS, isKnownTool } from "../tools.ts";
import { CATEGORIES } from "../types.ts";
import {
  captureSystem,
  captureUserText,
  emailSystem,
  emailUserText,
} from "./prompts.ts";
import type {
  AskInput,
  CaptureInput,
  LlmBackend,
  MailInput,
  ParseResult,
  ToolCall,
} from "./types.ts";

const EFFORT = (process.env.CLAUDE_EFFORT || "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!client) client = new Anthropic();
  return client;
}

function model(): string {
  return process.env.CLAUDE_MODEL || "claude-opus-5";
}

/** The cheap model for the high-volume path, when one is configured. */
/**
 * The cheaper model for the high-volume paths.
 *
 * Still honoured here, unlike on the CLI backend: this one is billed per
 * token, so the saving is real money and most of the monthly bill is email.
 * A household choice still outranks it.
 */
function emailModel(override?: string | null): string {
  return override?.trim() || process.env.CLAUDE_EMAIL_MODEL || model();
}

function extract(message: Anthropic.Message): ParseResult {
  const calls: ToolCall[] = [];
  const parts: string[] = [];

  for (const block of message.content) {
    if (block.type === "tool_use" && isKnownTool(block.name)) {
      calls.push({
        id: block.id,
        name: block.name,
        // Parsed JSON from the SDK; never string-matched.
        input: (block.input ?? {}) as Record<string, any>,
      });
    } else if (block.type === "text" && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }

  return { calls, reply: parts.join("\n") };
}

/** The Messages API: real tool definitions, real `tool_use` blocks, typed errors. */
export const apiBackend: LlmBackend = {
  name: "api",

  configured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async parseCapture(input: CaptureInput): Promise<ParseResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.image) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: input.image.mediaType as "image/png",
          data: input.image.data,
        },
      });
    }
    content.push({
      type: "text",
      text: captureUserText({
        text: input.text,
        image: Boolean(input.image),
        kind: input.kind,
      }),
    });

    const message = await anthropic().messages.create({
      model: model(),
      max_tokens: 8000,
      output_config: { effort: EFFORT },
      system: [
        captureSystem({
          image: Boolean(input.image),
          kind: input.kind,
          context: input.context,
        }),
        "",
        "Call no_action only when there is genuinely nothing to record.",
        "Any text you write outside a tool call is shown to the person as a",
        "short one-line confirmation, so keep it to a sentence at most.",
      ].join("\n"),
      tools: HOUSEHOLD_TOOLS,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    });

    if (message.stop_reason === "refusal") {
      throw new Error("Claude declined to process that capture");
    }
    return extract(message);
  },

  async classifyEmail(input: MailInput): Promise<ParseResult> {
    const message = await anthropic().messages.create({
      model: emailModel(input.model),
      max_tokens: 4000,
      output_config: { effort: EFFORT },
      system: emailSystem(input.context),
      tools: HOUSEHOLD_TOOLS,
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: emailUserText({
            mailbox: input.mailbox,
            from: input.mail.from,
            subject: input.mail.subject,
            receivedAt: input.mail.receivedAt,
            body: input.mail.body,
          }),
        },
      ],
    });

    // A refusal is an outcome with a name, not a quiet nothing. Same trap as
    // the CLI backend's old catch: an empty result reads as "no action needed".
    if (message.stop_reason === "refusal") {
      return { calls: [], reply: "", dropped: ["The model declined to answer this one."] };
    }
    return extract(message);
  },

  async categorise(name: string): Promise<string> {
    const message = await anthropic().messages.create({
      model: emailModel(),
      max_tokens: 200,
      output_config: { effort: "low" },
      system:
        "Reply with exactly one of these supermarket sections and nothing " +
        `else: ${CATEGORIES.join(", ")}.`,
      messages: [{ role: "user", content: name }],
    });
    const block = message.content.find((part) => part.type === "text");
    return block && block.type === "text" ? block.text.trim() : "Other";
  },

  async ask({ question, briefing, system }: AskInput): Promise<string> {
    const message = await anthropic().messages.create({
      model: model(),
      max_tokens: 500,
      system,
      messages: [
        { role: "user", content: `${briefing}\n\n---\n\nQuestion: ${question}` },
      ],
    });
    const block = message.content.find((part) => part.type === "text");
    return block && block.type === "text" ? block.text.trim() : "";
  },

  async health() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, detail: "ANTHROPIC_API_KEY is not set" };
    }
    return { ok: true, detail: `Messages API, ${model()}` };
  },
};
