import { runToolCall } from "@/lib/actions";
import { handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Manual recipe entry from the dashboard. Same path as a parsed one. */
export async function POST(request: Request) {
  try {
    const body = await readJson<{
      name?: string;
      servings?: string;
      instructions?: string;
      source?: string;
      ingredients?: Array<{ name?: string; quantity?: string; unit?: string; category?: string }>;
      profileId?: string;
    }>(request);
    const profileId = await requireProfile(request, body);

    const outcome = await runToolCall(
      "add_recipe",
      {
        name: body.name,
        servings: body.servings,
        instructions: body.instructions,
        source: body.source,
        ingredients: body.ingredients ?? [],
        confidence: "high",
      },
      { profileId, source: "manual" },
      { force: true },
    );

    return json(outcome, outcome.executed ? 200 : 400);
  } catch (error) {
    return handle(error);
  }
}
