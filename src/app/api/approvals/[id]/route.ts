import { logActivity, runToolCall } from "@/lib/actions";
import { exec, one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";
import type { Source } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/**
 * Approve, edit-and-approve, or discard one queued item.
 *
 * An approved action runs with `force`, because the human standing in front of
 * the dashboard has just supplied the confidence the model lacked.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{
      decision?: "approve" | "discard";
      payload?: Record<string, unknown>;
      profileId?: string;
    }>(request);
    const resolver = await requireProfile(request, body);

    const row = await one<{
      action: string;
      payload: Record<string, any>;
      summary: string;
      source: Source;
      source_ref: Record<string, unknown> | null;
      profile_id: string | null;
      status: string;
    }>(
      `select action, payload, summary, source, source_ref, profile_id, status
       from approvals where id = $1`,
      [id],
    );
    if (!row) return fail("Not found", 404);
    if (row.status !== "pending") return fail("Already dealt with", 409);

    if (body.decision === "discard") {
      await exec(
        `update approvals set status = 'discarded', resolved_at = now(), resolved_by = $2
         where id = $1`,
        [id, resolver],
      );
      await logActivity({
        action: "discard_approval",
        summary: `Discarded: ${row.summary}`,
        profileId: resolver,
        source: row.source,
      });
      return json({ ok: true, discarded: true });
    }

    const payload = { ...row.payload, ...(body.payload ?? {}) };
    const outcome = await runToolCall(
      row.action,
      payload,
      {
        profileId: row.profile_id ?? resolver,
        source: row.source,
        sourceRef: row.source_ref,
      },
      // The queue row stays put on failure, so this must not add another.
      { force: true, queueOnError: false },
    );

    if (!outcome.executed) {
      // Leave it in the queue: a failed approval that vanishes is worse than
      // one that is still sitting there with the reason attached.
      return fail(outcome.error || "Could not do that", 502);
    }

    await exec(
      `update approvals set status = 'approved', resolved_at = now(), resolved_by = $2
       where id = $1`,
      [id, resolver],
    );
    return json(outcome);
  } catch (error) {
    return handle(error);
  }
}
