"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Music, { type MusicData } from "./Music";

const KEY = "household.miniplayer";

/**
 * How far a finger may wander before it counts as a drag rather than a tap.
 *
 * Nobody holds a finger still on glass, and a wall-mounted screen gets pressed
 * with a thumb, not a mouse.
 */
const DRAG_THRESHOLD_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The music player, in the Music tab or floating over whatever replaced it.
 *
 * It is one element in both states, and that is the entire point. The previous
 * mini player was a separate strip that could only say what was playing and
 * take you back, because the controls that would have made it useful are
 * Spotify's own and live inside the embed: the Web API's pause and skip act on
 * a Spotify Connect device, which an embed is not, and the embed's iframe API
 * has no next or previous at all.
 *
 * So the embed moves instead. Not in the DOM -- re-parenting an iframe
 * destroys its document and the music stops -- but in CSS, which repositions
 * without reloading. Docked, it is the whole pane; floating, the same element
 * is fixed to a corner with everything but the player hidden, and Spotify's
 * own transport comes with it.
 *
 * The one thing this rules out is `display: none` on the way past. A fixed
 * descendant of a hidden subtree renders nothing at all, so "not on the Music
 * tab" can no longer mean hiding the pane while the dock is up.
 */
export default function MusicDock({
  data,
  error,
  profileId,
  docked,
  showing,
  onChanged,
  onOpen,
}: {
  data: MusicData | null;
  error: string | null;
  profileId: string;
  /** True when the Music tab is not the one on screen. */
  docked: boolean;
  /** Whether the floating player is wanted at all. */
  showing: boolean;
  onChanged: () => void;
  onOpen: () => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Where it was left, per device. A wall and a phone want it in different
  // corners, and neither wants the other's choice.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number") {
        setAt(parsed);
      }
    } catch {
      /* first run, or storage refused */
    }
  }, []);

  /*
   * The grip is the handle, and it has to be: everything below it is a
   * cross-origin iframe, so a pointer over the player belongs to Spotify and
   * never reaches us. A titlebar is the honest shape for this.
   */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || gesture.current) return;
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    // Captured on the bar, which is where the handlers are. Capturing on the
    // dock instead retargets every later move to the dock, and the bar's
    // listener never hears another one -- the drag dies on its first pixel.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const from = gesture.current;
    if (!from || from.id !== event.pointerId) return;

    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (!from.moved) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      from.moved = true;
      setDragging(true);
    }

    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      x: clamp(from.left + dx, 8, window.innerWidth - rect.width - 8),
      y: clamp(from.top + dy, 8, window.innerHeight - rect.height - 8),
    });
  }, []);

  const finish = useCallback((event: React.PointerEvent) => {
    const from = gesture.current;
    if (!from || from.id !== event.pointerId) return;
    gesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    if (!from.moved) return;
    try {
      const rect = box.current?.getBoundingClientRect();
      if (rect) {
        window.localStorage.setItem(KEY, JSON.stringify({ x: rect.left, y: rect.top }));
      }
    } catch {
      /* storage refused; it will sit in the default corner next time */
    }
  }, []);

  // A saved position from a wider window can leave it off the edge.
  useEffect(() => {
    const onResize = () => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect || !at) return;
      setAt({
        x: clamp(at.x, 8, window.innerWidth - rect.width - 8),
        y: clamp(at.y, 8, window.innerHeight - rect.height - 8),
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [at]);

  const floating = docked && showing;

  return (
    <div
      ref={box}
      className={`pane music-dock${floating ? " music-dock--mini" : ""}${
        dragging ? " music-dock--dragging" : ""
      }`}
      // Hidden only when the floating player is not wanted either. While it is
      // up, this must never be display:none or the fixed position renders
      // nothing.
      hidden={docked && !showing}
      style={floating && at ? { left: at.x, top: at.y, right: "auto", bottom: "auto" } : undefined}
    >
      {floating ? (
        <div
          className="music-dock__bar"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          <span className="music-dock__grip" aria-hidden="true">
            <svg viewBox="0 0 12 20" width="12" height="20" fill="currentColor">
              <circle cx="3" cy="4" r="1.4" /><circle cx="9" cy="4" r="1.4" />
              <circle cx="3" cy="10" r="1.4" /><circle cx="9" cy="10" r="1.4" />
              <circle cx="3" cy="16" r="1.4" /><circle cx="9" cy="16" r="1.4" />
            </svg>
          </span>
          <span className="music-dock__title">Playing</span>
          <button
            className="btn btn--quiet music-dock__open"
            // The bar starts a drag on pointerdown and captures the pointer,
            // and a captured pointer does not reliably produce a click on the
            // element underneath it. Keeping this press to itself is what lets
            // the button be a button.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onOpen}
            title="Back to the music"
            aria-label="Back to the music"
          >
            ⤢
          </button>
        </div>
      ) : null}

      <Music
        data={data}
        error={error}
        profileId={profileId}
        onChanged={onChanged}
      />
    </div>
  );
}
