import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * What the mailbox scanner last did, and a way to make it do it now.
 *
 * It used to do neither. The scan ran every fifteen minutes from a task
 * registered `-WindowStyle Hidden` and wrote its report to stdout, so the one
 * subsystem built to work unattended was the only one that never said what it
 * found. "Nothing arrived" and "nothing ran" looked the same from the
 * kitchen, and an email that reached the inbox and produced nothing could not
 * be told from a mailbox that was never connected.
 *
 * Deliberately a mirror of `deploy.ts`: same log-tail shape, same
 * start-one-named-task-and-nothing-else rule. Nothing here takes a command
 * from the caller.
 */
const TASK = "Household email scan";
const LOG = "C:\\household\\scan.log";

export interface ScanMailbox {
  account: string | null;
  provider: string | null;
  messages: number;
  /** Why this mailbox was skipped, in words for a person. */
  note: string | null;
  error: string | null;
  needsReauth: boolean;
}

export interface ScanState {
  available: boolean;
  /** When the last scan ran, from the log line's own stamp. */
  at: string | null;
  scanned: number | null;
  actioned: number | null;
  queued: number | null;
  mailboxes: ScanMailbox[];
  /** Set when the last run failed outright rather than reporting. */
  failure: string | null;
  /** Set when the scan ran fine but could not look at anything. */
  blocked: string | null;
  log: string[];
}

export function scannable(): boolean {
  return process.platform === "win32";
}

const EMPTY: ScanState = {
  available: false,
  at: null,
  scanned: null,
  actioned: null,
  queued: null,
  mailboxes: [],
  failure: null,
  blocked: null,
  log: [],
};

/** `2026-10-09T13:05:01  scanned: {...}` or `...  failed: <message>`. */
const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s\s(scanned|failed):\s([\s\S]*)$/;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function mailbox(raw: unknown): ScanMailbox {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    account: text(row.account),
    provider: text(row.provider),
    messages: count(row.messages) ?? 0,
    note: text(row.note),
    error: text(row.error),
    needsReauth: row.needsReauth === true,
  };
}

/**
 * The last outcome in the log, whatever shape it arrived in.
 *
 * Written as a pure function of the text because the interesting cases are
 * the malformed ones -- a half-written line, a failure instead of a report, a
 * report whose `mailboxes` is a bare object because something along the way
 * unwrapped a one-element array. None of those should cost the screen the
 * rest of what it knows.
 */
export function parseScanLog(raw: string): Omit<ScanState, "available"> {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  const state: Omit<ScanState, "available"> = {
    at: null,
    scanned: null,
    actioned: null,
    queued: null,
    mailboxes: [],
    failure: null,
    blocked: null,
    log: lines.slice(-14),
  };

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = LINE.exec(lines[index]);
    if (!match) continue;
    const [, stamp, kind, rest] = match;
    state.at = stamp;

    if (kind === "failed") {
      state.failure = rest.trim() || "The scan failed without saying why.";
      return state;
    }

    try {
      const report = JSON.parse(rest) as Record<string, unknown>;
      state.blocked = text(report.blocked);
      state.scanned = count(report.scanned);
      state.actioned = count(report.actioned);
      state.queued = count(report.queued);
      const rows = report.mailboxes;
      state.mailboxes = Array.isArray(rows)
        ? rows.map(mailbox)
        : rows
          ? [mailbox(rows)]
          : [];
    } catch {
      // A truncated line is not a failed scan; it is a line we cannot read.
      state.failure = "The last scan's report could not be read.";
    }
    return state;
  }

  return state;
}

/**
 * `available` is about this app, not this operating system.
 *
 * It used to be `process.platform === "win32"`, back when the button started
 * a Windows scheduled task. The scan runs in this process now, so anywhere
 * the app runs it can scan -- and hiding the section everywhere else meant
 * the one screen that explains a failed scan was missing from every machine
 * where you might reproduce one. Only the log tail is still the wall's.
 */
export async function readScanState(): Promise<ScanState> {
  if (!scannable()) return { ...EMPTY, available: true };
  try {
    const raw = await readFile(LOG, "utf8");
    return { available: true, ...parseScanLog(raw) };
  } catch {
    // No log until the task has run once, which is itself the answer when
    // somebody is asking why nothing was filed.
    return { ...EMPTY, available: true };
  }
}

/**
 * Ask the scan task to run now.
 *
 * Fifteen minutes is the right cadence for a kitchen and the wrong one for
 * finding out why something did not arrive.
 */
export async function startScan(): Promise<{ started: boolean; detail: string }> {
  if (!scannable()) {
    return { started: false, detail: "Scanning from here only works on the wall." };
  }
  try {
    await run("schtasks", ["/run", "/tn", TASK], { timeout: 15_000, windowsHide: true });
    return { started: true, detail: "Scan started. It takes a moment per message." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      started: false,
      detail: /cannot find|does not exist/i.test(message)
        ? `No "${TASK}" scheduled task on this machine -- run scripts/setup-appliance.ps1 once.`
        : message,
    };
  }
}

export const SCAN_LOG_PATH = LOG;
