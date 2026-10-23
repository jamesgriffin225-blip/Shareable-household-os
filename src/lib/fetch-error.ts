/**
 * What "fetch failed" actually means.
 *
 * Node's fetch throws `TypeError: fetch failed` for every transport problem
 * and puts the real reason in `error.cause`, so the usual
 * `error instanceof Error ? error.message : String(error)` produces two words
 * that rule nothing out. Connection refused, a name that does not resolve, a
 * host on another subnet and an expired certificate are four different
 * faults with four different fixes, and they all arrive wearing the same
 * sentence.
 *
 * Same shape as every other defect in this codebase's worst week: the
 * information exists one property away and something reports the summary
 * instead.
 */

/** The codes that actually turn up on a home network, in words. */
const CAUSES: Record<string, string> = {
  ECONNREFUSED:
    "the address answered but nothing is listening on that port — the service is down, or the port is wrong",
  ENOTFOUND:
    "the host name could not be resolved — a .local name needs mDNS, which often does not survive a VLAN or a VPN",
  EAI_AGAIN: "the host name could not be resolved right now — DNS itself is not answering",
  ETIMEDOUT: "no reply at all — usually a firewall, or the wrong subnet",
  EHOSTUNREACH: "no route to that host — the two machines are not on the same network",
  ENETUNREACH: "no route to that network",
  ECONNRESET: "the connection was opened and then dropped",
  EPROTO: "a protocol mismatch — http:// against an https:// port, or the reverse",
  DEPTH_ZERO_SELF_SIGNED_CERT: "a self-signed certificate that this machine does not trust",
  SELF_SIGNED_CERT_IN_CHAIN: "a self-signed certificate in the chain that this machine does not trust",
  CERT_HAS_EXPIRED: "the certificate has expired",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the certificate could not be verified",
};

/** The deepest `cause` in the chain, which is where the real error sits. */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const next = (current as { cause?: unknown } | null)?.cause;
    if (next === undefined || next === null) break;
    current = next;
  }
  return current;
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : null;
}

/**
 * A sentence a person can act on.
 *
 * `target` is shown as-is, so callers pass an origin rather than a full URL:
 * a path or a query string can carry a token, and this string goes to a
 * screen and into logs.
 */
export function describeFetchFailure(error: unknown, target: string): string {
  // A timeout is its own thing and does not arrive with a useful cause.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return `No answer from ${target} before the timeout`;
  }

  const root = rootCause(error);
  const code = codeOf(root) ?? codeOf(error);
  if (code) {
    const explain = CAUSES[code];
    return explain
      ? `Could not reach ${target}: ${explain} (${code})`
      : `Could not reach ${target}: ${code}`;
  }

  const message =
    root instanceof Error && root.message
      ? root.message
      : error instanceof Error
        ? error.message
        : String(error);
  // Still better than "fetch failed" on its own: it names what was dialled.
  return `Could not reach ${target}: ${message}`;
}

/**
 * The origin of a URL, for showing. Falsy or unparseable input comes back as
 * a readable placeholder rather than throwing inside an error handler.
 */
export function safeOrigin(url: string | undefined | null): string {
  if (!url) return "(no address configured)";
  try {
    return new URL(url).origin;
  } catch {
    return url.split("?")[0];
  }
}
