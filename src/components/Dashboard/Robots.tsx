"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * "cleaning" → "Cleaning", but "Side brush stuck" is left as Home Assistant
 * wrote it. Capitalising every word in CSS turns a sentence from a vendor into
 * a Headline About A Stuck Brush.
 */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface RobotView {
  entityId: string;
  name: string;
  kind: "vacuum" | "mower";
  state: string;
  running: boolean;
  docked: boolean;
  battery: number | null;
  problem: string | null;
  updatedAt: string | null;
}

interface Payload {
  configured: boolean;
  robots: RobotView[];
  error: string | null;
}

/** Slow poll: a robot that is out takes half an hour, not half a second. */
export function useRobots(intervalMs = 30_000) {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>("/api/robots"));
    } catch (cause) {
      setData({
        configured: true,
        robots: [],
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, load]);

  return { data, reload: load };
}

export default function Robots({
  data,
  profileId,
  onChanged,
}: {
  data: Payload | null;
  profileId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (robot: RobotView, command: "start" | "pause" | "dock") => {
    setBusy(`${robot.entityId}:${command}`);
    setError(null);
    try {
      await api("/api/robots/command", {
        method: "POST",
        profileId,
        body: JSON.stringify({ entityId: robot.entityId, command, name: robot.name }),
      });
      // Give the robot a moment to admit it has started before re-reading;
      // HA reports the old state if you ask it straight away.
      setTimeout(onChanged, 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <p className="empty">
        <span className="spinner" /> Looking…
      </p>
    );
  }
  if (!data.configured) {
    return (
      <p className="empty">
        Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to drive the vacuum and
        the mower from here.
      </p>
    );
  }
  if (data.error) return <div className="banner">Home Assistant: {data.error}</div>;
  if (data.robots.length === 0) {
    return <p className="empty">No vacuum or mower found in Home Assistant.</p>;
  }

  return (
    <div className="robots">
      {error ? <div className="banner">{error}</div> : null}
      {data.robots.map((robot) => (
        <div className={`robot${robot.problem ? " robot--problem" : ""}`} key={robot.entityId}>
          <div className="robot__id">
            <span className="robot__icon" aria-hidden="true">
              {robot.kind === "vacuum" ? "⬤" : "▲"}
            </span>
            <div>
              <span className="robot__name">{robot.name}</span>
              <span className="robot__state">
                {robot.problem ?? sentence(robot.state.replace(/_/g, " "))}
                {robot.battery !== null ? ` · ${Math.round(robot.battery)}%` : ""}
              </span>
            </div>
          </div>

          <div className="robot__actions">
            {robot.running ? (
              <>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => send(robot, "pause")}
                >
                  {busy === `${robot.entityId}:pause` ? "…" : "Pause"}
                </button>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => send(robot, "dock")}
                >
                  {busy === `${robot.entityId}:dock` ? "…" : "Send home"}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn--primary"
                  disabled={busy !== null}
                  onClick={() => send(robot, "start")}
                >
                  {busy === `${robot.entityId}:start`
                    ? "…"
                    : robot.kind === "vacuum"
                      ? "Vacuum"
                      : "Mow"}
                </button>
                {/* Already on the charger: "send home" would be a button that
                    does nothing, so it isn't offered. */}
                {robot.docked ? null : (
                  <button
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => send(robot, "dock")}
                  >
                    {busy === `${robot.entityId}:dock` ? "…" : "Send home"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
