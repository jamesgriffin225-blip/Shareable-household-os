import { exec, one, sql } from "./db.ts";
import { listProfiles, matchProfile } from "./profiles.ts";
import { getConnection } from "./connections.ts";
import {
  deleteCalendarEvent,
  insertCalendarEvent,
  type GoogleEventInput,
} from "./google.ts";
import { describeMoment, fromWallClock, householdTimezone, isDateOnly } from "./time.ts";
import { normaliseCategory, type Confidence, type Source } from "./types.ts";

export interface ActionContext {
  /** Who is capturing. Everything added anywhere gets tagged with this. */
  profileId: string;
  source: Source;
  sourceRef?: Record<string, unknown> | null;
}

export interface ActionOutcome {
  executed: boolean;
  action: string;
  summary: string;
  activityId?: number;
  approvalId?: string;
  error?: string;
}

type Json = Record<string, any>;

function confidenceOf(input: Json): Confidence {
  const value = String(input.confidence ?? "").toLowerCase();
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function logActivity(input: {
  action: string;
  summary: string;
  detail?: Json | null;
  profileId: string | null;
  source: Source;
  entityType?: string | null;
  entityId?: string | null;
  undo?: Json | null;
}): Promise<number> {
  const row = await one<{ id: string }>(
    `insert into activity (action, summary, detail, profile_id, source, entity_type, entity_id, undo)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.action,
      input.summary,
      input.detail ? JSON.stringify(input.detail) : null,
      input.profileId,
      input.source,
      input.entityType ?? null,
      input.entityId ?? null,
      input.undo ? JSON.stringify(input.undo) : null,
    ],
  );
  return Number(row!.id);
}

export async function queueApproval(input: {
  action: string;
  payload: Json;
  summary: string;
  reason: string | null;
  confidence: Confidence;
  context: ActionContext;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into approvals (action, payload, summary, reason, confidence, source, source_ref, profile_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.action,
      JSON.stringify(input.payload),
      input.summary,
      input.reason,
      input.confidence,
      input.context.source,
      input.context.sourceRef ? JSON.stringify(input.context.sourceRef) : null,
      input.context.profileId,
    ],
  );
  return row!.id;
}

/**
 * A one-line description of what a tool call would do, written before it runs
 * so the approval queue and the confirmation toast say the same thing.
 */
export function describeAction(action: string, input: Json): string {
  switch (action) {
    case "add_calendar_event": {
      const when = input.start
        ? describeMoment(String(input.start), { allDay: Boolean(input.all_day) })
        : "no date";
      return `Calendar: ${input.title} — ${when}`;
    }
    case "add_shopping_items": {
      const items: Json[] = Array.isArray(input.items) ? input.items : [];
      const names = items.map((item) => String(item.name)).filter(Boolean);
      if (names.length === 0) return "Shopping list: nothing";
      if (names.length <= 3) return `Shopping list: ${names.join(", ")}`;
      return `Shopping list: ${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
    }
    case "add_reminder":
      return input.due_at
        ? `Reminder: ${input.title} — ${describeMoment(String(input.due_at), {
            allDay: isDateOnly(String(input.due_at)),
          })}`
        : `Reminder: ${input.title}`;
    case "add_recipe": {
      const count = Array.isArray(input.ingredients) ? input.ingredients.length : 0;
      return `Recipe: ${input.name} (${count} ingredient${count === 1 ? "" : "s"})`;
    }
    case "add_recipe_to_shopping_list":
      return `Shopping list: everything for ${input.recipe_name}`;
    case "log_note":
      return `Note: ${input.title || String(input.body ?? "").slice(0, 60)}`;
    case "log_expense_note": {
      const amount =
        typeof input.amount === "number"
          ? ` ${formatMoney(input.amount, String(input.currency || "AUD"))}`
          : "";
      return `Spend: ${input.description}${amount}`;
    }
    case "no_action":
      return String(input.reason || "Nothing to record");
    default:
      return action;
  }
}

export function formatMoney(amount: number, currency = "AUD"): string {
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Run one tool call from Claude.
 *
 * Anything below high confidence is parked in "Needs your OK" instead of being
 * executed — unless `force`, which is what approving from the dashboard does.
 */
export async function runToolCall(
  action: string,
  input: Json,
  context: ActionContext,
  options: { force?: boolean; queueOnError?: boolean } = {},
): Promise<ActionOutcome> {
  const summary = describeAction(action, input);

  if (action === "no_action") {
    return { executed: false, action, summary };
  }

  const confidence = confidenceOf(input);
  if (!options.force && confidence !== "high") {
    const approvalId = await queueApproval({
      action,
      payload: input,
      summary,
      reason: text(input.confidence_reason),
      confidence,
      context,
    });
    return { executed: false, action, summary, approvalId };
  }

  try {
    switch (action) {
      case "add_calendar_event":
        return await addCalendarEvent(input, context, summary);
      case "add_shopping_items":
        return await addShoppingItems(input, context, summary);
      case "add_reminder":
        return await addReminder(input, context, summary);
      case "add_recipe":
        return await addRecipe(input, context, summary);
      case "add_recipe_to_shopping_list":
        return await addRecipeToList(input, context);
      case "log_note":
        return await logNote(input, context, summary);
      case "log_expense_note":
        return await logExpenseNote(input, context, summary);
      default:
        return { executed: false, action, summary, error: `Unknown action ${action}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // A failure is not a dropped capture: park it so it can be retried or
    // fixed by hand once whatever broke is reconnected. Approving from the
    // queue is the exception — that row is still sitting there, and queueing
    // again would multiply one stuck item every time somebody retried it.
    if (options.queueOnError === false) {
      return { executed: false, action, summary, error: message };
    }

    const approvalId = await queueApproval({
      action,
      payload: input,
      summary,
      reason: message,
      confidence,
      context,
    });
    return { executed: false, action, summary, approvalId, error: message };
  }
}

async function addCalendarEvent(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const profiles = await listProfiles();
  const target =
    matchProfile(profiles, text(input.for_profile)) ??
    profiles.find((profile) => profile.id === context.profileId) ??
    profiles[0];

  const connection = target ? await getConnection(target.id, "google") : null;
  if (!connection) {
    throw new Error(
      `No Google Calendar connected for ${target?.name ?? "this profile"} — connect it in Settings`,
    );
  }

  const startRaw = String(input.start);
  const allDay = Boolean(input.all_day) || isDateOnly(startRaw);
  const start = fromWallClock(startRaw);
  if (!start) throw new Error(`Could not read the date "${startRaw}"`);

  let endRaw = text(input.end);
  if (!endRaw) {
    endRaw = allDay
      ? startRaw.slice(0, 10)
      : new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  }

  const event = await insertCalendarEvent(connection, {
    title: String(input.title),
    // Google wants a wall clock plus a timeZone, which is exactly the shape
    // Claude was asked for; only an already-absolute end needs normalising.
    start: allDay ? startRaw.slice(0, 10) : localStamp(start),
    end: allDay
      ? nextDay(endRaw.slice(0, 10))
      : localStamp(fromWallClock(endRaw) ?? new Date(start.getTime() + 3_600_000)),
    allDay,
    location: text(input.location),
    notes: text(input.notes),
  });

  const activityId = await logActivity({
    action: "add_calendar_event",
    summary: `${event.title} — ${describeMoment(start, { allDay })}${
      target && target.id !== context.profileId ? ` (${target.name}'s calendar)` : ""
    }`,
    detail: { eventId: event.id, profileId: target.id },
    profileId: context.profileId,
    source: context.source,
    entityType: "calendar_event",
    entityId: event.id,
    undo: { kind: "calendar", profileId: target.id, eventId: event.id },
  });

  return { executed: true, action: "add_calendar_event", summary, activityId };
}

/** Wall-clock stamp Google pairs with an explicit timeZone. */
function localStamp(instant: Date): string {
  const timeZone = householdTimezone();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)!.value;
  const hour = String(Number(read("hour")) % 24).padStart(2, "0");
  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}:${read("second")}`;
}

/** Google all-day end dates are exclusive. */
function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

interface IngredientInput {
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string;
}

function readIngredients(value: unknown): IngredientInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw: Json) => ({
      name: text(raw?.name) ?? "",
      quantity: text(raw?.quantity),
      unit: text(raw?.unit),
      category: normaliseCategory(raw?.category),
    }))
    .filter((item) => item.name.length > 0);
}

async function insertShoppingItems(
  items: IngredientInput[],
  context: ActionContext,
  recipe?: { id: string; name: string } | null,
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const row = await one<{ id: string }>(
      `insert into shopping_items (name, quantity, unit, category, recipe_id, recipe_name, added_by, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        item.name,
        item.quantity,
        item.unit,
        item.category,
        recipe?.id ?? null,
        recipe?.name ?? null,
        context.profileId,
        recipe ? "recipe" : context.source,
      ],
    );
    ids.push(row!.id);
  }
  return ids;
}

async function addShoppingItems(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const items = readIngredients(input.items);
  if (items.length === 0) throw new Error("No usable items in that");

  const ids = await insertShoppingItems(items, context);
  const activityId = await logActivity({
    action: "add_shopping_items",
    summary:
      items.length === 1
        ? `${items[0].name} → shopping list`
        : `${items.length} items → shopping list`,
    detail: { names: items.map((item) => item.name) },
    profileId: context.profileId,
    source: context.source,
    entityType: "shopping_items",
    entityId: ids[0] ?? null,
    undo: { kind: "shopping", ids },
  });

  return { executed: true, action: "add_shopping_items", summary, activityId };
}

async function addReminder(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const dueRaw = text(input.due_at);
  const due = dueRaw ? fromWallClock(dueRaw) : null;
  const row = await one<{ id: string }>(
    `insert into reminders (title, notes, due_at, added_by, source)
     values ($1, $2, $3, $4, $5) returning id`,
    [String(input.title), text(input.notes), due, context.profileId, context.source],
  );

  const activityId = await logActivity({
    action: "add_reminder",
    summary: `Reminder: ${input.title}`,
    profileId: context.profileId,
    source: context.source,
    entityType: "reminder",
    entityId: row!.id,
    undo: { kind: "row", table: "reminders", id: row!.id },
  });

  return { executed: true, action: "add_reminder", summary, activityId };
}

async function addRecipe(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const ingredients = readIngredients(input.ingredients);
  if (ingredients.length === 0) throw new Error("No readable ingredients");

  const recipe = await one<{ id: string }>(
    `insert into recipes (name, servings, instructions, source, added_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      String(input.name),
      text(input.servings),
      text(input.instructions),
      text(input.source),
      context.profileId,
    ],
  );

  for (const [position, ingredient] of ingredients.entries()) {
    await exec(
      `insert into recipe_ingredients (recipe_id, name, quantity, unit, category, position)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        recipe!.id,
        ingredient.name,
        ingredient.quantity,
        ingredient.unit,
        ingredient.category,
        position,
      ],
    );
  }

  const activityId = await logActivity({
    action: "add_recipe",
    summary: `Recipe saved: ${input.name}`,
    profileId: context.profileId,
    source: context.source,
    entityType: "recipe",
    entityId: recipe!.id,
    undo: { kind: "recipe", id: recipe!.id },
  });

  return { executed: true, action: "add_recipe", summary, activityId };
}

async function addRecipeToList(
  input: Json,
  context: ActionContext,
): Promise<ActionOutcome> {
  const name = String(input.recipe_name ?? "").trim();
  const recipe = await one<{ id: string; name: string }>(
    `select id, name from recipes
     where lower(name) = lower($1) or lower(name) like lower($2)
     order by (lower(name) = lower($1)) desc, created_at desc limit 1`,
    [name, `%${name}%`],
  );
  if (!recipe) throw new Error(`No recipe called "${name}" in the library`);

  const result = await addRecipeIngredientsToList(recipe.id, context, null);
  return {
    executed: true,
    action: "add_recipe_to_shopping_list",
    summary: `Shopping list: ${result.count} ingredient${result.count === 1 ? "" : "s"} for ${recipe.name}`,
    activityId: result.activityId,
  };
}

/**
 * Shared by the capture flow and the dashboard's two recipe buttons.
 * `skip` carries the ingredients ticked as "already have" in the cook flow.
 */
export async function addRecipeIngredientsToList(
  recipeId: string,
  context: ActionContext,
  skip: string[] | null,
): Promise<{ count: number; activityId: number; recipeName: string }> {
  const recipe = await one<{ id: string; name: string }>(
    "select id, name from recipes where id = $1",
    [recipeId],
  );
  if (!recipe) throw new Error("That recipe is gone");

  const skipSet = new Set((skip ?? []).map(String));
  const rows = await sql<{
    id: string;
    name: string;
    quantity: string | null;
    unit: string | null;
    category: string;
  }>(
    `select id, name, quantity, unit, category from recipe_ingredients
     where recipe_id = $1 order by position`,
    [recipeId],
  );
  const wanted = rows
    .filter((row) => !skipSet.has(row.id))
    .map((row) => ({
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: normaliseCategory(row.category),
    }));

  if (wanted.length === 0) throw new Error("Nothing left to add — you have it all");

  const ids = await insertShoppingItems(wanted, context, recipe);
  const activityId = await logActivity({
    action: "add_recipe_to_shopping_list",
    summary: `${wanted.length} ingredient${wanted.length === 1 ? "" : "s"} for ${recipe.name} → shopping list`,
    detail: { recipeId, skipped: skipSet.size },
    profileId: context.profileId,
    source: context.source,
    entityType: "shopping_items",
    entityId: ids[0] ?? null,
    undo: { kind: "shopping", ids },
  });

  return { count: wanted.length, activityId, recipeName: recipe.name };
}

async function logNote(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const row = await one<{ id: string }>(
    "insert into notes (title, body, added_by, source) values ($1, $2, $3, $4) returning id",
    [text(input.title), String(input.body), context.profileId, context.source],
  );
  const activityId = await logActivity({
    action: "log_note",
    summary: `Note: ${input.title || String(input.body).slice(0, 50)}`,
    profileId: context.profileId,
    source: context.source,
    entityType: "note",
    entityId: row!.id,
    undo: { kind: "row", table: "notes", id: row!.id },
  });
  return { executed: true, action: "log_note", summary, activityId };
}

async function logExpenseNote(
  input: Json,
  context: ActionContext,
  summary: string,
): Promise<ActionOutcome> {
  const amount = typeof input.amount === "number" ? input.amount : null;
  const occurred = text(input.occurred_on);
  const row = await one<{ id: string }>(
    `insert into expense_notes (description, amount, currency, category, occurred_on, added_by, source)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      String(input.description),
      amount,
      text(input.currency) ?? "AUD",
      text(input.category),
      occurred,
      context.profileId,
      context.source,
    ],
  );
  const activityId = await logActivity({
    action: "log_expense_note",
    summary,
    profileId: context.profileId,
    source: context.source,
    entityType: "expense_note",
    entityId: row!.id,
    undo: { kind: "row", table: "expense_notes", id: row!.id },
  });
  return { executed: true, action: "log_expense_note", summary, activityId };
}

/**
 * Take an event off a calendar, remembering enough to put it back.
 *
 * Google has no undelete, so the undo is a re-insert from the fields we held
 * on to. It comes back with a new id, which is why the activity row records
 * the event rather than pointing at one.
 */
export async function removeCalendarEvent(input: {
  profileId: string;
  eventId: string;
  event: GoogleEventInput;
  source: Source;
  removedBy: string | null;
}): Promise<number> {
  const connection = await getConnection(input.profileId, "google");
  if (!connection) throw new Error("That calendar is not connected");

  await deleteCalendarEvent(connection, input.eventId);

  return logActivity({
    action: "remove_calendar_event",
    summary: `Removed "${input.event.title}" from the calendar`,
    detail: { start: input.event.start, allDay: input.event.allDay },
    profileId: input.removedBy,
    source: input.source,
    entityType: "calendar",
    entityId: input.eventId,
    undo: {
      kind: "restore_calendar",
      profileId: input.profileId,
      event: input.event as unknown as Json,
    },
  });
}

/** Reverse a logged activity. Returns false if there is nothing to undo. */
export async function undoActivity(activityId: number): Promise<boolean> {
  const row = await one<{ undo: Json | null; undone_at: Date | null; summary: string }>(
    "select undo, undone_at, summary from activity where id = $1",
    [activityId],
  );
  if (!row || !row.undo || row.undone_at) return false;

  const undo = row.undo;
  switch (undo.kind) {
    case "shopping":
      await exec(
        "update shopping_items set removed_at = now(), updated_at = now() where id = any($1::uuid[])",
        [undo.ids],
      );
      break;
    case "row": {
      const allowed = ["reminders", "notes", "expense_notes"];
      if (!allowed.includes(undo.table)) return false;
      await exec(
        `update ${undo.table} set removed_at = now() where id = $1`,
        [undo.id],
      );
      break;
    }
    case "recipe":
      await exec("delete from recipes where id = $1", [undo.id]);
      break;
    case "photo":
      await exec("update photos set removed_at = now() where id = $1", [undo.id]);
      break;
    case "restore_photo":
      await exec("update photos set removed_at = null where id = $1", [undo.id]);
      break;
    case "restore_row": {
      // The mirror of "row": that one removes something that was added, this
      // one puts back something that was removed. Same allow-list, because the
      // table name reaches SQL by interpolation and nothing else checks it.
      const allowed = ["reminders", "notes", "expense_notes"];
      if (!allowed.includes(undo.table)) return false;
      await exec(`update ${undo.table} set removed_at = null where id = $1`, [undo.id]);
      break;
    }
    case "uncheck":
      await exec(
        "update shopping_items set checked_at = null, updated_at = now() where id = $1",
        [undo.id],
      );
      break;
    case "calendar": {
      const connection = await getConnection(undo.profileId, "google");
      if (!connection) return false;
      await deleteCalendarEvent(connection, undo.eventId);
      break;
    }
    case "restore_calendar": {
      const connection = await getConnection(undo.profileId, "google");
      if (!connection) return false;
      await insertCalendarEvent(connection, undo.event as unknown as GoogleEventInput);
      break;
    }
    default:
      return false;
  }

  await exec("update activity set undone_at = now() where id = $1", [activityId]);
  await logActivity({
    action: "undo",
    summary: `Undone: ${row.summary}`,
    profileId: null,
    source: "manual",
  });
  return true;
}

export { logActivity };
