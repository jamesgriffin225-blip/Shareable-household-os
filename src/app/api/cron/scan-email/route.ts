import { fail, handle, json } from "@/lib/http";
import { scanMailboxes } from "@/lib/scan";

export const dynamic = "force-dynamic";
// Four mailboxes, a model call per unread message: this is the long one.
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends the secret as a bearer token. Without one configured
  // the endpoint is only reachable in development.
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  try {
    if (!authorised(request)) return fail("Not authorised", 401);
    return json(await scanMailboxes());
  } catch (error) {
    return handle(error);
  }
}

export const POST = GET;
