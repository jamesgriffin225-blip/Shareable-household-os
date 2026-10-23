"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Full screen, for the wall.
 *
 * Edge's tab strip and address bar cost about 90px of a display that is
 * showing a week at a glance, and nobody browses on it. A scheduled task can
 * start Edge in kiosk mode, but this is the version that works right now and
 * on any device — including a phone, where it hides the browser chrome the
 * same way.
 */
export default function Fullscreen() {
  const [full, setFull] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(Boolean(document.documentElement.requestFullscreen));
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // Refused without a user gesture, and on iOS refused outright. Either
      // way there is nothing useful to say about it.
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  if (!supported) return null;

  return (
    <button
      className="pill"
      onClick={toggle}
      title={full ? "Leave full screen" : "Full screen"}
      aria-label={full ? "Leave full screen" : "Full screen"}
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {full ? (
          <>
            <path d="M9 3v6H3M15 21v-6h6" />
            <path d="M3 21l6-6M21 3l-6 6" />
          </>
        ) : (
          <>
            <path d="M3 9V3h6M21 15v6h-6" />
            <path d="M3 3l6 6M21 21l-6-6" />
          </>
        )}
      </svg>
    </button>
  );
}
