import { moneySnapshot, pocketsmithConfigured } from "@/lib/pocketsmith";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    if (!pocketsmithConfigured()) return json({ configured: false, snapshot: null });
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    return json({ configured: true, snapshot: await moneySnapshot({ force }) });
  } catch (error) {
    return handle(error);
  }
}
