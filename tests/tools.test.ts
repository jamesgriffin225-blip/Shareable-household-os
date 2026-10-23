import assert from "node:assert/strict";
import { test } from "node:test";
import { HOUSEHOLD_TOOLS, TOOL_NAMES, isKnownTool } from "../src/lib/tools.ts";
import { CATEGORIES, normaliseCategory } from "../src/lib/types.ts";

test("every action tool requires a confidence, which is what gates the queue", () => {
  for (const tool of HOUSEHOLD_TOOLS) {
    if (tool.name === "no_action") continue;
    const schema = tool.input_schema as any;
    assert.ok(
      schema.properties.confidence,
      `${tool.name} has no confidence property`,
    );
    assert.ok(
      (schema.required as string[]).includes("confidence"),
      `${tool.name} does not require confidence`,
    );
    assert.deepEqual(schema.properties.confidence.enum, ["high", "medium", "low"]);
  }
});

test("the capture flow and the mailbox scanner share one vocabulary", () => {
  assert.ok(TOOL_NAMES.includes("add_calendar_event"));
  assert.ok(TOOL_NAMES.includes("add_shopping_items"));
  assert.ok(TOOL_NAMES.includes("no_action"));
  assert.equal(isKnownTool("add_reminder"), true);
  assert.equal(isKnownTool("drop_database"), false);
});

test("shopping categories offered to the model are the ones the UI groups by", () => {
  const shopping = HOUSEHOLD_TOOLS.find((tool) => tool.name === "add_shopping_items")!;
  const item = (shopping.input_schema as any).properties.items.items;
  assert.deepEqual(item.properties.category.enum, [...CATEGORIES]);
});

test("an unknown or missing category falls back rather than losing the item", () => {
  assert.equal(normaliseCategory("produce"), "Produce");
  assert.equal(normaliseCategory("  DAIRY "), "Dairy");
  assert.equal(normaliseCategory("Deli"), "Other");
  assert.equal(normaliseCategory(undefined), "Other");
  assert.equal(normaliseCategory(42), "Other");
});
