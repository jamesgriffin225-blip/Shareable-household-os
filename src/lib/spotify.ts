/**
 * Spotify, as an embed rather than an integration.
 *
 * The embed plays whole tracks for anyone signed in to Spotify in that browser
 * — which on the wall is a Premium account, signed in once. No OAuth, no app
 * registration, no token to refresh.
 *
 * Deliberately NOT driven through Spotify's iframe API: calling its play() or
 * resume() is documented to start preview playback even for a signed-in
 * Premium user, while the embed's own controls play the full track. So the
 * page renders the player and then leaves it alone.
 */

const ID = /^[A-Za-z0-9]{10,40}$/;
const KINDS = ["playlist", "album", "track", "artist", "show", "episode"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * Normalise whatever someone pastes into an embed path.
 *
 * A share link, a URI off the desktop app's right-click menu, or the embed URL
 * itself — all three are what people actually have to hand, and all three
 * carry the same two facts.
 */
export function embedPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // spotify:playlist:37i9dQ...
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(trimmed);
  if (uri && isKind(uri[1]) && ID.test(uri[2])) return `${uri[1]}/${uri[2]}`;

  // https://open.spotify.com/playlist/37i9dQ...?si=... — and the /embed/ and
  // /intl-xx/ shapes Spotify also hands out.
  const url = /open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z]{2}\/)?([a-z]+)\/([A-Za-z0-9]+)/.exec(
    trimmed,
  );
  if (url && isKind(url[1]) && ID.test(url[2])) return `${url[1]}/${url[2]}`;

  return null;
}

export interface Station {
  name: string;
  /** `playlist/37i9dQ...`, ready to hang off the embed origin. */
  path: string;
}

/**
 * What the Music tab offers, in order.
 *
 * `SPOTIFY_STATIONS=Kitchen=spotify:playlist:abc,Dinner=https://open.spotify.com/album/xyz`
 * Same shape as the Pocketsmith accounts line, because it is the same job and
 * one syntax to remember is enough.
 */
export function parseStations(raw: string | undefined): Station[] {
  return (raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): Station | null => {
      const split = entry.indexOf("=");
      if (split < 1) return null;
      const name = entry.slice(0, split).trim();
      const path = embedPath(entry.slice(split + 1));
      if (!name || !path) return null;
      return { name, path };
    })
    .filter((station): station is Station => station !== null);
}

/** Only used to seed a fresh install; the real list lives in Postgres. */
export function seedStations(): Station[] {
  return parseStations(process.env.SPOTIFY_STATIONS);
}

// ------------------------------------------------------------------- oauth
//
// Connecting is optional. Without it you can still paste a link; with it the
// app can list the playlists you already have, which is the difference between
// "edit a config file" and "tap the one you want".

const AUTH = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

/**
 * Read-only. The app lists playlists and reports what is playing; it never
 * controls playback, because the embed's own buttons do that better than its
 * API does.
 */
export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-currently-playing",
  "user-read-playback-state",
].join(" ");

export function scopeHasNowPlaying(scope: string | null): boolean {
  return (scope ?? "").includes("user-read-currently-playing");
}

export function spotifyOauthConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

export function spotifyAuthUrl(state: string, redirect: string): string {
  const url = new URL(`${AUTH}/authorize`);
  url.searchParams.set("client_id", process.env.SPOTIFY_CLIENT_ID || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", SPOTIFY_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error_description?: string;
  error?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${AUTH}/api/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(
      `Spotify token exchange failed: ${json.error_description || json.error || response.status}`,
    );
  }
  return json;
}

export async function exchangeSpotifyCode(code: string, redirect: string) {
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    scope: token.scope ?? null,
  };
}

export async function refreshSpotifyToken(refreshToken: string) {
  const token = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return {
    accessToken: token.access_token,
    // Spotify usually reuses the refresh token and occasionally rotates it.
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
  };
}

export interface LibraryItem {
  name: string;
  path: string;
  imageUrl: string | null;
  tracks: number;
  owner: string | null;
}

/** What the picker shows: the playlists this account can see. */
export function readLibrary(raw: any): LibraryItem[] {
  return (raw?.items ?? [])
    .map((item: any): LibraryItem | null => {
      const path = embedPath(String(item?.uri ?? item?.external_urls?.spotify ?? ""));
      if (!path) return null;
      const image = Array.isArray(item?.images) ? item.images[0]?.url : null;
      return {
        name: String(item?.name ?? "Untitled"),
        path,
        imageUrl: typeof image === "string" ? image : null,
        tracks: Number(item?.tracks?.total ?? 0),
        owner: item?.owner?.display_name ? String(item.owner.display_name) : null,
      };
    })
    .filter((item: LibraryItem | null): item is LibraryItem => item !== null);
}

export async function fetchLibrary(accessToken: string): Promise<LibraryItem[]> {
  const response = await fetch(`${API}/me/playlists?limit=50`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Spotify ${response.status} listing playlists`);
  }
  return readLibrary(await response.json());
}

export interface NowPlaying {
  title: string;
  artist: string | null;
  album: string | null;
  imageUrl: string | null;
  playing: boolean;
  /** Where we are, and how long it is, for a progress bar. */
  progressMs: number | null;
  durationMs: number | null;
}

/**
 * Whatever Spotify is playing for this account, anywhere.
 *
 * A 204 means nothing is playing, which is an answer and not an error — it is
 * the most common response this endpoint gives.
 */
export function readNowPlaying(raw: any): NowPlaying | null {
  const item = raw?.item;
  if (!item?.name) return null;
  const image = item?.album?.images?.[0]?.url ?? item?.images?.[0]?.url ?? null;
  const artists = Array.isArray(item?.artists)
    ? item.artists.map((artist: any) => artist?.name).filter(Boolean).join(", ")
    : null;
  return {
    title: String(item.name),
    artist: artists || null,
    album: item?.album?.name ? String(item.album.name) : null,
    imageUrl: typeof image === "string" ? image : null,
    playing: raw?.is_playing === true,
    progressMs: typeof raw?.progress_ms === "number" ? raw.progress_ms : null,
    durationMs: typeof item?.duration_ms === "number" ? item.duration_ms : null,
  };
}

export async function fetchNowPlaying(accessToken: string): Promise<NowPlaying | null> {
  const response = await fetch(`${API}/me/player/currently-playing`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  // Nothing playing. Spotify says so with an empty body, not a failure.
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Spotify ${response.status} reading what is playing`);
  return readNowPlaying(await response.json().catch(() => null));
}
