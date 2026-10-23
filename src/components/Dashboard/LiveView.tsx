"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A Blink camera, live, for as long as Blink allows it.
 *
 * HLS, because that is what the proxy re-serves the stream as. Safari plays it
 * natively; everything else — including the Edge on the wall — needs hls.js,
 * which is imported only when someone actually presses Live so it stays out of
 * the bundle the dashboard loads a hundred times a day.
 */
/** Long enough for a sleeping battery camera; short enough to not be a stare. */
const WAKE_TIMEOUT_MS = 25_000;

export default function LiveView({
  slug,
  name,
  onClose,
}: {
  slug: string;
  name: string;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A player that sits on black forever is indistinguishable from a broken
  // one. Count the wait out loud, and say something when it has gone on too
  // long — the same reason the dictation button got a watchdog.
  useEffect(() => {
    if (ready || error) return;
    const started = Date.now();
    const tick = setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      setWaited(seconds);
      if (seconds * 1000 >= WAKE_TIMEOUT_MS) {
        setError(
          "The camera didn't start streaming. Battery cameras are asleep " +
            "until asked, and Blink sometimes refuses a second session soon " +
            "after the last one — worth trying again in a minute.",
        );
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [ready, error]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const source = `/api/cameras/live/${encodeURIComponent(slug)}/index.m3u8`;
    let cancelled = false;
    let instance: { destroy: () => void } | null = null;

    const start = async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      /*
       * hls.js first, native second, and the order is the whole point.
       *
       * Chromium has no native HLS, but Edge answers "maybe" to
       * canPlayType("application/vnd.apple.mpegurl") anyway. Asking that
       * question first hands the playlist to a video element that cannot
       * parse it: no error, no events, a black rectangle. Only Safari, where
       * hls.js has no MSE to attach to, should take the native path.
       */
      if (!Hls.isSupported()) {
        if (element.canPlayType("application/vnd.apple.mpegurl")) {
          setNote("native player");
          element.src = source;
          return;
        }
        setError("This browser can't play the stream.");
        return;
      }
      // A battery camera takes a few seconds to wake, so the first segments
      // are slow; low latency mode makes that worse, not better.
      const hls = new Hls({ lowLatencyMode: false, backBufferLength: 10 });
      instance = hls;

      // Every error, not only the fatal ones. A segment that downloads and
      // then fails to parse is non-fatal to hls.js and total to the viewer —
      // swallowing those is why a black screen had nothing to say for itself.
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.warn("[live]", data.type, data.details, data.fatal ? "(fatal)" : "");
        setNote(`${data.details}${data.fatal ? " (fatal)" : ""}`);
        if (!data.fatal) return;
        setError(
          data.details === "manifestLoadError"
            ? "The camera didn't start. Battery cameras are asleep until asked — try again."
            : `Stream failed: ${data.details}`,
        );
      });

      // What the player believes it has, for when the picture disagrees.
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.info("[live] manifest", data.levels?.length, "level(s)");
        setNote(`manifest: ${data.levels?.length ?? 0} level(s)`);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        setNote(`buffered fragment ${data.frag?.sn}`);
      });

      hls.loadSource(source);
      hls.attachMedia(element);
    };

    void start().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );

    return () => {
      cancelled = true;
      instance?.destroy();
      element.removeAttribute("src");
      element.load();
    };
  }, [slug]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="sheet__card live"
        onClick={(click) => click.stopPropagation()}
      >
        <header className="sheet__head">
          <span className="live__dot" />
          <div>
            <h2 className="sheet__title">{name}</h2>
            <p className="sheet__when">
              {error
                ? "Not streaming"
                : ready
                  ? "Live"
                  : `Waking the camera… ${waited}s`}
            </p>
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="live__frame">
          <video
            ref={video}
            className="live__video"
            autoPlay
            playsInline
            muted
            onPlaying={() => {
              setReady(true);
              setError(null);
            }}
          />
          {!ready && !error ? <span className="spinner live__spinner" /> : null}
        </div>

        {error ? <div className="banner">{error}</div> : null}
        {note && !ready ? <p className="setting__note">Player: {note}</p> : null}

        <p className="setting__note">
          Blink allows about five minutes of live view, and it is the most
          battery-expensive thing these cameras do.
        </p>
      </div>
    </div>
  );
}
