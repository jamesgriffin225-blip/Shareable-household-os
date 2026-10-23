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
    if (list.length < 2) return;
    const next = list[(index + 1) % list.length];
    const preload = new Image();
    preload.src = `/photo/${next.id}`;
  }, [index, list]);

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

  if (list.length === 0) return null;

  const current = list[index % list.length];
  const previous = list[(index - 1 + list.length) % list.length];

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
