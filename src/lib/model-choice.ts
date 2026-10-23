import { getState, setState } from "./db.ts";
import { backendName } from "./llm/index.ts";
import { DEFAULT_CLI_EMAIL_MODEL } from "./llm/cli.ts";

/**
 * Which model reads the household's email, kept where it can be changed.
 *
 * It lived in `.env.local` as `CLAUDE_CLI_EMAIL_MODEL=haiku`, which made it
 * unchangeable: the machine it governs is wall-mounted with no keyboard. That
 * is the same argument that moved playlists into Postgres -- a setting that
 * can only be edited by typing on that machine is a setting nobody will ever
 * edit, however wrong it turns out to be.
 *
 * The value it held was wrong. Haiku was chosen as a cost lever for the
 * high-volume path, and cost per token is an API-backend idea; the CLI
 * backend runs against a signed-in Claude Code where the constraint is an
 * allowance, not a bill. So it was buying nothing and spending the quality of
 * the one judgement the feature rests on.
 */
export const EMAIL_MODEL_KEY = "llm:email-model";

/**
 * What the household may pick, and what each one is for.
 *
 * Aliases rather than full model ids: the CLI resolves them to the current
 * model of that size, so a choice made today does not quietly pin the wall to
 * last year's model.
 */
export const EMAIL_MODEL_CHOICES = [
  {
    value: "",
    label: "Default",
    note: "Sonnet on this machine — good judgement, modest allowance.",
  },
  {
    value: "opus",
    label: "Opus",
    note: "The best reading of an ambiguous email, and the heaviest.",
  },
  {
    value: "sonnet",
    label: "Sonnet",
    note: "The balance this app is built around.",
  },
  {
    value: "haiku",
    label: "Haiku",
    note: "Cheapest and fastest. It misread a dated invitation as chatter.",
  },
] as const;

/** Letters, digits, dots and dashes: the same shape the backends will accept. */
const USABLE = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{0,63}$/;

export function isUsableModel(value: string): boolean {
  return USABLE.test(value);
}

/** The household's choice, or null to mean "whatever this backend defaults to". */
export async function emailModelChoice(): Promise<string | null> {
  try {
    const row = await getState<string>(EMAIL_MODEL_KEY);
    const value = typeof row?.value === "string" ? row.value.trim() : "";
    return value && isUsableModel(value) ? value : null;
  } catch {
    // No database, or no row yet. The backend's own default is the answer.
    return null;
  }
}

export async function setEmailModelChoice(value: string | null): Promise<void> {
  const next = value?.trim() ?? "";
  if (next && !isUsableModel(next)) throw new Error(`"${next}" is not a usable model name`);
  await setState(EMAIL_MODEL_KEY, next);
}

/** What to show on the settings screen when nothing has been chosen. */
export function defaultEmailModel(): string {
  return backendName() === "cli"
    ? DEFAULT_CLI_EMAIL_MODEL
    : process.env.CLAUDE_EMAIL_MODEL || process.env.CLAUDE_MODEL || "claude-opus-5";
}
