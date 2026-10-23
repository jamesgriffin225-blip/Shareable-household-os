import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isKnownTool } from "../tools.ts";
import { CATEGORIES } from "../types.ts";
import {
  captureSystem,
  captureUserText,
  emailSystem,
  emailUserText,
  jsonContract,
} from "./prompts.ts";
import type {
  AskInput,
  CaptureInput,
  LlmBackend,
  MailInput,
  ParseResult,
  ToolCall,
} from "./types.ts";

/**
 * The `claude -p` backend.
 *
 * Claude Code's CLI is not the Messages API: there is no way to hand it a tool
 * schema, no `tool_use` blocks come back, and images arrive by being read off
 * disk rather than as content blocks. So this backend asks for JSON in the
 * prompt and parses it, and writes a photo into a temp directory that it makes
 * the CLI's working directory so the Read tool can reach it.
 *
 * What makes that affordable is that `runToolCall` never cared where its input
 * came from — it validates and normalises every field regardless — so a parsed
 * JSON object and a `tool_use.input` are the same thing by the time they land.
 *
 * What it costs is real and worth knowing: no schema enforcement, so malformed
 * output is a case to handle rather than an impossibility; and a failure is an
 * exit code and some stderr rather than a typed error.
 */

/**
 * A model name, and nothing that could be read as a flag.
 *
 * The first character must be alphanumeric. `^[A-Za-z0-9._-]+$` allowed a
 * leading dash, so `--dangerously-skip-permissions` passed the check and
 * went to the CLI as `--model --dangerously-skip-permissions`. This one
 * rejected it because it treats the value as a model name, but a check whose
 * safety depends on how the other side happens to parse its arguments is not
 * a check. Found by a test written for a different reason.
 */
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function binary(): string {
  return process.env.CLAUDE_CLI_PATH || "claude";
}

function model(): string {
  const configured = process.env.CLAUDE_CLI_MODEL || "opus";
  if (!MODEL_PATTERN.test(configured)) {
    throw new Error(`CLAUDE_CLI_MODEL "${configured}" is not a usable model name`);
  }
  return configured;
}

/**
 * The model for the high-volume email path.
 *
 * `CLAUDE_CLI_EMAIL_MODEL` is deliberately no longer read. It existed as a
 * cost lever, and cost per token is an API-backend idea: this backend shells
 * out to a signed-in Claude Code, where the constraint is the subscription's
 * allowance and not a bill. Haiku was saving money that was never being
 * spent, and paying for it in the one judgement that decides whether the
 * feature works at all -- whether an email is something this household needs.
 *
 * Sonnet by default rather than the main model, which is usually opus. Every
 * `claude -p` carries Claude Code's own system prompt, so a single message
 * costs roughly 35k tokens before ours is counted; at a few dozen a day that
 * allowance is worth protecting. Sonnet is where the judgement is sound and
 * the allowance is not the binding constraint.
 *
 * An explicit choice from the household wins over all of it.
 */
export const DEFAULT_CLI_EMAIL_MODEL = "sonnet";

function emailModel(override?: string | null): string {
  const configured = override?.trim() || DEFAULT_CLI_EMAIL_MODEL;
  if (!MODEL_PATTERN.test(configured)) {
    throw new Error(`"${configured}" is not a usable model name`);
  }
  return configured;
}

function timeoutMs(): number {
  return Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 120_000);
}

interface RunOptions {
  model: string;
  /** Directory the CLI runs in — also the only place its Read tool can reach. */
  cwd?: string;
  allowRead?: boolean;
}

/** Spawn the CLI, feed the prompt on stdin, return its stdout. */
/**
 * What a failing CLI run actually said.
 *
 * Asked for `--output-format json`, the CLI prints its result envelope on
 * stdout and exits non-zero. That envelope leads with timing and token
 * counters and carries the human-readable reason in `result` further in, so
 * quoting the first few hundred characters shows a wall of zeros and cuts
 * off the only sentence worth reading. `readEnvelope` has always known how
 * to find it, but it is only reached on a clean exit.
 *
 * Preference order: the envelope's own message, then stderr, then whatever
 * raw text there is -- each one more specific than the next.
 */
/**
 * `loggedIn` out of `claude auth status`, or null when it cannot be told.
 *
 * Null rather than false for anything unrecognised: an older CLI without the
 * subcommand must not be read as signed out, which would stop a working
 * machine scanning.
 */
/**
 * The last time a real call failed, and what it said.
 *
 * Evidence beats a probe. `--version` could not fail the way a signed-out
 * CLI fails, so it reported health for days while nothing worked; `auth
 * status` is better but still answers a different question -- it can confirm
 * a credential exists on disk while the token behind it is expired and
 * unrefreshable, which is exactly the failure being chased. The one thing
 * that cannot be wrong about whether calls are working is a call.
 */
let lastFailure: { at: number; message: string } | null = null;

/** Roughly a scan cycle: older than this and it is history, not the state. */
const FAILURE_FRESH_MS = 30 * 60_000;

export function noteCliFailure(message: string): void {
  lastFailure = { at: Date.now(), message };
}

export function clearCliFailure(): void {
  lastFailure = null;
}

/** An authentication failure specifically, since that one needs a person. */
export function looksLikeAuthFailure(message: string): boolean {
  return /authenticat|oauth|session expired|not logged in|unauthoriz|\b401\b/i.test(message);
}

export function recentCliFailure(): { message: string; auth: boolean } | null {
  if (!lastFailure) return null;
  if (Date.now() - lastFailure.at > FAILURE_FRESH_MS) return null;
  return { message: lastFailure.message, auth: looksLikeAuthFailure(lastFailure.message) };
}

export function readSignedIn(stdout: string): boolean | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof parsed.loggedIn === "boolean") {
        return parsed.loggedIn;
      }
    } catch {
      /* not JSON; try the next shape */
    }
  }
  // Plain-text output from an older CLI. Only an explicit denial counts.
  if (/\bnot logged in\b|\blogged out\b|\bsigned out\b/i.test(trimmed)) return false;
  return null;
}

export function describeCliFailure(stdout: string, stderr: string): string {
  const out = stdout.trim();

  const candidates: string[] = [];
  if (out) {
    candidates.push(out);
    const first = out.indexOf("{");
    const last = out.lastIndexOf("}");
    if (first !== -1 && last > first) candidates.push(out.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const envelope = JSON.parse(candidate);
      if (!envelope || typeof envelope !== "object") continue;
      for (const value of [
        envelope.result,
        envelope.error?.message,
        envelope.error,
        envelope.message,
        envelope.subtype,
      ]) {
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 600);
      }
    } catch {
      /* not this shape; try the next */
    }
  }

  const raw = stderr.trim() || out;
  return raw ? raw.slice(0, 600) : "";
}

export function runCli(prompt: string, options: RunOptions): Promise<string> {
  const args = ["-p", "--output-format", "json", "--model", options.model];
  if (options.allowRead) {
    args.push("--allowedTools", process.env.CLAUDE_CLI_ALLOWED_TOOLS || "Read");
  }

  const limit = timeoutMs();

  return new Promise((resolve, reject) => {
    const child = spawn(binary(), args, {
      cwd: options.cwd,
      // On Windows the CLI is a .cmd shim, which spawn cannot exec directly.
      // Every argument here is ours and pattern-checked; the prompt itself
      // goes over stdin and never touches a command line.
      shell: process.platform === "win32",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    // The timeout is ours rather than spawn's `timeout` option, and it settles
    // the promise itself. Killing the CLI does not necessarily close the pipe:
    // anything it spawned inherits stdout and can hold it open long after the
    // parent is gone, so waiting for `close` would leave a web request hanging
    // well past the deadline it was given.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      const message = `Claude CLI timed out after ${limit}ms`;
      noteCliFailure(message);
      reject(new Error(message));
    }, limit);
    // Do not keep the process alive just for this timer.
    timer.unref?.();

    const finish = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        // What the health probe will believe over its own opinion.
        noteCliFailure(error.message);
        reject(error);
      } else {
        clearCliFailure();
        resolve(value!);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) =>
      finish(new Error(`Could not run "${binary()}": ${error.message}`)),
    );

    child.on("close", (code) => {
      if (code === 0) {
        finish(null, stdout);
        return;
      }
      // No enumerated exit codes to switch on, so the message is whatever the
      // CLI said. Rate limits arrive here too.
      //
      // Both streams, not just stderr. Asked for --output-format json, the
      // CLI reports its own failures as a JSON object on STDOUT and exits
      // non-zero, so reading stderr alone produced a bare "Claude CLI exited
      // 1" while the reason sat in a variable three lines up. The model is
      // named because an id this CLI will not accept is a leading cause and
      // the message otherwise never says which one was asked for.
      const detail = describeCliFailure(stdout, stderr);
      finish(
        new Error(
          `Claude CLI exited ${code} (model ${options.model})` +
            (detail ? `: ${detail}` : " and printed nothing to stdout or stderr"),
        ),
      );
    });

    child.stdin.on("error", () => {
      // The CLI can exit before reading stdin; the close handler reports it.
    });
    child.stdin.end(prompt, "utf8");
  });
}

/** Pull the assistant's text out of `--output-format json`'s envelope. */
export function readEnvelope(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Claude CLI returned nothing");

  try {
    const envelope = JSON.parse(trimmed);
    if (envelope && typeof envelope === "object") {
      if (envelope.is_error) {
        throw new Error(
          `Claude CLI reported an error: ${String(envelope.result ?? envelope.subtype ?? "unknown")}`,
        );
      }
      const text = envelope.result ?? envelope.text ?? envelope.content;
      if (typeof text === "string") return text;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Claude CLI reported")) {
      throw error;
    }
    // Not an envelope at all — an older CLI, or plain text output. Use it.
    return trimmed;
  }
  return trimmed;
}

/**
 * Find the JSON object in a reply.
 *
 * Nothing enforces the output contract, so the model sometimes fences it, and
 * sometimes says "Here you go:" first. Both are recoverable; anything else
 * raises, and the caller retries once.
 */
export function extractJson(text: string): Record<string, any> {
  const withoutFence = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const candidates = [withoutFence];
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(withoutFence.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error("Claude CLI did not return parseable JSON");
}

/** Turn the parsed object into the same shape the API backend produces. */
export function readActions(parsed: Record<string, any>): ParseResult {
  const calls: ToolCall[] = [];
  // Everything discarded, with the reason. The old version dropped three
  // different things in silence -- a reply with no `actions` array, an entry
  // that was not an object, and an unrecognised action name -- and all three
  // came out the far end as "the model decided to do nothing", which is a
  // different claim entirely. The comment below used to say that dropping
  // silently was worse than absent, and then did it anyway.
  const dropped: string[] = [];

  if (!Array.isArray(parsed.actions)) {
    const keys = Object.keys(parsed);
    dropped.push(
      keys.length === 0
        ? "The reply was an empty JSON object: no actions, and nothing else either."
        : `The reply had no "actions" array. Its keys were: ${keys.join(", ")}.`,
    );
  }

  const raw = Array.isArray(parsed.actions) ? parsed.actions : [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") {
      dropped.push(`Action ${index + 1} was ${typeof entry}, not an object.`);
      continue;
    }
    const name = typeof entry.action === "string" ? entry.action : "";
    // An invented action name is still dropped rather than guessed at -- the
    // executor would reject it anyway -- but it is named on the way out.
    if (!isKnownTool(name)) {
      dropped.push(
        name
          ? `Action ${index + 1} named "${name}", which is not one of the tools.`
          : `Action ${index + 1} had no "action" name. Its keys were: ${Object.keys(entry).join(", ")}.`,
      );
      continue;
    }

    const input: Record<string, any> = { ...entry };
    delete input.action;
    calls.push({ id: `cli-${index}`, name, input });
  }

  return {
    calls,
    reply: typeof parsed.reply === "string" ? parsed.reply.trim() : "",
    ...(dropped.length > 0 ? { dropped } : {}),
  };
}

const RETRY_NUDGE =
  "\n\nYour previous reply was not a single valid JSON object. Reply with the " +
  "JSON object only — no prose, no markdown fence.";

async function askForJson(
  prompt: string,
  options: RunOptions,
): Promise<ParseResult> {
  try {
    return readActions(extractJson(readEnvelope(await runCli(prompt, options))));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("parseable JSON")) {
      throw error;
    }
    // One retry, because without a schema this is a thing that happens.
    return readActions(
      extractJson(readEnvelope(await runCli(prompt + RETRY_NUDGE, options))),
    );
  }
}

export const cliBackend: LlmBackend = {
  name: "cli",

  configured() {
    return true;
  },

  async parseCapture(input: CaptureInput): Promise<ParseResult> {
    // The CLI's Read tool can only reach its working directory, so the photo
    // is written into a temp directory that becomes exactly that.
    let workspace: string | null = null;
    try {
      let imageLine = "";
      if (input.image) {
        workspace = await mkdtemp(join(tmpdir(), "household-"));
        const extension = input.image.mediaType.split("/")[1] || "jpg";
        const filename = `capture.${extension.replace(/[^a-z0-9]/gi, "")}`;
        await writeFile(
          join(workspace, filename),
          Buffer.from(input.image.data, "base64"),
        );
        imageLine = `\nRead the image file ./${filename} in this directory before answering.\n`;
      }

      const prompt = [
        captureSystem({
          image: Boolean(input.image),
          kind: input.kind,
          context: input.context,
        }),
        "",
        jsonContract(),
        imageLine,
        "---",
        captureUserText({
          text: input.text,
          image: Boolean(input.image),
          kind: input.kind,
        }),
      ].join("\n");

      return await askForJson(prompt, {
        model: model(),
        cwd: workspace ?? undefined,
        allowRead: Boolean(input.image),
      });
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  },

  async classifyEmail(input: MailInput): Promise<ParseResult> {
    const prompt = [
      emailSystem(input.context),
      "",
      jsonContract(),
      "",
      "---",
      emailUserText({
        mailbox: input.mailbox,
        from: input.mail.from,
        subject: input.mail.subject,
        receivedAt: input.mail.receivedAt,
        body: input.mail.body,
      }),
    ].join("\n");

    // Deliberately not caught here.
    //
    // This used to swallow every failure and return { calls: [], reply: "" },
    // on the grounds that an unattended scan must not stop at one unreadable
    // message. That reasoning is right and the protection already exists one
    // level up, where scanMailboxes catches per message, releases the claim,
    // counts the failure and holds the watermark open. What this added was a
    // second, worse copy that threw the reason away first -- a dead CLI came
    // back as a successful classification with nothing in it, which is
    // indistinguishable from a model that read the email and chose to do
    // nothing. That one lie cost a week of looking in the wrong places.
    return await askForJson(prompt, { model: emailModel(input.model) });
  },

  async categorise(name: string): Promise<string> {
    const prompt =
      `Reply with exactly one of these supermarket sections and nothing else: ` +
      `${CATEGORIES.join(", ")}.\n\n---\n${name}`;
    const reply = readEnvelope(await runCli(prompt, { model: emailModel() }));
    return reply.trim().split("\n")[0].trim();
  },

  async ask({ question, briefing, system }: AskInput): Promise<string> {
    const prompt = `${system}\n\n${briefing}\n\n---\n\nQuestion: ${question}`;
    return readEnvelope(await runCli(prompt, { model: model() })).trim();
  },

  /**
   * Whether this backend can actually do its job.
   *
   * It used to run `--version`, which needs no account and therefore proves
   * only that a binary exists. The Surface's OAuth session expired and the
   * probe went on reporting "reachable" for days while every single call
   * failed with "Failed to authenticate: OAuth session expired and could not
   * be refreshed". A check that cannot fail the way the thing it checks fails
   * is not a check.
   *
   * `auth status` answers the real question, costs no tokens and makes no API
   * call. An older CLI that does not have the subcommand, or prints something
   * other than JSON, is treated as healthy rather than broken: refusing to
   * scan because a probe is unfamiliar would be a worse failure than the one
   * being prevented.
   */
  async health() {
    const run = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(binary(), args, {
          shell: process.platform === "win32",
          timeout: 15_000,
          env: process.env,
        });
        let out = "";
        let err = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (err += chunk));
        child.on("error", reject);
        child.on("close", (code, signal) => {
          if (code === 0) {
            resolve(out.trim());
            return;
          }
          // Same trap as runCli: say what it said, not just that it failed.
          const detail = err.trim() || out.trim();
          reject(
            new Error(
              signal
                ? `killed (${signal})`
                : `exit code ${code}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
            ),
          );
        });
        // Close stdin immediately: a CLI that reads it would otherwise sit
        // here until the timeout, and a settings page would appear to hang.
        child.stdin.end();
      });

    // Evidence first. A real call that failed recently outranks anything a
    // probe can say, because the probe asks a different question: `auth
    // status` confirms a credential exists on disk, and the failure here was
    // a token that existed and could no longer be refreshed. Reporting
    // "reachable" on top of a live authentication failure is the same mistake
    // `--version` made, one subcommand further along.
    const failure = recentCliFailure();
    if (failure?.auth) {
      return {
        ok: false,
        detail:
          `Signed out: the last call failed with "${failure.message.slice(0, 160)}". ` +
          "Press Sign in below, then finish it on this screen.",
      };
    }

    try {
      const status = await run(["auth", "status"]);
      const signedIn = readSignedIn(status);
      if (signedIn === false) {
        return {
          ok: false,
          detail:
            "Claude Code is signed out on this machine, so nothing can be " +
            "classified. Press Sign in below, then finish it on this screen.",
        };
      }
      if (failure) {
        // Not an auth failure, but calls are still failing, and a green row
        // above a broken scanner is worse than no row.
        return {
          ok: false,
          detail: `The last call failed: ${failure.message.slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        detail:
          signedIn === true
            ? `${binary()} signed in, model ${model()}`
            : // The raw answer, because a parser that did not recognise it is
              // exactly how a signed-out machine kept reporting health.
              `${binary()} running, model ${model()} — auth status said: ${
                status.replace(/\s+/g, " ").trim().slice(0, 160) || "nothing"
              }`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `Cannot run "${binary()}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
