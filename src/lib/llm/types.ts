import type { Profile } from "../types.ts";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ParseResult {
  calls: ToolCall[];
  reply: string;
  /**
   * What the parser threw away, in words, and why.
   *
   * Diagnostic only -- nothing downstream branches on it. It exists because
   * a reply that parses as JSON but carries no `actions` array produced an
   * empty result with no error and no retry, which is indistinguishable from
   * a model that read an email and decided it needed nothing. That one
   * ambiguity survived five rounds of debugging.
   */
  dropped?: string[];
}

export interface Context {
  capturedBy: Profile;
  profiles: Profile[];
  recipes: string[];
}

export interface CaptureInput {
  text?: string | null;
  image?: { mediaType: string; data: string } | null;
  kind: "voice" | "photo" | "text";
  context: Context;
}

export interface MailInput {
  mail: {
    id: string;
    from: string;
    subject: string;
    receivedAt: string;
    body: string;
    link: string | null;
  };
  mailbox: string;
  context: Context;
  /**
   * Which model to classify with, when the household has chosen one.
   *
   * Passed in rather than read from the environment, because the choice now
   * lives in Postgres: a value in `.env.local` cannot be changed on a wall
   * with no keyboard, which is the same reason playlists moved out of it.
   */
  model?: string | null;
}

export interface AskInput {
  question: string;
  /** The household written out, from `formatBriefing`. */
  briefing: string;
  system: string;
}

/**
 * What a backend has to be able to do.
 *
 * Deliberately narrow: the two implementations differ enormously underneath —
 * one posts JSON to an API, the other spawns a CLI and reads its stdout — but
 * everything downstream only ever sees tool calls, so both can serve the same
 * app without the executor knowing which one ran.
 */
export interface LlmBackend {
  readonly name: "api" | "cli";
  configured(): boolean;
  parseCapture(input: CaptureInput): Promise<ParseResult>;
  classifyEmail(input: MailInput): Promise<ParseResult>;
  categorise(name: string): Promise<string>;
  /**
   * Answer a question about the household, from a briefing and nothing else.
   *
   * Read-only: no tool calls come back, so there is no path from a question to
   * a change. Asking the wall something must never be a way to alter the house.
   */
  ask(input: AskInput): Promise<string>;
  /** Cheap liveness probe for the settings screen. */
  health(): Promise<{ ok: boolean; detail: string }>;
}
