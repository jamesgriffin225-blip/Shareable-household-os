import { one, sql, exec } from "./db.ts";

export type Provider = "google" | "microsoft" | "spotify";

export const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google",
  microsoft: "Outlook",
  spotify: "Spotify",
};

/**
 * The codes a provider uses to say a refresh token will never work again.
 *
 * `invalid_grant` is RFC 6749's: expired, revoked, or already used. Entra adds
 * `interaction_required`, which is the same verdict worded as a request — only
 * a person at the consent screen can resolve either. Everything else is worth
 * retrying, so nothing else belongs in here.
 */
const DEAD_GRANT_CODES = new Set(["invalid_grant", "interaction_required"]);

export function isDeadGrant(code: string): boolean {
  return DEAD_GRANT_CODES.has(code);
}

/**
 * Thrown when a provider has told us the refresh token is gone for good.
 *
 * This is not a transient failure and retrying is pointless: the only cure is
 * a person pressing Reconnect. It carries the profile and provider so the
 * caller can name them, rather than re-parsing an OAuth error string.
 */
export class ReconnectRequired extends Error {
  // Written out rather than declared as constructor parameters: the test
  // runner strips types without transforming, and parameter properties are
  // syntax it cannot strip.
  readonly profileId: string;
  readonly provider: Provider;

  constructor(profileId: string, provider: Provider) {
    super(`${PROVIDER_LABELS[provider]} needs reconnecting in Settings`);
    this.name = "ReconnectRequired";
    this.profileId = profileId;
    this.provider = provider;
  }
}

/** The ones that have a mailbox behind them. Spotify does not. */
export const MAIL_PROVIDERS: Provider[] = ["google", "microsoft"];

export interface Connection {
  id: number;
  profileId: string;
  provider: Provider;
  accountEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  calendarId: string;
  lastScannedAt: Date | null;
  scanCursor: string | null;
  needsReauth: boolean;
}

type Row = {
  id: string | number;
  profile_id: string;
  provider: Provider;
  account_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  scope: string | null;
  calendar_id: string;
  last_scanned_at: Date | null;
  scan_cursor: string | null;
  needs_reauth: boolean;
};

function toConnection(row: Row): Connection {
  return {
    id: Number(row.id),
    profileId: row.profile_id,
    provider: row.provider,
    accountEmail: row.account_email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
    calendarId: row.calendar_id,
    lastScannedAt: row.last_scanned_at,
    scanCursor: row.scan_cursor,
    needsReauth: Boolean(row.needs_reauth),
  };
}

const COLUMNS = `id, profile_id, provider, account_email, access_token,
  refresh_token, expires_at, scope, calendar_id, last_scanned_at, scan_cursor,
  needs_reauth`;

export async function listConnections(): Promise<Connection[]> {
  const rows = await sql<Row>(
    `select ${COLUMNS} from connections order by profile_id, provider`,
  );
  return rows.map(toConnection);
}

export async function getConnection(
  profileId: string,
  provider: Provider,
): Promise<Connection | null> {
  const row = await one<Row>(
    `select ${COLUMNS} from connections where profile_id = $1 and provider = $2`,
    [profileId, provider],
  );
  return row ? toConnection(row) : null;
}

export async function saveConnection(input: {
  profileId: string;
  provider: Provider;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}): Promise<void> {
  await exec(
    `insert into connections
       (profile_id, provider, account_email, access_token, refresh_token, expires_at, scope, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (profile_id, provider) do update set
       account_email = excluded.account_email,
       access_token  = excluded.access_token,
       -- Google only returns a refresh token on the first consent; keep the
       -- one we have when a re-auth doesn't bring a new one.
       refresh_token = coalesce(excluded.refresh_token, connections.refresh_token),
       expires_at    = excluded.expires_at,
       scope         = excluded.scope,
       -- Reconnecting is the cure for needs_reauth, so consenting clears it.
       needs_reauth  = false,
       updated_at    = now()`,
    [
      input.profileId,
      input.provider,
      input.accountEmail,
      input.accessToken,
      input.refreshToken,
      input.expiresAt,
      input.scope,
    ],
  );
}

export async function updateTokens(
  connectionId: number,
  accessToken: string,
  expiresAt: Date | null,
  refreshToken?: string | null,
): Promise<void> {
  await exec(
    `update connections set access_token = $2, expires_at = $3,
       refresh_token = coalesce($4, refresh_token), needs_reauth = false,
       updated_at = now()
     where id = $1`,
    [connectionId, accessToken, expiresAt, refreshToken ?? null],
  );
}

/**
 * Record that this connection's refresh token is dead.
 *
 * The tokens are left in place rather than nulled: the access token may still
 * have minutes on it, and keeping the row means Settings can offer Reconnect
 * against the account it already knows about instead of a bare "Not connected".
 */
export async function markNeedsReauth(connectionId: number): Promise<void> {
  await exec(
    "update connections set needs_reauth = true, updated_at = now() where id = $1",
    [connectionId],
  );
}

export async function markScanned(
  connectionId: number,
  cursor: string | null,
): Promise<void> {
  await exec(
    `update connections set last_scanned_at = now(), scan_cursor = coalesce($2, scan_cursor),
       updated_at = now() where id = $1`,
    [connectionId, cursor],
  );
}

export async function removeConnection(
  profileId: string,
  provider: Provider,
): Promise<void> {
  await exec("delete from connections where profile_id = $1 and provider = $2", [
    profileId,
    provider,
  ]);
}

/** Release a claim so a message that blew up mid-scan is tried again. */
export async function releaseSeen(
  connectionId: number,
  messageId: string,
): Promise<void> {
  await exec(
    "delete from email_seen where connection_id = $1 and message_id = $2",
    [connectionId, messageId],
  );
}

export async function alreadySeen(
  connectionId: number,
  messageId: string,
): Promise<boolean> {
  // The insert is the check: a conflict means another run already judged it.
  const inserted = await exec(
    `insert into email_seen (connection_id, message_id) values ($1, $2)
     on conflict do nothing`,
    [connectionId, messageId],
  );
  return inserted === 0;
}
