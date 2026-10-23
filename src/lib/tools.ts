import type Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "./types.ts";

const CONFIDENCE = {
  confidence: {
    type: "string" as const,
    enum: ["high", "medium", "low"],
    description:
      "high = the input plainly says this and you had to guess nothing " +
      "important. medium/low = you inferred a date, a name, an amount, or " +
      "which of several readings was meant. Anything below high is held for " +
      "a human to approve, so do not hedge out of politeness — hedge only " +
      "when a wrong guess would put a wrong thing in the calendar or list.",
  },
  confidence_reason: {
    type: "string" as const,
    description:
      "Only when confidence is not high: the one thing you were unsure of, " +
      "in a short phrase. Shown to the person approving it.",
  },
};

const INGREDIENT = {
  type: "object" as const,
  properties: {
    name: {
      type: "string",
      description: "Ingredient as you'd read it on a list, e.g. 'plain flour'.",
    },
    quantity: {
      type: "string",
      description: "Amount as a string, e.g. '2', '1.5', 'a couple'. Omit if unsaid.",
    },
    unit: {
      type: "string",
      description: "Unit, e.g. 'kg', 'g', 'ml', 'tbsp', 'cloves', 'bunch'.",
    },
    category: {
      type: "string",
      enum: [...CATEGORIES],
      description: "Aisle it lives in.",
    },
  },
  required: ["name", "category"],
};

/**
 * The one vocabulary shared by the capture flow and the mailbox scanner.
 *
 * Every tool carries its own `confidence`, which is what decides between
 * "just do it" and the Needs your OK queue. The queue is the exception: a
 * household coordination app that asks twice about the milk stops being used.
 */
export const HOUSEHOLD_TOOLS: Anthropic.Tool[] = [
  {
    name: "add_calendar_event",
    description:
      "Put something in the shared Google Calendar. Use for anything with a " +
      "date and a time, or a whole-day thing like a school free-dress day.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short event title." },
        start: {
          type: "string",
          description:
            "Local wall-clock start as 'YYYY-MM-DDTHH:MM', or 'YYYY-MM-DD' " +
            "for an all-day event. Never include a timezone or offset — the " +
            "app applies the household's own.",
        },
        end: {
          type: "string",
          description:
            "Same format as start. Omit and a sensible default is used " +
            "(one hour, or the same day for all-day events).",
        },
        all_day: { type: "boolean", description: "True for a whole-day event." },
        location: { type: "string" },
        notes: { type: "string", description: "Anything worth keeping, briefly." },
        for_profile: {
          type: "string",
          description:
            "Which household member's calendar this belongs on, by name. " +
            "Omit for anything shared or unclear — it lands on the " +
            "capturing person's calendar.",
        },
        ...CONFIDENCE,
      },
      required: ["title", "start", "confidence"],
    },
  },
  {
    name: "add_shopping_items",
    description:
      "Add one or more things to the shared shopping list. Batch everything " +
      "mentioned in one call rather than calling once per item.",
    input_schema: {
      type: "object",
      properties: {
        items: { type: "array", items: INGREDIENT, minItems: 1 },
        ...CONFIDENCE,
      },
      required: ["items", "confidence"],
    },
  },
  {
    name: "add_reminder",
    description:
      "A task or note-to-self with no fixed slot in the day. If it has a " +
      "time and a place, it's a calendar event instead.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_at: {
          type: "string",
          description:
            "Optional local wall clock 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD'.",
        },
        notes: { type: "string" },
        ...CONFIDENCE,
      },
      required: ["title", "confidence"],
    },
  },
  {
    name: "add_recipe",
    description:
      "Save a recipe to the library — typically from a photo of a recipe " +
      "card, a cookbook page, or a screenshot.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        servings: { type: "string", description: "e.g. 'serves 4'." },
        ingredients: { type: "array", items: INGREDIENT, minItems: 1 },
        instructions: {
          type: "string",
          description: "Method, as readable steps. Omit if not legible.",
        },
        source: { type: "string", description: "Book, site or person it came from." },
        ...CONFIDENCE,
      },
      required: ["name", "ingredients", "confidence"],
    },
  },
  {
    name: "add_recipe_to_shopping_list",
    description:
      "Push every ingredient of a recipe already in the library onto the " +
      "shopping list. Only use when the name clearly matches one of the " +
      "recipes listed in the context.",
    input_schema: {
      type: "object",
      properties: {
        recipe_name: {
          type: "string",
          description: "Name exactly as it appears in the library listing.",
        },
        ...CONFIDENCE,
      },
      required: ["recipe_name", "confidence"],
    },
  },
  {
    name: "log_note",
    description:
      "Keep something that isn't a task, a date or a shopping item — a " +
      "phone number, a school policy, a measurement, a thought.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label." },
        body: { type: "string", description: "The note itself, cleaned up." },
        ...CONFIDENCE,
      },
      required: ["body", "confidence"],
    },
  },
  {
    name: "log_expense_note",
    description:
      "Record a spend worth remembering next to the budget — especially " +
      "renovation costs, quotes and invoices. This does not move money; " +
      "Pocketsmith remains the record of what was actually spent.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        amount: { type: "number", description: "Numeric amount, no symbols." },
        currency: { type: "string", description: "ISO code. Defaults to AUD." },
        category: {
          type: "string",
          description: "e.g. 'Renovation', 'Car', 'School'.",
        },
        occurred_on: { type: "string", description: "'YYYY-MM-DD' if known." },
        ...CONFIDENCE,
      },
      required: ["description", "confidence"],
    },
  },
  {
    name: "no_action",
    description:
      "Nothing in this input asks for anything to be recorded. Use this " +
      "rather than inventing a note.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One short line for the person." },
      },
      required: ["reason"],
    },
  },
];

export const TOOL_NAMES = HOUSEHOLD_TOOLS.map((tool) => tool.name);

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}
