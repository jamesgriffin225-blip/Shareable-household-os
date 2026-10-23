"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

/** Often enough to feel live, rarely enough not to be rude to Spotify. */
const POLL_MS = 8000;

export interface NowPlaying {
  title: string;
  artist: string | null;
  album: string | null;
  imageUrl: string | null;
  playing: boolean;
  progressMs: number | null;
  durationMs: number | null;
}

interface Payload {
  available: boolean;
  reconnect?: boolean;
  track: NowPlaying | null;
}

/**
 * How long "not playing" has to hold before the player goes away.
 *
 * Spotify reports a track change, a seek, or a moment of buffering as nothing
 * playing at all. Believing the first such read unmounts the player under
 * whatever finger is on it, which is indistinguishable from it being broken.
 */
const QUIET_GRACE_MS = 25_000;

export function useNowPlaying(profileId: string | null, active: boolean) {
  const [data, setData] = useState<Payload | null>(null);
  const [sounding, setSounding] = useState(true);
  const quietSince = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !profileId) return;
    let alive = true;
    const load = async () => {
      try {
        const next = await api<Payload>("/api/music/now", { profileId });
        if (!alive) return;
        setData(next);
        // Without the now-playing scope there is nothing to go on, and having
        // opened the music is the best signal there is.
        const playing = next.available ? Boolean(next.track?.playing) : true;
        if (playing) quietSince.current = null;
        else if (quietSince.current === null) quietSince.current = Date.now();
        setSounding(
          playing ||
            (quietSince.current !== null && Date.now() - quietSince.current < QUIET_GRACE_MS),
        );
      } catch {
        // Nothing playing and Spotify being briefly unavailable look the same
        // from here, and neither is worth shouting about on a wall.
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [profileId, active]);

  return { data, sounding };
}
