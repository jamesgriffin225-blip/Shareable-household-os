import { loadState } from "@/lib/state";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Everything the dashboard polls for.
 *
 * The wall tablet asks every couple of seconds, all day. Passing `?since=` with
 * the last revision turns the overwhelming majority of those into a thirty-byte
 * "nothing changed" instead of the whole household — which matters now that the
 * payload carries a photo library.
 */
export async function GET(request: Request) {
  try {
    const since = new URL(request.url).searchParams.get("since");
    const state = await loadState();
    if (since && since === state.revision) {
      return json({ revision: state.revision, unchanged: true });
    }
    return json(state);
  } catch (error) {
    return handle(error);
  }
}
