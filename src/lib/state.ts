import { createHash } from "node:crypto";
import { getState, sql } from "./db.ts";
import { listProfiles } from "./profiles.ts";
import {
  normaliseCategory,
  normaliseFrame,
  type HouseholdState,
  type Source,
} from "./types.ts";

/**
 * How long a ticked item stays on the list. The dashboard animates it out over
 * five seconds with an undo control; the server keeps it visible a beat longer
 * so a second screen never drops it mid-animation.
 */
export const CHECKED_GRACE_SECONDS = 6;

/** Where the frame's settings live, so every screen agrees on what's showing. */
export const FRAME_KEY = "photos:frame";

export async function loadState(): Promise<HouseholdState> {
  const [
    profiles,
    shopping,
    recipeRows,
    ingredientRows,
    reminders,
    approvals,
    activity,
    photos,
    frame,
  ] = await Promise.all([
      listProfiles(),
      sql<any>(
        `select id, name, quantity, unit, category, note, recipe_id, recipe_name,
                added_by, source, checked_at, created_at
         from shopping_items
         where removed_at is null
           and (checked_at is null or checked_at > now() - interval '${CHECKED_GRACE_SECONDS} seconds')
         order by created_at`,
      ),
      sql<any>(
        `select id, name, servings, instructions, source, added_by, created_at
         from recipes order by lower(name)`,
      ),
      sql<any>(
        `select id, recipe_id, name, quantity, unit, category
         from recipe_ingredients order by recipe_id, position`,
      ),
      sql<any>(
        `select id, title, notes, due_at, done_at, added_by, source, created_at
         from reminders
         where removed_at is null
           and (done_at is null or done_at > now() - interval '1 day')
         -- Done drops to the bottom rather than staying where it was: a
         -- ticked job that keeps its place in the list is still competing for
         -- the eye with the ones that are not done. Within the done group the
         -- most recently finished sits first, which is where an undo goes
         -- looking; within the open group the due date still leads.
         order by (done_at is not null),
                  done_at desc nulls last,
                  due_at asc nulls last,
                  created_at desc
         limit 40`,
      ),
      sql<any>(
        `select id, action, payload, summary, reason, confidence, source,
                source_ref, profile_id, created_at
         from approvals where status = 'pending'
         order by created_at desc limit 30`,
      ),
      sql<any>(
        `select id, action, summary, profile_id, source, entity_type, entity_id,
                (undo is not null) as undoable, undone_at, created_at
         from activity order by created_at desc, id desc limit 25`,
      ),
      // Metadata only — the bytes are served by their own route.
      sql<any>(
        `select id, caption, width, height, added_by, created_at
         from photos where removed_at is null order by created_at desc limit 500`,
      ),
      getState<unknown>(FRAME_KEY),
    ]);

  const ingredientsByRecipe = new Map<string, any[]>();
  for (const row of ingredientRows) {
    const list = ingredientsByRecipe.get(row.recipe_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: normaliseCategory(row.category),
    });
    ingredientsByRecipe.set(row.recipe_id, list);
  }

  const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

  const state: Omit<HouseholdState, "revision"> = {
    profiles,
    shopping: shopping.map((row) => ({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: normaliseCategory(row.category),
      note: row.note,
      recipeId: row.recipe_id,
      recipeName: row.recipe_name,
      addedBy: row.added_by,
      source: row.source as Source,
      checkedAt: iso(row.checked_at),
      createdAt: iso(row.created_at)!,
    })),
    recipes: recipeRows.map((row) => ({
      id: row.id,
      name: row.name,
      servings: row.servings,
      instructions: row.instructions,
      source: row.source,
      addedBy: row.added_by,
      createdAt: iso(row.created_at)!,
      ingredients: ingredientsByRecipe.get(row.id) ?? [],
    })),
    reminders: reminders.map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      dueAt: iso(row.due_at),
      doneAt: iso(row.done_at),
      addedBy: row.added_by,
      source: row.source as Source,
      createdAt: iso(row.created_at)!,
    })),
    approvals: approvals.map((row) => ({
      id: row.id,
      action: row.action,
      payload: row.payload,
      summary: row.summary,
      reason: row.reason,
      confidence: row.confidence,
      source: row.source as Source,
      sourceRef: row.source_ref,
      profileId: row.profile_id,
      createdAt: iso(row.created_at)!,
    })),
    photos: photos.map((row) => ({
      id: row.id,
      caption: row.caption,
      width: row.width,
      height: row.height,
      addedBy: row.added_by,
      createdAt: iso(row.created_at)!,
    })),
    frame: normaliseFrame(frame?.value),
    activity: activity.map((row) => ({
      id: Number(row.id),
      action: row.action,
      summary: row.summary,
      profileId: row.profile_id,
      source: row.source as Source,
      entityType: row.entity_type,
      entityId: row.entity_id,
      undoable: Boolean(row.undoable),
      undoneAt: iso(row.undone_at),
      createdAt: iso(row.created_at)!,
    })),
  };

  return {
    ...state,
    revision: createHash("sha1").update(JSON.stringify(state)).digest("hex").slice(0, 16),
  };
}
