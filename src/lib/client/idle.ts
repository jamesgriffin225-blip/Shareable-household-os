"use client";

import { useEffect, useState } from "react";

/**
 * True once nobody has touched the screen for `seconds`.
 *
 * Disabled by passing 0, which is what keeps the screensaver off while
 * somebody is halfway through editing a queued item.
 */
export function useIdle(seconds: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    if (seconds <= 0) {
      setIdle(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const restart = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), seconds * 1000);
    };

    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, restart, { passive: true });
    }
    restart();

    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, restart);
    };
  }, [seconds, nudge]);

  return [idle, () => setNudge((value) => value + 1)];
}
