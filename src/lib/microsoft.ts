import {
  type Connection,
  isDeadGrant,
  markNeedsReauth,
  ReconnectRequired,
  updateTokens,
} from "./connections.ts";
import { redirectUri } from "./oauth.ts";
import type { Mail } from "./google.ts";

// Mail.Read only. The calendar deliberately stays on Google — one calendar,
// two accounts, rather than four half-synced ones.
export const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "User.Read",
  "Mail.Read",
].join(" ");

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID || "common";
}

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function microsoftAuthUrl(state: string, request?: Request): string {
  const url = new URL(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`,
  );
  url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri("microsoft", request));
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

class MicrosoftTokenError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    },
  );
  const json = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new MicrosoftTokenError(
      `Microsoft token exchange failed: ${json.error_description || json.error || response.status}`,
      String(json.error ?? response.status),
    );
  }
  return json;
}

export async function exchangeMicrosoftCode(code: string, request?: Request) {
  const token = await tokenRequest({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    code,
    redirect_uri: redirectUri("microsoft", request),
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES,
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    scope: token.scope ?? null,
  };
}

async function tokenRequestOrReconnect(
  connection: Connection,
  body: Record<string, string>,
): Promise<TokenResponse> {
  try {
    return await tokenRequest(body);
  } catch (error) {
    if (error instanceof MicrosoftTokenError && isDeadGrant(error.code)) {
      await markNeedsReauth(connection.id);
      connection.needsReauth = true;
      throw new ReconnectRequired(connection.profileId, "microsoft");
    }
    throw error;
  }
}

async function accessTokenFor(connection: Connection): Promise<string> {
  const stillGood =
    connection.accessToken &&
    connection.expiresAt &&
    connection.expiresAt.getTime() - Date.now() > 60_000;
  if (stillGood) return connection.accessToken!;

  if (connection.needsReauth || !connection.refreshToken) {
    if (!connection.needsReauth && connection.accessToken) return connection.accessToken;
    throw new ReconnectRequired(connection.profileId, "microsoft");
  }

  const token = await tokenRequestOrReconnect(connection, {
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    refresh_token: connection.refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES,
  });
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  await updateTokens(connection.id, token.access_token, expiresAt, token.refresh_token ?? null);
  connection.accessToken = token.access_token;
  connection.expiresAt = expiresAt;
  return token.access_token;
}

async function graphFetch(connection: Connection, path: string): Promise<any> {
  const token = await accessTokenFor(connection);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Microsoft Graph: ${message}`);
  }
  return json;
}

export async function microsoftAccountEmail(connection: Connection): Promise<string | null> {
  const me = await graphFetch(connection, "/me?$select=mail,userPrincipalName");
  return me?.mail || me?.userPrincipalName || null;
}

export async function listRecentGraphMail(
  connection: Connection,
  since: Date,
  limit: number,
): Promise<Mail[]> {
  const params = new URLSearchParams({
    $filter: `receivedDateTime gt ${since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: String(limit),
    $select: "id,subject,from,receivedDateTime,bodyPreview,body,webLink",
  });
  const data = await graphFetch(connection, `/me/mailFolders/inbox/messages?${params}`);

  return (data?.value ?? []).map((message: any): Mail => {
    const raw = message.body?.content ?? message.bodyPreview ?? "";
    const text =
      message.body?.contentType === "html"
        ? raw
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : raw;
    return {
      id: String(message.id),
      from:
        message.from?.emailAddress?.address ||
        message.from?.emailAddress?.name ||
        "(unknown sender)",
      subject: message.subject || "(no subject)",
      receivedAt: message.receivedDateTime,
      body: String(text).slice(0, 6000),
      link: message.webLink ?? null,
    };
  });
}
