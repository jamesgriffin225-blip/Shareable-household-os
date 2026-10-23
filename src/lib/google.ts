import {
  type Connection,
  getConnection,
  isDeadGrant,
  markNeedsReauth,
  ReconnectRequired,
  updateTokens,
} from "./connections.ts";
import { redirectUri } from "./oauth.ts";
import { householdTimezone } from "./time.ts";

/**
 * Gmail is deliberately opt-in.
 *
 * `calendar.events` is a "sensitive" scope: an unverified app can be published
 * to production, users accept one warning screen, and refresh tokens then last.
 * `gmail.readonly` is "restricted", and asking for it means the app can never
 * leave testing without a Google verification review and a paid security
 * assessment — in testing, refresh tokens expire every seven days.
 *
 * For a two-person household that trade is not worth making for a mailbox that
 * Outlook already covers, so the calendar works properly by default and Gmail
 * is something you turn on knowingly.
 */
export function googleScopes(): string {
  const scopes = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
  ];
  if (gmailEnabled()) scopes.push("https://www.googleapis.com/auth/gmail.readonly");
  return scopes.join(" ");
}

export function gmailEnabled(): boolean {
  return String(process.env.GOOGLE_ENABLE_GMAIL || "").toLowerCase() === "true";
}

/** True when this connection was actually granted Gmail access. */
export function connectionHasGmail(scope: string | null): boolean {
  return (scope ?? "").includes("gmail.readonly");
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(state: string, request?: Request): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", redirectUri("google", request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleScopes());
  // Offline + consent so a refresh token comes back even on re-authorisation;
  // without it a re-connect silently produces a connection that dies in an hour.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

class GoogleTokenError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new GoogleTokenError(
      `Google token exchange failed: ${json.error_description || json.error || response.status}`,
      String(json.error ?? response.status),
    );
  }
  return json;
}

export async function exchangeGoogleCode(code: string, request?: Request) {
  const token = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectUri("google", request),
    grant_type: "authorization_code",
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    scope: token.scope ?? null,
    email: emailFromIdToken(token.id_token),
  };
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function accessTokenFor(connection: Connection): Promise<string> {
  const stillGood =
    connection.accessToken &&
    connection.expiresAt &&
    connection.expiresAt.getTime() - Date.now() > 60_000;
  if (stillGood) return connection.accessToken!;

  // Already known dead. The wall polls the calendar every few seconds, and
  // asking Google to refresh a revoked token that many times a minute earns
  // nothing but rate limiting.
  if (connection.needsReauth || !connection.refreshToken) {
    if (!connection.needsReauth && connection.accessToken) return connection.accessToken;
    throw new ReconnectRequired(connection.profileId, "google");
  }

  let token: TokenResponse;
  try {
    token = await tokenRequest({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
  } catch (error) {
    if (error instanceof GoogleTokenError && isDeadGrant(error.code)) {
      await markNeedsReauth(connection.id);
      connection.needsReauth = true;
      throw new ReconnectRequired(connection.profileId, "google");
    }
    throw error;
  }
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  await updateTokens(connection.id, token.access_token, expiresAt, token.refresh_token ?? null);
  connection.accessToken = token.access_token;
  connection.expiresAt = expiresAt;
  return token.access_token;
}

async function googleFetch(
  connection: Connection,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const token = await accessTokenFor(connection);
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Google API: ${message}`);
  }
  return json;
}

// ---------------------------------------------------------------- calendar

export interface GoogleEventInput {
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
}

export interface GoogleEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  htmlLink: string | null;
}

function parseEvent(raw: any): GoogleEvent | null {
  const start = raw?.start?.dateTime || raw?.start?.date;
  if (!start) return null;
  const allDay = !raw.start.dateTime;
  return {
    id: String(raw.id),
    title: raw.summary || "(no title)",
    start,
    end: raw.end?.dateTime || raw.end?.date || start,
    allDay,
    location: raw.location ?? null,
    // Descriptions can be a whole email thread. The detail view is a glance,
    // not a reader, and the link is there for the rest.
    notes: typeof raw.description === "string" ? raw.description.slice(0, 1200) : null,
    htmlLink: raw.htmlLink ?? null,
  };
}

export async function listCalendarEvents(
  connection: Connection,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: householdTimezone(),
  });
  const data = await googleFetch(
    connection,
    `/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events?${params}`,
  );
  return (data?.items ?? [])
    .map(parseEvent)
    .filter((event: GoogleEvent | null): event is GoogleEvent => event !== null);
}

export async function insertCalendarEvent(
  connection: Connection,
  input: GoogleEventInput,
): Promise<GoogleEvent> {
  const timeZone = householdTimezone();
  const body = {
    summary: input.title,
    location: input.location || undefined,
    description: input.notes || undefined,
    start: input.allDay
      ? { date: input.start.slice(0, 10) }
      : { dateTime: input.start, timeZone },
    end: input.allDay
      ? { date: (input.end || input.start).slice(0, 10) }
      : { dateTime: input.end || input.start, timeZone },
  };
  const created = await googleFetch(
    connection,
    `/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const parsed = parseEvent(created);
  if (!parsed) throw new Error("Google returned an event we could not read back");
  return parsed;
}

export async function deleteCalendarEvent(
  connection: Connection,
  eventId: string,
): Promise<void> {
  await googleFetch(
    connection,
    `/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

/**
 * The dashboard's id for an event: whose calendar, and Google's own id.
 *
 * Two calendars can hold the same event, so the screen needs the pair to say
 * which copy it means. A colon is safe as the join because Google's event ids
 * are base32hex -- `[a-v0-9_]` -- and can never contain one.
 */
export function eventKey(profileId: string, eventId: string): string {
  return `${profileId}:${eventId}`;
}

export function splitEventKey(key: string): { profileId: string; eventId: string } | null {
  const split = key.indexOf(":");
  if (split < 1) return null;
  const profileId = key.slice(0, split);
  const eventId = key.slice(split + 1);
  return profileId && eventId ? { profileId, eventId } : null;
}

export async function connectionForCalendar(profileId: string) {
  return getConnection(profileId, "google");
}

// ------------------------------------------------------------------- gmail

export interface Mail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  link: string | null;
}

function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain") return decodeBody(payload.body?.data);
  if (payload.mimeType === "text/html") return stripHtml(decodeBody(payload.body?.data));
  const parts: any[] = payload.parts ?? [];
  const plain = parts.find((part) => part.mimeType === "text/plain");
  if (plain) return decodeBody(plain.body?.data);
  const html = parts.find((part) => part.mimeType === "text/html");
  if (html) return stripHtml(decodeBody(html.body?.data));
  for (const part of parts) {
    const nested = extractText(part);
    if (nested) return nested;
  }
  return decodeBody(payload.body?.data);
}

export async function listRecentMail(
  connection: Connection,
  since: Date,
  limit: number,
): Promise<Mail[]> {
  const query = `in:inbox after:${Math.floor(since.getTime() / 1000)}`;
  const listing = await googleFetch(
    connection,
    `/gmail/v1/users/me/messages?${new URLSearchParams({
      q: query,
      maxResults: String(limit),
    })}`,
  );

  const messages: Mail[] = [];
  for (const stub of listing?.messages ?? []) {
    const full = await googleFetch(
      connection,
      `/gmail/v1/users/me/messages/${stub.id}?format=full`,
    );
    const headers: Array<{ name: string; value: string }> = full?.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((entry) => entry.name.toLowerCase() === name)?.value ?? "";
    messages.push({
      id: String(full.id),
      from: header("from"),
      subject: header("subject"),
      receivedAt: new Date(Number(full.internalDate || Date.now())).toISOString(),
      body: extractText(full.payload).slice(0, 6000),
      link: `https://mail.google.com/mail/u/0/#inbox/${full.id}`,
    });
  }
  return messages;
}
