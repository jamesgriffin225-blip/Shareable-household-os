import { scanMailboxes, type InspectedMessage, type ScanReport, type ScanOptions } from "./scan.ts";
import type { ScanMailbox, ScanState } from "./scan-log.ts";

/**
 * Run a scan here, in this process, and keep the result where a screen can
 * read it.
 *
 * The Scan now button used to start a scheduled task, which launched
 * PowerShell, which read a secret out of .env.local, which made an HTTP
 * request back to THIS process -- so that the app could ask itself to do
 * something it was perfectly capable of doing directly. Every one of those
 * hops can fail silently on a machine nobody can log into, and between them
 * they hid the answer to "why did nothing arrive" through three separate
 * attempts at finding it.
 *
 * The scheduled task stays: unattended scanning every fifteen minutes is its
 * job, and it survives the app being down, which is exactly when you want it.
 * But a person pressing a button is not that, and should not be routed
 * through the one path that cannot report back.
 *
 * Not awaited by the request that starts it. A scan is a model call per
 * message, which on this hardware is minutes, and a phone that is still
 * waiting on a response has nothing to show for it.
 */

interface Running {
  startedAt: string;
}

let running: Running | null = null;
type Result = Omit<ScanState, "available" | "log"> & {
  source: "live";
  mode: "file" | "inspect";
  messages: InspectedMessage[] | null;
};

let last: Result | null = null;

function toMailbox(row: ScanReport["mailboxes"][number]): ScanMailbox {
  return {
    account: row.account,
    provider: row.provider,
    messages: row.messages,
    note: row.note ?? null,
    error: row.error ?? null,
    needsReauth: row.needsReauth === true,
  };
}

/** What the in-process runner knows, or null when it has never run here. */
export function liveScan(): {
  running: boolean;
  startedAt: string | null;
  result: Result | null;
} {
  return { running: running !== null, startedAt: running?.startedAt ?? null, result: last };
}

export function startLiveScan(options: ScanOptions = {}): { started: boolean; detail: string } {
  if (running) {
    return { started: false, detail: "A scan is already running. This page will show it when it lands." };
  }
  running = { startedAt: new Date().toISOString() };

  void (async () => {
    const startedAt = running?.startedAt ?? new Date().toISOString();
    try {
      const report = await scanMailboxes(options);
      last = {
        source: "live",
        mode: options.inspect ? "inspect" : "file",
        messages: report.messages ?? null,
        at: startedAt,
        scanned: report.scanned,
        actioned: report.actioned,
        queued: report.queued,
        mailboxes: report.mailboxes.map(toMailbox),
        failure: null,
        blocked: report.blocked ?? null,
      };
    } catch (error) {
      // The whole point. A scan that throws used to leave nothing anywhere a
      // person could see, which is indistinguishable from a scan that found
      // nothing to do.
      last = {
        source: "live",
        mode: options.inspect ? "inspect" : "file",
        messages: null,
        at: startedAt,
        scanned: null,
        actioned: null,
        queued: null,
        mailboxes: [],
        failure: error instanceof Error ? error.message : String(error),
        blocked: null,
      };
      console.error("[scan] run from the button", error);
    } finally {
      running = null;
    }
  })();

  return {
    started: true,
    detail: options.inspect
      ? "Re-reading recent mail. Nothing will be filed."
      : "Scanning. A message takes a moment to classify.",
  };
}
