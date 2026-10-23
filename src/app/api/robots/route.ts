import { homeAssistantConfigured } from "@/lib/homeassistant";
import { robotSnapshot } from "@/lib/robots";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Like the cameras: a house that can't be reached must not break the wall. */
export async function GET() {
  try {
    if (!homeAssistantConfigured()) {
      return json({ configured: false, robots: [], error: null });
    }
    return json({ configured: true, robots: await robotSnapshot(), error: null });
  } catch (error) {
    return json({
      configured: true,
      robots: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
