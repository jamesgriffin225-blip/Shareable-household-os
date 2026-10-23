import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDeadGrant,
  ReconnectRequired,
  type Connection,
} from "../src/lib/connections.ts";
import { listCalendarEvents } from "../src/lib/google.ts";
import { listRecentGraphMail } from "../src/lib/microsoft.ts";

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 1,
    profileId: "alex",
    provider: "google",
    accountEmail: "alex@example.com",
    accessToken: "stale",
    refreshToken: "dead",
    // An hour in the past: the cached access token is no help.
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    scope: "https://www.googleapis.com/auth/calendar.events",
    calendarId: "primary",
    lastScannedAt: null,
    scanCursor: null,
    needsReauth: false,
    ...overrides,
  };
}

test("only the codes that mean 'a person must consent again' count as dead", () => {
  assert.equal(isDeadGrant("invalid_grant"), true);
  assert.equal(isDeadGrant("interaction_required"), true);
  // Retryable: the network, Google's side, or our own client configuration.
  for (const code of ["temporarily_unavailable", "500", "503", "invalid_client", "slow_down"]) {
    assert.equal(isDeadGrant(code), false, `${code} should be retryable`);
  }
});

test("a connection already known dead never reaches the network", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    assert.fail("a revoked connection must not be refreshed again");
  }) as typeof fetch;
  try {
    await assert.rejects(
      listCalendarEvents(connection({ needsReauth: true }), new Date(), new Date()),
      (error: unknown) => error instanceof ReconnectRequired && error.profileId === "alex",
    );
    await assert.rejects(
      listRecentGraphMail(
        connection({ provider: "microsoft", needsReauth: true, profileId: "sam" }),
        new Date(),
        5,
      ),
      (error: unknown) => error instanceof ReconnectRequired && error.provider === "microsoft",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("the message names the cure rather than what the provider said", () => {
  assert.match(
    new ReconnectRequired("alex", "google").message,
    /Google needs reconnecting in Settings/,
  );
  assert.match(
    new ReconnectRequired("sam", "microsoft").message,
    /Outlook needs reconnecting in Settings/,
  );
});
