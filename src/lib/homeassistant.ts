import { describeFetchFailure, safeOrigin } from "./fetch-error.ts";

/**
 * The Home Assistant client, shared by anything at home we can reach.
 *
 * It lives apart from `cameras.ts` because the cameras were only the first
 * thing on the other end of it. Anything HA can see — a camera, a vacuum, a
 * mower — is one documented REST call away once this exists.
 */

export function homeAssistantConfigured(): boolean {
  return Boolean(process.env.HOME_ASSISTANT_URL && process.env.HOME_ASSISTANT_TOKEN);
}

function base(): string {
  const url = process.env.HOME_ASSISTANT_URL;
  if (!url) throw new Error("HOME_ASSISTANT_URL is not set");
  return url.replace(/\/$/, "");
}

export async function ha(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${process.env.HOME_ASSISTANT_TOKEN}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(Number(process.env.HOME_ASSISTANT_TIMEOUT_MS || 8000)),
    });
  } catch (error) {
    // Node reports every transport failure as "fetch failed" and hides the
    // reason in `cause`. On a home network the difference between a refused
    // connection, an unresolvable .local name and no route at all is the
    // whole diagnosis, and the wall was showing none of it. The origin is
    // named too, so a wrong address identifies itself.
    throw new Error(
      describeFetchFailure(error, safeOrigin(process.env.HOME_ASSISTANT_URL)),
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Home Assistant ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
    );
  }
  return response;
}

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

export async function haStates(): Promise<HaState[]> {
  const states = (await (await ha("/api/states")).json()) as HaState[];
  return Array.isArray(states) ? states : [];
}

/** Call a service, e.g. `vacuum.start`, against one entity. */
export async function haCall(
  domain: string,
  service: string,
  entityId: string,
): Promise<void> {
  await ha(`/api/services/${domain}/${service}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** `camera.front_door` → `front_door`, the stem its sensors are named after. */
export function objectId(entityId: string): string {
  return entityId.slice(entityId.indexOf(".") + 1);
}

export function friendly(entity: HaState): string {
  const name = entity.attributes?.friendly_name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return objectId(entity.entity_id).replace(/_/g, " ");
}

export function numeric(value: unknown): number | null {
  // `Number(null)` is 0, and `Number("")` is 0, and `Number(true)` is 1. An
  // absent reading is not a reading of zero — a Blink camera publishes
  // `battery_level: null`, and "0%" on the wall reads as a flat battery.
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Only the entities named in an allow-list env var, when one is set. */
export function allowListFrom(raw: string | undefined): Set<string> | null {
  const configured = (raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : null;
}
