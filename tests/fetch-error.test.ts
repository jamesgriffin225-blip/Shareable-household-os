import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { describeFetchFailure, safeOrigin } from "../src/lib/fetch-error.ts";

/** A real transport failure, not a hand-made object pretending to be one. */
async function failureFrom(url: string, timeoutMs?: number): Promise<unknown> {
  try {
    await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {});
    throw new Error(`expected ${url} to fail`);
  } catch (error) {
    return error;
  }
}

test("a refused connection says so, and names what it dialled", async () => {
  // A high port nothing is on. Port 1 looks tidier and is useless: undici
  // refuses it as a "bad port" before it ever opens a socket, so the test
  // would pass on a different error than the one being checked.
  const error = await failureFrom("http://127.0.0.1:45917/api/");
  assert.match((error as Error).message, /fetch failed/, "Node really is this unhelpful");

  const described = describeFetchFailure(error, "http://127.0.0.1:45917");
  assert.match(described, /ECONNREFUSED/);
  assert.match(described, /nothing is listening/);
  assert.match(described, /127\.0\.0\.1:45917/, "the address is the first thing to check");
});

test("a name that does not resolve is not the same fault", async () => {
  const error = await failureFrom("http://nothing.invalid/api/");
  const described = describeFetchFailure(error, "http://nothing.invalid");
  assert.match(described, /ENOTFOUND|EAI_AGAIN/);
  assert.match(described, /could not be resolved/);
  // The distinction that matters on a home network: a .local name that works
  // on a phone and not on the wall is mDNS, not a dead service.
  assert.doesNotMatch(described, /nothing is listening/);
});

test("a timeout reads as a timeout rather than a network error", async () => {
  // A server that accepts and then says nothing, which is what a Home
  // Assistant mid-restart does. An unroutable address would be a neater
  // test and does not work here: outbound traffic is proxied, so it
  // succeeds instead of hanging.
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    const error = await failureFrom(`http://127.0.0.1:${port}/api/`, 150);
    const described = describeFetchFailure(error, `http://127.0.0.1:${port}`);
    assert.match(described, new RegExp(`No answer from http://127\\.0\\.0\\.1:${port} before the timeout`));
  } finally {
    server.close();
  }
});

test("the cause is unwrapped however deeply it is nested", () => {
  const inner = Object.assign(new Error("certificate has expired"), {
    code: "CERT_HAS_EXPIRED",
  });
  const middle = Object.assign(new Error("fetch failed"), { cause: inner });
  const outer = Object.assign(new TypeError("fetch failed"), { cause: middle });
  assert.match(describeFetchFailure(outer, "https://home"), /certificate has expired/);
  assert.match(describeFetchFailure(outer, "https://home"), /CERT_HAS_EXPIRED/);
});

test("an unknown code is still better than the summary above it", () => {
  const inner = Object.assign(new Error("something new"), { code: "ESOMETHINGNEW" });
  const outer = Object.assign(new TypeError("fetch failed"), { cause: inner });
  const described = describeFetchFailure(outer, "https://home");
  assert.match(described, /ESOMETHINGNEW/);
  assert.doesNotMatch(described, /^fetch failed$/);
});

test("an error with no cause at all still names the target", () => {
  assert.equal(
    describeFetchFailure(new Error("something odd"), "https://home"),
    "Could not reach https://home: something odd",
  );
});

test("only the origin is shown, because a URL can carry a secret", () => {
  assert.equal(safeOrigin("https://home.example:8123/api/states?token=hunter2"), "https://home.example:8123");
  assert.equal(safeOrigin(undefined), "(no address configured)");
  // Unparseable input must not throw from inside an error handler.
  assert.equal(safeOrigin("not a url?token=secret"), "not a url");
});
