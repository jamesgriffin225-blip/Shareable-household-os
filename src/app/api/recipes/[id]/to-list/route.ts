import { addRecipeIngredientsToList } from "@/lib/actions";
import { handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Both recipe flows land here.
 *
 * "Add this recipe to the list" sends no `have`; "I want to make X" sends the
 * ingredient ids ticked as already in the cupboard, and only the rest is added.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{ have?: string[]; profileId?: string }>(request);
    const profileId = await requireProfile(request, body);

    const result = await addRecipeIngredientsToList(
      id,
      { profileId, source: "recipe" },
      Array.isArray(body.have) ? body.have : null,
    );
    return json(result);
  } catch (error) {
    return handle(error);
  }
}
