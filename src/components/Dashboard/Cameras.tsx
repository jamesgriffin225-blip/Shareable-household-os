"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import LiveView from "./LiveView";

export interface CameraView {
  entityId: string;
  name: string;
  available: boolean;
  battery: number | null;
  batteryState: string | null;
  temperature: number | null;
  motionAt: string | null;
  motionNow: boolean;
  updatedAt: string | null;
  liveSlug: string | null;
}

export interface PanelView {
  entityId: string;
  name: string;
  state: string;
  armed: boolean;
}

interface Payload {
  configured: boolean;
  cameras: CameraView[];
  panels: PanelView[];
  error: string | null;
  /** Live view could not be reached. The stills are unaffected. */
  liveError?: string | null;
}

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

/**
 * Battery cameras are asleep most of the time, so this polls slowly and the
 * stills refresh on their own cadence. Nothing here wakes a camera except the
 * refresh button, which is why that is a button.
 */
export function useCameras(intervalMs = 60_000) {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>("/api/cameras"));
    } catch (cause) {
      setData({
        configured: true,
        cameras: [],
        panels: [],
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, load]);

  return { data, reload: load };
}

export default function Cameras({
  data,
  profileId,
  onChanged,
}: {
  data: Payload | null;
  profileId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<CameraView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to break the browser's cache when a fresh still is requested.
  const [nonce, setNonce] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNonce(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const arm = async (panel: PanelView, mode: "away" | "home" | "disarm") => {
    if (
      mode === "disarm" &&
      !window.confirm(`Disarm ${panel.name}? Everyone in the house can see this screen.`)
    ) {
      return;
    }
    setBusy(panel.entityId);
    setError(null);
    try {
      await api("/api/cameras/arm", {
        method: "POST",
        body: JSON.stringify({ entityId: panel.entityId, mode }),
        profileId,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (camera: CameraView) => {
    setBusy(camera.entityId);
    setError(null);
    try {
      await api("/api/cameras/snapshot", {
        method: "POST",
        body: JSON.stringify({ entityId: camera.entityId }),
        profileId,
      });
      // The camera has to wake, take the photo and upload it.
      setTimeout(() => setNonce(Date.now()), 6000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <p className="empty">
        <span className="spinner" /> Looking for cameras…
      </p>
    );
  }

  if (!data.configured) {
    return (
      <p className="empty">
        Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to show the cameras here.
        Home Assistant holds the Blink login; this app never sees it.
      </p>
    );
  }

  return (
    <>
      {data.error ? <div className="banner">Can&rsquo;t reach home: {data.error}</div> : null}
      {error ? <div className="banner">{error}</div> : null}

      {data.panels.map((panel) => (
        <div className="armbar" key={panel.entityId}>
          <div>
            <div className="setting__name">{panel.name}</div>
            <div className="setting__note">{panel.state.replace(/_/g, " ")}</div>
          </div>
          <div className="armbar__actions">
            {panel.armed ? (
              <button
                className="btn"
                disabled={busy === panel.entityId}
                onClick={() => void arm(panel, "disarm")}
              >
                Disarm
              </button>
            ) : (
              <>
                <button
                  className="btn btn--primary"
                  disabled={busy === panel.entityId}
                  onClick={() => void arm(panel, "away")}
                >
                  Arm
                </button>
                <button
                  className="btn"
                  disabled={busy === panel.entityId}
                  onClick={() => void arm(panel, "home")}
                >
                  Arm (home)
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {data.cameras.length === 0 && !data.error ? (
        <p className="empty">
          Home Assistant is reachable but has no camera entities. Add the Blink
          integration there and they will appear.
        </p>
      ) : (
        <div className="cams">
          {data.cameras.map((camera) => (
            <figure
              className={`cam${camera.motionNow ? " cam--motion" : ""}`}
              key={camera.entityId}
            >
              <div className="cam__frame">
                {camera.available ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/camera/${encodeURIComponent(camera.entityId)}?t=${nonce}`}
                    alt={camera.name}
                    loading="lazy"
                  />
                ) : (
                  <span className="cam__offline">offline</span>
                )}
                <div className="cam__actions">
                  {camera.liveSlug && camera.available ? (
                    <button
                      className="cam__live"
                      onClick={() => setLive(camera)}
                      title="Watch this camera live"
                    >
                      <span className="live__dot" />
                      Live
                    </button>
                  ) : null}
                  <button
                    className="cam__refresh"
                    disabled={busy === camera.entityId}
                    onClick={() => void refresh(camera)}
                    title="Wake the camera for a new still — uses battery"
                  >
                    {busy === camera.entityId ? <span className="spinner" /> : "↻"}
                  </button>
                </div>
              </div>
              <figcaption className="cam__meta">
                <span className="cam__name">{camera.name}</span>
                <span className="cam__facts">
                  {camera.motionNow
                    ? "motion now"
                    : ago(camera.motionAt)
                      ? `motion ${ago(camera.motionAt)}`
                      : "no motion"}
                  {camera.battery !== null
                    ? ` · ${Math.round(camera.battery)}%`
                    : // A camera that says "ok" on every one of five tiles is
                      // noise; one that says "low" is the whole point.
                      camera.batteryState &&
                        camera.batteryState.toLowerCase() !== "ok"
                      ? ` · battery ${camera.batteryState}`
                      : ""}
                  {camera.temperature !== null
                    ? ` · ${Math.round(camera.temperature)}°`
                    : ""}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {data.liveError ? (
        <div className="banner" style={{ marginTop: 10 }}>
          Live view is off: {data.liveError}
        </div>
      ) : null}

      {live?.liveSlug ? (
        <LiveView
          slug={live.liveSlug}
          name={live.name}
          onClose={() => setLive(null)}
        />
      ) : null}
    </>
  );
}
