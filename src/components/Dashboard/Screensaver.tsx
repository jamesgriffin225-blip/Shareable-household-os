"use client";

import { useEffect, useMemo, useState } from "react";
import type { FrameSettings, Photo } from "@/lib/types";

/**
 * The wall when nobody is using it.
 *
 * A dashboard nobody is reading is a lit rectangle of admin on a kitchen wall.
 * Given a few photos it becomes something worth having up, and one touch puts
 * the week back.
 */
export default function Screensaver({
  photos,
  frame,
  timeZone,
  dim,
  onDismiss,
}: {
  photos: Photo[];
  frame: FrameSettings;
  timeZone: string;
  dim: boolean;
  onDismiss: () => void;
}) {
  const list = useMemo(() => {
    const chosen =
      frame.selected.length > 0
        ? frame.selected
            .map((id) => photos.find((photo) => photo.id === id))
            .filter((photo): photo is Photo => Boolean(photo))
        : photos;
    return frame.mode === "single" ? chosen.slice(0, 1) : chosen;
  }, [frame.mode, frame.selected, photos]);

  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Random order, and a fresh one every lap, so the frame never settles into
  // a sequence. The shuffle is seeded per lap (from a random start chosen once)
  // so a re-render mid-lap keeps the same order instead of jumping about.
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const ids = list.map((photo) => photo.id).join(",");
  const lap = list.length > 0 ? Math.floor(index / list.length) : 0;
  const order = useMemo(() => {
    const all = ids ? ids.split(",") : [];
    const next = shuffle(all, seed + lap);
    // Never the same photo twice running across the join between two laps.
    const lastShown = lap > 0 ? shuffle(all, seed + lap - 1).at(-1) : undefined;
    if (next.length > 1 && next[0] === lastShown) [next[0], next[1]] = [next[1], next[0]];
    return next;
  }, [ids, seed, lap]);
  const byId = useMemo(() => new Map(list.map((photo) => [photo.id, photo])), [list]);

  useEffect(() => {
    if (list.length < 2 || frame.mode === "single") return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % list.length),
      Math.max(3, frame.intervalSeconds) * 1000,
    );
    return () => clearInterval(timer);
  }, [frame.intervalSeconds, frame.mode, list.length]);

  useEffect(() => {
    if (!frame.showClock) return;
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, [frame.showClock]);

  // Fetch the next one while the current one is still up, so the crossfade
  // isn't a fade to nothing on a slow connection.
  useEffect(() => {
    if (order.length < 2) return;
    const next = order[(index + 1) % order.length];
    const preload = new Image();
    preload.src = `/photo/${next}`;
  }, [index, order]);

  useEffect(() => {
    const dismiss = () => onDismiss();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, dismiss, { passive: true });
    }
    return () => {
      for (const event of events) window.removeEventListener(event, dismiss);
    };
  }, [onDismiss]);

  const current = order.length > 0 ? byId.get(order[index % order.length]) : undefined;
  // What was on screen last, kept rather than recomputed: at the start of a lap
  // the new order's "previous" is not the photo that was just showing.
  const [previousId, setPreviousId] = useState<string | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    return () => setPreviousId(currentId);
  }, [currentId]);
  const previous = previousId ? byId.get(previousId) : undefined;

  if (!current) return null;

  return (
    <div className={`saver${dim ? " saver--dim" : ""}`} role="presentation">
      {previous && previous.id !== current.id ? (
        <PhotoLayer photo={previous} key={`under-${previous.id}`} />
      ) : null}
      <PhotoLayer photo={current} key={`over-${current.id}-${index}`} fading />

      {frame.showClock ? (
        <div className="saver__clock">
          <span className="saver__time">
            {new Intl.DateTimeFormat("en-AU", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
            }).format(now)}
          </span>
          <span className="saver__date">
            {new Intl.DateTimeFormat("en-AU", {
              timeZone,
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(now)}
          </span>
        </div>
      ) : null}

      {current.caption ? <p className="saver__caption">{current.caption}</p> : null}
      <p className="saver__hint">Touch to go back</p>
    </div>
  );
}

/** Contain the photo, and fill the letterbox with a blurred copy of itself. */
function PhotoLayer({ photo, fading }: { photo: Photo; fading?: boolean }) {
  const src = `/photo/${photo.id}`;
  return (
    <div className={`saver__layer${fading ? " saver__layer--in" : ""}`}>
      <div className="saver__wash" style={{ backgroundImage: `url(${src})` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="saver__photo" src={src} alt={photo.caption ?? ""} />
    </div>
  );
}

/** Fisher-Yates with a small seeded generator (mulberry32), so a lap's order is stable. */
function shuffle<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
