"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

interface Station {
  id: string;
  name: string;
  path: string;
  imageUrl: string | null;
}

interface LibraryItem {
  name: string;
  path: string;
  imageUrl: string | null;
  tracks: number;
  owner: string | null;
}

export interface MusicData {
  configured: boolean;
  stations: Station[];
  oauth: boolean;
  connected: boolean;
}

export function useMusic(profileId: string | null) {
  const [data, setData] = useState<MusicData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MusicData>("/api/music", { profileId }));
      setError(null);
    } catch (cause) {
      // Swallowing this reads as "no playlists configured", which sent us
      // looking in the wrong place once already.
      setError(cause instanceof Error ? cause.message : String(cause));
      setData({ configured: false, stations: [], oauth: false, connected: false });
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

/**
 * Spotify on the wall.
 *
 * The embed and nothing else: signed in as Premium on this machine it plays
 * whole tracks, and it is not driven through Spotify's iframe API, because
 * calling play() there is documented to drop a signed-in listener into
 * 30-second previews. Its own buttons do not.
 */
export default function Music({
  data,
  error,
  profileId,
  onChanged,
}: {
  data: MusicData | null;
  error?: string | null;
  profileId: string;
  onChanged: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [windows, setWindows] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setWindows(/Windows/i.test(navigator.userAgent));
  }, []);

  if (!data) {
    return (
      <p className="empty">
        <span className="spinner" /> Looking&hellip;
      </p>
    );
  }

  const station = data.stations[Math.min(index, data.stations.length - 1)];

  return (
    <div className="music">
      {error ? <div className="banner">Couldn&rsquo;t read the playlists: {error}</div> : null}
      <div className="music__bar">
        {data.stations.map((entry, position) => (
          <button
            key={entry.id}
            className={`chip${entry.id === station?.id ? " chip--on" : ""}`}
            onClick={() => setIndex(position)}
          >
            {entry.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="chip__art" src={entry.imageUrl} alt="" />
            ) : null}
            {entry.name}
          </button>
        ))}
        <button className="chip chip--add" onClick={() => setPicking(true)}>
          + Add
        </button>
      </div>

      {station ? (
        <iframe
          className="music__embed"
          // Keyed so switching remounts rather than leaving the old player
          // running behind the new one.
          key={station.path}
          src={`https://open.spotify.com/embed/${station.path}?utm_source=generator&theme=0`}
          title={`${station.name} on Spotify`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : (
        <p className="empty">
          Nothing pinned yet. <strong>+ Add</strong> to pick a playlist.
        </p>
      )}

      {windows ? (
        <div className="music__audio">
          {/*
            A web page cannot connect a Bluetooth speaker: pairing and output
            routing belong to the operating system, and Web Bluetooth reaches
            low-energy data devices only, never A2DP audio. What it can do is
            open the two Windows panels that own it.
          */}
          <a className="btn" href="ms-settings:bluetooth">
            Bluetooth devices
          </a>
          <a className="btn" href="ms-settings:sound">
            Where the sound goes
          </a>
        </div>
      ) : null}

      {picking ? (
        <Picker
          data={data}
          profileId={profileId}
          onClose={() => setPicking(false)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

/**
 * Choosing what to pin.
 *
 * Two ways in, because they fail differently. Connected, it lists the
 * playlists you already have and you tap one — no typing, which is the only
 * thing that works on a wall-mounted tablet. Not connected, or something
 * shared with you by a link, you paste it.
 */
function Picker({
  data,
  profileId,
  onClose,
  onChanged,
}: {
  data: MusicData;
  profileId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!data.connected) return;
    api<{ playlists: LibraryItem[] }>("/api/music/library", { profileId })
      .then((result) => setLibrary(result.playlists))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [data.connected, profileId]);

  const pin = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await api("/api/music", { method: "POST", profileId, body: JSON.stringify(body) });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const unpin = async (station: Station) => {
    setBusy(station.id);
    try {
      await api(`/api/music?id=${encodeURIComponent(station.id)}`, {
        method: "DELETE",
        profileId,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const pinned = new Set(data.stations.map((entry) => entry.path));

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet__card" onClick={(click) => click.stopPropagation()}>
        <header className="sheet__head">
          <span />
          <div>
            <h2 className="sheet__title">Music on the wall</h2>
            <p className="sheet__when">Pin the playlists you actually reach for.</p>
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {error ? <div className="banner">{error}</div> : null}

        {data.stations.length > 0 ? (
          <div>
            <h3 className="aisle__name">Pinned</h3>
            <div className="music__pinned">
              {data.stations.map((station) => (
                <div className="music__row" key={station.id}>
                  {station.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="music__art" src={station.imageUrl} alt="" />
                  ) : (
                    <span className="music__art music__art--blank" />
                  )}
                  <span className="music__row-name">{station.name}</span>
                  <button
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => void unpin(station)}
                  >
                    {busy === station.id ? "…" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {data.connected ? (
          <div>
            <h3 className="aisle__name">Your playlists</h3>
            {!library ? (
              <p className="empty">
                <span className="spinner" /> Reading your Spotify&hellip;
              </p>
            ) : library.length === 0 ? (
              <p className="empty">No playlists on this account.</p>
            ) : (
              <div className="music__library">
                {library.map((item) => (
                  <button
                    className="music__row music__row--pick"
                    key={item.path}
                    disabled={busy !== null || pinned.has(item.path)}
                    onClick={() =>
                      void pin(
                        { name: item.name, path: item.path, imageUrl: item.imageUrl },
                        item.path,
                      )
                    }
                  >
                    {item.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="music__art" src={item.imageUrl} alt="" />
                    ) : (
                      <span className="music__art music__art--blank" />
                    )}
                    <span className="music__row-name">
                      {item.name}
                      <span className="recipe__meta">
                        {item.tracks} tracks{item.owner ? ` · ${item.owner}` : ""}
                      </span>
                    </span>
                    <span className="music__pin">
                      {pinned.has(item.path) ? "Pinned" : busy === item.path ? "…" : "Pin"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : data.oauth ? (
          // A plain navigation carries no headers, so the profile has to ride
          // in the query string — the same way Settings connects Google.
          <a
            className="btn btn--primary"
            href={`/api/auth/spotify?profile=${encodeURIComponent(profileId)}`}
          >
            Connect Spotify to list your playlists
          </a>
        ) : null}

        <div>
          <h3 className="aisle__name">Or paste a link</h3>
          <div className="music__paste">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Call it something"
              aria-label="Name"
            />
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://open.spotify.com/playlist/…"
              aria-label="Spotify link"
            />
            <button
              className="btn btn--primary"
              disabled={!name.trim() || !link.trim() || busy !== null}
              onClick={async () => {
                await pin({ name, link }, "paste");
                setName("");
                setLink("");
              }}
            >
              {busy === "paste" ? "…" : "Pin"}
            </button>
          </div>
          <p className="setting__note">
            In Spotify: right-click a playlist, Share, Copy link.
          </p>
        </div>
      </div>
    </div>
  );
}
