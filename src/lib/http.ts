import { NextResponse } from "next/server";
import { NotConfiguredError } from "./db.ts";
import { profileExists } from "./profiles.ts";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function fail(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}

/**
 * Every write says who made it. The phone sends its chosen profile; a request
 * without a valid one is a bug, not something to guess around.
 */
export async function requireProfile(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<string> {
  const candidate =
    (typeof body?.profileId === "string" ? body.profileId : null) ||
    request.headers.get("x-profile-id") ||
    new URL(request.url).searchParams.get("profile");
  if (!candidate) throw new HttpError("Pick a profile first", 400);
  if (!(await profileExists(candidate))) {
    throw new HttpError(`Unknown profile "${candidate}"`, 400);
  }
  return candidate;
}

export class HttpError extends Error {
  // A plain field, not a constructor parameter property: `npm test` runs the
  // TypeScript through Node's strip-only loader, which cannot transform them,
  // and a single one anywhere in an imported file takes the whole file's
  // tests down with a syntax error.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Turn thrown errors into responses the UI can actually show a person. */
export function handle(error: unknown): NextResponse {
  if (error instanceof HttpError) return fail(error.message, error.status);
  if (error instanceof NotConfiguredError) {
    return fail(
      `${error.message}. Set it in the environment and redeploy.`,
      503,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("[api]", error);
  return fail(message, 500);
}

export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
