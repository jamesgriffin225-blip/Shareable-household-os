import type Anthropic from "@anthropic-ai/sdk";
import { HOUSEHOLD_TOOLS } from "../tools.ts";
import { CATEGORIES } from "../types.ts";
import { householdTimezone } from "../time.ts";
import type { Context } from "./types.ts";

/**
 * Everything both backends say, in one place.
 *
 * The API backend hands the tool definitions to the model as JSON Schema and
 * gets `tool_use` blocks back. The CLI backend has no such mechanism, so it
 * describes the same tools in prose and asks for JSON. Rendering that prose
 * *from the tool definitions* rather than writing it by hand is the whole
 * point — otherwise the two backends drift apart the first time a field is
 * added and only one of them learns about it.
 */

export function nowLine(): string {
  const timeZone = householdTimezone();
  const formatted = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  return `Right now it is ${formatted} (${timeZone}).`;
}

export function household(context: Context): string {
  const others = context.profiles
    .filter((profile) => profile.id !== context.capturedBy.id)
    .map((profile) => profile.name);
  const recipes = context.recipes.length
    ? context.recipes.map((name) => `  - ${name}`).join("\n")
    : "  (the recipe library is empty)";

  return [
    `The household is ${context.profiles.map((p) => p.name).join(" and ")}.`,
    `This capture is from ${context.capturedBy.name}${
      others.length ? `; the other person is ${others.join(", ")}` : ""
    }.`,
    "",
    `Shopping categories, use exactly these: ${CATEGORIES.join(", ")}.`,
    "",
    "Recipes already in the library:",
    recipes,
  ].join("\n");
}

export const SHARED_RULES = `
Rules that matter more than anything else:

- Do the obvious thing. If someone plainly states an item, a date or a task,
  record it at high confidence and move on. This app is used one-handed while
  holding a baby; a confirmation prompt for the milk is a failure, not caution.
- Only drop below high confidence when a wrong guess would put a wrong thing in
  the calendar or the list: an ambiguous date ("next Friday" when today is
  Friday), an amount you had to read through a crease, two plausible readings
  of who or what was meant. Say what you were unsure about in
  confidence_reason.
- One capture can be several actions. "We're out of nappies and Tom's got
  swimming Thursday at four" is a shopping item and a calendar event. Emit both.
- Batch shopping items into a single add_shopping_items action.
`.trim();

export const SPEECH_RULES = `
This text is a raw speech transcript. Expect it to be messy and read it the way
a person would:

- Ignore fillers: um, uh, like, you know, sort of.
- Honour self-corrections — the last statement wins. "Get milk, no, oat milk"
  means oat milk, and only oat milk. "Tuesday, sorry, Wednesday" means Wednesday.
- Transcription mangles names and nouns. Repair the obvious ones from context
  ("by nappies" is buy nappies; "wheat bicks" is Weet-Bix) and drop confidence
  when a repair changes the meaning rather than the spelling.
- Speech has no punctuation. Split run-on sentences into separate actions.
- Strip meta-talk ("add to the list", "put in the calendar", "remind me") from
  the thing itself: "add bananas to the shopping list" is an item called
  bananas, not "add bananas to the shopping list".
`.trim();

export const PHOTO_RULES = `
This is a photo of a real document, taken in a hurry — a school flyer, an
invoice, a handwritten note on the fridge, a recipe card, a screenshot.

- Read what is actually there, including handwriting, and prefer the printed
  date over one you infer.
- A flyer with a dated event is a calendar event. An invoice is an expense
  note, and a reminder if it has a due date. A recipe card is a recipe. A
  scrawled list is shopping items.
- Where the crop, the glare or the handwriting leaves you unsure of a date, a
  dollar amount or a quantity, extract it anyway at medium confidence and name
  the doubt — a parked item someone can fix beats a silent miss.
- Ignore decoration, logos and boilerplate.
`.trim();

export const EMAIL_RULES = `
Actionable: school notices with dates, appointment confirmations and reminders,
bills and invoices with due dates, event invitations, delivery windows,
tradesperson bookings, quotes for the renovation.

Not actionable: marketing, newsletters, receipts for things already paid with
nothing to do, notifications, statements, anything where the household has no
action. Use no_action for these — most email is this, and a note about a sale
is worse than silence.

An email naming a specific date and time for something a person here could go
to is never no_action, however casually it is written. A friend writing
"drinks Friday from 6:30 at the Grand" is an invitation, not chatter:
chatter is talk with no commitment in it. The same goes for a message to
themselves — people mail themselves the things they are trying not to forget.

When you are unsure they want it, propose it at low confidence rather than
dropping it. It waits in the approval queue, where a wrong guess costs one
tap. A silent miss costs them the evening, and they never learn it happened.

Extra care here, because nobody spoke this out loud:
- Use high confidence only when the email states the date, time and subject
  plainly. A "term 3 concert" with no date is medium at best.
- Never invent a time for an event that only gives a day.
- A bill becomes a reminder on its due date, not a calendar event.
- Do not add shopping items from advertising, ever.
`.trim();

function renderProperty(name: string, schema: any, required: boolean): string {
  const parts: string[] = [];
  if (schema.enum) parts.push(`one of: ${schema.enum.join(" | ")}`);
  else if (schema.type === "array") parts.push("array");
  else if (schema.type) parts.push(schema.type);
  if (!required) parts.push("optional");

  const description = String(schema.description ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const head = `    - ${name} (${parts.join(", ")})`;
  return description ? `${head}: ${description}` : head;
}

/**
 * The tool list as prose, generated from the tool definitions themselves.
 * Any field added to `HOUSEHOLD_TOOLS` shows up here without being retyped.
 */
export function describeTools(tools: Anthropic.Tool[] = HOUSEHOLD_TOOLS): string {
  const blocks = tools.map((tool) => {
    const schema = tool.input_schema as any;
    const required: string[] = schema.required ?? [];
    const lines = [
      `  "${tool.name}" — ${String(tool.description ?? "").replace(/\s+/g, " ").trim()}`,
    ];

    for (const [name, property] of Object.entries<any>(schema.properties ?? {})) {
      lines.push(renderProperty(name, property, required.includes(name)));
      // One level of nesting is all these schemas use, and it is where the
      // shopping items and recipe ingredients live.
      const nested = property.items?.properties;
      if (nested) {
        const nestedRequired: string[] = property.items.required ?? [];
        for (const [child, childSchema] of Object.entries<any>(nested)) {
          lines.push(
            `      · ${renderProperty(child, childSchema, nestedRequired.includes(child)).trim().slice(2)}`,
          );
        }
      }
    }
    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

/** The output contract for a backend that cannot be handed a JSON Schema. */
export function jsonContract(): string {
  return [
    "Reply with a single JSON object and nothing else. No prose before or",
    "after it, no markdown fence, no explanation.",
    "",
    "{",
    '  "reply": "one short sentence for the person, or an empty string",',
    '  "actions": [',
    '    { "action": "<one of the action names below>", ...its fields }',
    "  ]",
    "}",
    "",
    "Use an empty actions array only when nothing at all should be recorded;",
    'prefer an explicit { "action": "no_action", "reason": "..." }.',
    "",
    "The actions, and the fields each one takes:",
    "",
    describeTools(),
  ].join("\n");
}

export function captureSystem(input: {
  image: boolean;
  kind: "voice" | "photo" | "text";
  context: Context;
}): string {
  return [
    "You are the parsing layer of a two-person household coordination app.",
    "You turn what someone said or photographed into concrete entries in their",
    "calendar, shopping list, reminders, recipes and notes.",
    "",
    nowLine(),
    "",
    household(input.context),
    "",
    SHARED_RULES,
    "",
    input.image ? PHOTO_RULES : input.kind === "voice" ? SPEECH_RULES : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function emailSystem(context: Context): string {
  return [
    "You are the mailbox scanner of a two-person household coordination app.",
    "You read one email and decide whether it contains something this household",
    "needs in their calendar, reminders, shopping list or notes.",
    "",
    nowLine(),
    "",
    household(context),
    "",
    EMAIL_RULES,
    "",
    SHARED_RULES,
  ].join("\n");
}

export function captureUserText(input: {
  text?: string | null;
  image: boolean;
  kind: "voice" | "photo" | "text";
}): string {
  if (input.image) {
    return input.text?.trim()
      ? `Photo, with this said alongside it: "${input.text.trim()}"`
      : "Photo captured with no spoken context. Work out what it is and record it.";
  }
  return input.kind === "voice"
    ? `Transcript: "${input.text ?? ""}"`
    : `Typed: "${input.text ?? ""}"`;
}

export function emailUserText(input: {
  mailbox: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
}): string {
  return (
    `Mailbox: ${input.mailbox}\n` +
    `From: ${input.from}\n` +
    `Subject: ${input.subject}\n` +
    `Received: ${input.receivedAt}\n\n` +
    input.body
  );
}
