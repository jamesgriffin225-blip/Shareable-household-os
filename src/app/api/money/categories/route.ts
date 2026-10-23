import { categoryReport, pocketsmithConfigured } from "@/lib/pocketsmith";
import { fail, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Spending by category over an arbitrary range: a week, a month, or a span. */
export async function GET(request: Request) {
  try {
    if (!pocketsmithConfigured()) return json({ configured: false, report: null });

    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!DAY_KEY.test(from) || !DAY_KEY.test(to)) {
      return fail("from and to must both be YYYY-MM-DD", 400);
    }
    if (from > to) return fail("from is after to", 400);

    return json({ configured: true, report: await categoryReport(from, to) });
  } catch (error) {
    return handle(error);
  }
}
