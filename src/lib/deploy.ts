import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * `execFile`, not `exec`: arguments go to the process as an array and never
 * through a shell, so there is no quoting to get wrong and no metacharacter to
 * escape. Nothing in this module is caller-supplied today, and this is what
 * keeps that true if someone adds a parameter tomorrow.
 */
const run = promisify(execFile);

/**
 * What the wall is running, and how to make it run something newer.
 *
 * The display is mounted with no keyboard, so a deploy cannot be a person at a
 * prompt. A scheduled task does the actual work every ten minutes
 * (`scripts/update.ps1`); this module only reports what it found and lets a
 * phone say "now" instead of waiting.
 *
 * Nothing here takes a command from the caller. The button starts one named
 * scheduled task and that is the entire vocabulary — the alternative, an
 * endpoint that runs what it is given, is a remote shell on the house.
 */
const TASK = "Household update";
const LOG = "C:\\household\\update.log";

/** Past this, what we know about the remote is old enough to go and re-ask. */
const FETCH_STALE_MS = 60_000;

let fetching = false;

/**
 * Re-ask the remote, without making anyone wait for it.
 *
 * "Up to date" read from the last fetch is a claim about ten minutes ago, and
 * on this screen that is the one thing it must not be wrong about. But a
 * network round trip on every Settings open is a stall on a phone, so the
 * fetch is fired off and the answer arrives on the next poll a few seconds
 * later. One at a time: this endpoint is polled, and a fetch per poll would
 * pile up.
 */
async function refreshRemote(): Promise<void> {
  if (fetching) return;
  fetching = true;
  try {
    const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
    if (branch) await git("fetch", "--quiet", "origin", branch);
  } finally {
    fetching = false;
  }
}

async function lastFetchedAt(): Promise<Date | null> {
  // git stamps FETCH_HEAD on every fetch, whether or not anything came back.
  for (const path of ["FETCH_HEAD", "HEAD"]) {
    try {
      const info = await stat(join(await gitDir(), path));
      return info.mtime;
    } catch {
      // Not fetched yet; fall through to HEAD, then give up.
    }
  }
  return null;
}

async function gitDir(): Promise<string> {
  return (await git("rev-parse", "--git-dir")) ?? ".git";
}

export interface DeployState {
  /** False on anything that is not the wall — the button is hidden there. */
  available: boolean;
  commit: string | null;
  subject: string | null;
  branch: string | null;
  /** Commits on the tracked branch that this machine has not taken yet. */
  behind: number | null;
  /** When the branch was last fetched — what `behind` is actually true as of. */
  checkedAt: string | null;
  log: string[];
  error: string | null;
}

async function git(...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd: process.cwd(),
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    // No git, no repository, or no upstream. All three mean the same thing
    // here: there is nothing useful to say about versions.
    return null;
  }
}

/** True only where the scheduled task that does the work can exist. */
export function deployable(): boolean {
  return process.platform === "win32";
}

export async function readDeployState(): Promise<DeployState> {
  const [commit, subject, branch, behindRaw] = await Promise.all([
    git("rev-parse", "--short", "HEAD"),
    git("log", "-1", "--format=%s"),
    git("rev-parse", "--abbrev-ref", "HEAD"),
    // Against the last fetch, not a fresh one: this is read on every Settings
    // open and the update task fetches every ten minutes anyway.
    git("rev-list", "--count", "HEAD..@{u}"),
  ]);

  let log: string[] = [];
  try {
    const text = await readFile(LOG, "utf8");
    // PowerShell's -Encoding UTF8 writes a byte-order mark, which arrives here
    // as an invisible character on the first line.
    log = text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/).slice(-14);
  } catch {
    // No log until the updater has had something to do.
  }

  const checked = await lastFetchedAt();
  if (deployable() && (!checked || Date.now() - checked.getTime() > FETCH_STALE_MS)) {
    // Deliberately not awaited: the answer is for the next poll, not this one.
    void refreshRemote();
  }

  const behind = behindRaw !== null && /^\d+$/.test(behindRaw) ? Number(behindRaw) : null;

  return {
    available: deployable(),
    commit,
    subject,
    branch,
    behind,
    checkedAt: checked ? checked.toISOString() : null,
    log,
    error: null,
  };
}

/**
 * Ask the scheduled task to run now.
 *
 * It returns as soon as Windows accepts the request, not when the update
 * finishes — the update restarts the app, so the process handling this request
 * does not live to report the outcome. The log is how you find out.
 */
export async function startDeploy(): Promise<{ started: boolean; detail: string }> {
  if (!deployable()) {
    return { started: false, detail: "Updating from here only works on the wall." };
  }
  try {
    await run("schtasks", ["/run", "/tn", TASK], { timeout: 15_000, windowsHide: true });
    return { started: true, detail: "Update started." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Overwhelmingly this is the task not being registered, which means
    // setup-appliance.ps1 has not been re-run since the task was added.
    return {
      started: false,
      detail: /cannot find|does not exist|ERROR: The system cannot find/i.test(message)
        ? `No "${TASK}" scheduled task on this machine — run scripts/setup-appliance.ps1 once.`
        : message,
    };
  }
}

/** Where the updater writes, so the UI can point at it when something breaks. */
export const DEPLOY_LOG_PATH = LOG;

export const UPDATE_SCRIPT = join("scripts", "update.ps1");
