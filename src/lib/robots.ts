/**
 * The robots: a vacuum indoors, a mower outside.
 *
 * Both are Home Assistant entities, so this is the same arrangement as the
 * cameras — HA holds the vendor's credentials and speaks whatever proprietary
 * protocol the thing wants, and we make documented REST calls at it.
 *
 * Two domains rather than one because Home Assistant models them separately:
 * `vacuum` has been there for years, `lawn_mower` arrived in 2023 with its own
 * service names. Mapping both onto one set of buttons is this file's job.
 */

import {
  allowListFrom,
  friendly,
  haCall,
  haStates,
  numeric,
  type HaState,
} from "./homeassistant.ts";

const ROBOT_ID = /^(vacuum|lawn_mower)\.[a-z0-9_]+$/;

export type RobotCommand = "start" | "pause" | "dock";

export interface RobotView {
  entityId: string;
  name: string;
  kind: "vacuum" | "mower";
  /** Raw HA state: docked, cleaning, mowing, returning, paused, error… */
  state: string;
  /** Out working right now, whatever the vendor calls it. */
  running: boolean;
  /** Sitting on its charger. `dock` is pointless, `start` is the button. */
  docked: boolean;
  battery: number | null;
  problem: string | null;
  updatedAt: string | null;
}

const RUNNING = new Set(["cleaning", "mowing", "returning", "returning_to_dock"]);
const DOCKED = new Set(["docked", "charging"]);

export function validRobotId(entityId: string): boolean {
  return ROBOT_ID.test(entityId);
}

export function readRobots(states: HaState[]): RobotView[] {
  const allowed = allowListFrom(process.env.HOME_ASSISTANT_ROBOTS);

  return states
    .filter(
      (entity) =>
        ROBOT_ID.test(entity.entity_id) &&
        (!allowed || allowed.has(entity.entity_id)),
    )
    .map((entity): RobotView => {
      const state = String(entity.state ?? "").toLowerCase();
      return {
        entityId: entity.entity_id,
        name: friendly(entity),
        kind: entity.entity_id.startsWith("vacuum.") ? "vacuum" : "mower",
        state,
        running: RUNNING.has(state),
        docked: DOCKED.has(state),
        battery:
          numeric(entity.attributes?.battery_level) ??
          numeric(entity.attributes?.battery),
        // "unavailable" is a robot that is off or out of range, and "error" is
        // one that is stuck under the couch. Both are worth saying out loud.
        problem:
          state === "error"
            ? String(entity.attributes?.error || "Stopped with an error")
            : state === "unavailable" || state === "unknown"
              ? "Not responding"
              : null,
        updatedAt: entity.last_updated ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function robotSnapshot(): Promise<RobotView[]> {
  return readRobots(await haStates());
}

/**
 * The service for a command, per domain.
 *
 * Exported and pure so the mapping is testable: getting one of these wrong
 * means a button that silently does nothing, which is indistinguishable from
 * a robot that is ignoring you.
 */
export function serviceFor(
  entityId: string,
  command: RobotCommand,
): { domain: string; service: string } {
  const domain = entityId.slice(0, entityId.indexOf("."));
  if (domain === "lawn_mower") {
    return {
      domain,
      service:
        command === "start" ? "start_mowing" : command === "pause" ? "pause" : "dock",
    };
  }
  return {
    domain: "vacuum",
    service:
      command === "start" ? "start" : command === "pause" ? "pause" : "return_to_base",
  };
}

export async function sendRobot(
  entityId: string,
  command: RobotCommand,
): Promise<void> {
  if (!validRobotId(entityId)) throw new Error("Not a vacuum or mower entity");
  const { domain, service } = serviceFor(entityId, command);
  await haCall(domain, service, entityId);
}

/** What the activity feed records. */
export function describeRobotCommand(name: string, command: RobotCommand): string {
  if (command === "start") return `Sent ${name} out`;
  if (command === "pause") return `Paused ${name}`;
  return `Sent ${name} home`;
}
