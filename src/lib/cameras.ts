/**
 * Cameras, by way of Home Assistant.
 *
 * Not by way of Blink directly, and the reason is worth writing down. Blink
 * has no public API; its current client authenticates with a PKCE flow that
 * scrapes a CSRF token off a sign-in page, posts credentials as a browser,
 * handles 2FA, and catches an authorization code off a custom-scheme redirect.
 * That is a screen-scraper, it breaks whenever Amazon touches the sign-in page,
 * and it would want this app to hold an Amazon password.
 *
 * Home Assistant already implements that flow and keeps it working, so it holds
 * the credentials on hardware at home and we talk to a documented, stable REST
 * API. Anything HA can see — Blink, or any other camera added later — shows up
 * here without another integration.
 */

import {
  allowListFrom,
  friendly,
  ha,
  haStates,
  numeric,
  objectId,
  type HaState,
} from "./homeassistant.ts";

export { homeAssistantConfigured } from "./homeassistant.ts";

const CAMERA_ID = /^camera\.[a-z0-9_]+$/;
const PANEL_ID = /^alarm_control_panel\.[a-z0-9_]+$/;

export interface CameraView {
  entityId: string;
  name: string;
  available: boolean;
  /** Battery percentage, when the camera or a paired sensor reports one. */
  battery: number | null;
  /** A word instead of a percentage — "ok", "low" — when that is all there is. */
  batteryState: string | null;
  temperature: number | null;
  motionAt: string | null;
  motionNow: boolean;
  updatedAt: string | null;
  /** The live-view proxy's name for this camera, when it has one. */
  liveSlug: string | null;
}

export interface PanelView {
  entityId: string;
  name: string;
  state: string;
  armed: boolean;
  supports: { away: boolean; home: boolean };
}

export interface CameraSnapshot {
  cameras: CameraView[];
  panels: PanelView[];
}

/** Only the cameras named in HOME_ASSISTANT_CAMERAS, if it is set. */
function allowList(): Set<string> | null {
  return allowListFrom(process.env.HOME_ASSISTANT_CAMERAS);
}

export function readStates(states: HaState[]): CameraSnapshot {
  const allowed = allowList();

  const cameras = states.filter(
    (entity) =>
      CAMERA_ID.test(entity.entity_id) &&
      (!allowed || allowed.has(entity.entity_id)),
  );

  const motion = states.filter(
    (entity) =>
      entity.entity_id.startsWith("binary_sensor.") &&
      entity.attributes?.device_class === "motion",
  );
  const batteries = states.filter(
    (entity) =>
      entity.entity_id.startsWith("sensor.") &&
      entity.attributes?.device_class === "battery",
  );
  const temperatures = states.filter(
    (entity) =>
      entity.entity_id.startsWith("sensor.") &&
      entity.attributes?.device_class === "temperature",
  );

  /**
   * Match a sensor to a camera.
   *
   * By entity-id stem first, which is how most integrations name them, and by
   * friendly-name prefix second — because they do not all agree. Blink names
   * the camera `camera.backyard` and its sensor `sensor.blink_backyard_
   * temperature`, so the stems never meet, but both are called "Backyard".
   *
   * It stays a heuristic either way, so a miss leaves a field empty rather
   * than showing another camera's battery.
   */
  const paired = (pool: HaState[], camera: HaState): HaState | null => {
    const stem = objectId(camera.entity_id);
    const byStem = pool.find((entity) =>
      objectId(entity.entity_id).startsWith(`${stem}_`),
    );
    if (byStem) return byStem;

    const name = friendly(camera).toLowerCase();
    return (
      pool.find((entity) => friendly(entity).toLowerCase().startsWith(`${name} `)) ??
      null
    );
  };

  return {
    cameras: cameras.map((camera): CameraView => {
      const attributes = camera.attributes ?? {};
      const motionSensor = paired(motion, camera);
      const battery = paired(batteries, camera);
      const temperature = paired(temperatures, camera);

      // The camera's own attributes win wherever it publishes them. A separate
      // sensor entity has to be found by guesswork; an attribute on the camera
      // is the camera talking about itself.
      return {
        entityId: camera.entity_id,
        name: friendly(camera),
        available: camera.state !== "unavailable" && camera.state !== "unknown",
        battery: numeric(attributes.battery_level) ?? numeric(battery?.state),
        // Battery cameras often report a word rather than a percentage —
        // Blink says "ok" or "low" and leaves battery_level null.
        batteryState:
          typeof attributes.battery === "string" && attributes.battery.trim()
            ? attributes.battery.trim()
            : null,
        temperature:
          numeric(attributes.temperature_c) ?? numeric(temperature?.state),
        motionAt: motionSensor?.last_changed ?? null,
        motionNow: attributes.motion_detected === true || motionSensor?.state === "on",
        updatedAt: camera.last_updated ?? null,
        // Filled in by the route, which is where the proxy is reachable from.
        liveSlug: null,
      };
    }),
    panels: states
      .filter((entity) => PANEL_ID.test(entity.entity_id))
      .map((panel): PanelView => {
        return {
          entityId: panel.entity_id,
          name: friendly(panel),
          state: panel.state,
          armed: panel.state.startsWith("armed"),
          // HA reports supported modes as a bitmask; rather than decode it and
          // be wrong on a future value, offer both and let the service call
          // fail loudly if one is unsupported.
          supports: { away: true, home: true },
        };
      }),
  };
}

export async function cameraSnapshot(): Promise<CameraSnapshot> {
  return readStates(await haStates());
}

/** Guard every entity id that reaches a URL — this proxies to a home network. */
export function validCameraId(entityId: string): boolean {
  return CAMERA_ID.test(entityId);
}

export function validPanelId(entityId: string): boolean {
  return PANEL_ID.test(entityId);
}

export async function cameraImage(entityId: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
}> {
  if (!validCameraId(entityId)) throw new Error("Not a camera entity");
  const response = await ha(`/api/camera_proxy/${encodeURIComponent(entityId)}`);
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "image/jpeg",
  };
}

export type ArmMode = "away" | "home" | "disarm";

export async function setArmed(entityId: string, mode: ArmMode): Promise<void> {
  if (!validPanelId(entityId)) throw new Error("Not an alarm panel entity");
  const service =
    mode === "disarm"
      ? "alarm_disarm"
      : mode === "home"
        ? "alarm_arm_home"
        : "alarm_arm_away";
  await ha(`/api/services/alarm_control_panel/${service}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/**
 * Ask a camera for a fresh still.
 *
 * Battery cameras are asleep until something wakes them, so this is a button a
 * person presses and never something on a timer. Blink's own service is tried
 * first; anything else falls back to asking HA to refresh the entity.
 */
export async function requestSnapshot(entityId: string): Promise<string> {
  if (!validCameraId(entityId)) throw new Error("Not a camera entity");
  const payload = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity_id: entityId }),
  };
  try {
    await ha("/api/services/blink/trigger_camera", payload);
    return "blink.trigger_camera";
  } catch {
    await ha("/api/services/homeassistant/update_entity", payload);
    return "homeassistant.update_entity";
  }
}
