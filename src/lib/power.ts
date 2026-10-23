import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * What the machine's power plan actually says, as opposed to what it was told.
 *
 * This exists because the difference turned out to matter. The four `powercfg`
 * calls were printed as a manual step to run in an administrator window, and
 * elevation on this machine switches to a different account -- so they
 * configured that account's plan and the display account kept its defaults.
 * The wall slept, nobody could see why, and nothing on screen said otherwise.
 *
 * Read as the app's own user, which is the display account, so these are the
 * numbers that actually govern the wall.
 */

/** `powercfg` aliases: the subgroup and setting for each timeout we care about. */
const SETTINGS = [
  { key: "sleep", label: "Sleep", sub: "SUB_SLEEP", setting: "STANDBYIDLE" },
  { key: "screen", label: "Screen off", sub: "SUB_VIDEO", setting: "VIDEOIDLE" },
  { key: "disk", label: "Disk off", sub: "SUB_DISK", setting: "DISKIDLE" },
  { key: "hibernate", label: "Hibernate", sub: "SUB_SLEEP", setting: "HIBERNATEIDLE" },
] as const;

export interface PowerSetting {
  key: string;
  label: string;
  /** Seconds on mains, or null when it could not be read. 0 means never. */
  seconds: number | null;
}

export interface PowerState {
  available: boolean;
  settings: PowerSetting[];
  /** True when nothing on mains will put the wall to sleep or blank it. */
  staysAwake: boolean;
}

export function powerReadable(): boolean {
  return process.platform === "win32";
}

/**
 * The AC index out of `powercfg /q`.
 *
 * It prints both AC and DC, AC first, as hex. The DC line is deliberately
 * ignored: on battery the Surface should still behave like a laptop.
 */
export function parseAcSeconds(output: string): number | null {
  const match = /Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+)/.exec(output);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return Number.isFinite(value) ? value : null;
}

async function readOne(sub: string, setting: string): Promise<number | null> {
  try {
    const { stdout } = await run("powercfg", ["/q", "SCHEME_CURRENT", sub, setting], {
      timeout: 10_000,
      windowsHide: true,
    });
    return parseAcSeconds(stdout);
  } catch {
    // No powercfg, or a scheme that does not expose it. Either way there is
    // nothing honest to report for this one.
    return null;
  }
}

export async function readPowerState(): Promise<PowerState> {
  if (!powerReadable()) {
    return { available: false, settings: [], staysAwake: true };
  }

  const settings = await Promise.all(
    SETTINGS.map(async (entry) => ({
      key: entry.key,
      label: entry.label,
      seconds: await readOne(entry.sub, entry.setting),
    })),
  );

  // Only sleep and hibernate decide whether the machine stays up. The screen
  // blanking on its own is fine -- `rest-screen.ps1` does exactly that every
  // night on purpose.
  const stopsIt = settings.filter((setting) => setting.key === "sleep" || setting.key === "hibernate");
  const staysAwake = stopsIt.every((setting) => setting.seconds === 0 || setting.seconds === null);

  return { available: true, settings, staysAwake };
}

/** "never", or "after 30 minutes". */
export function describeTimeout(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds === 0) return "never";
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `after ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `after ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
