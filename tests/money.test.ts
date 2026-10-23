import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceWrittenAt,
  groupByCategory,
  parseAccountChoices,
} from "../src/lib/pocketsmith.ts";

test("account choices are read in order, by id", () => {
  assert.deepEqual(
    parseAccountChoices("5388380=Bills & Mortgage,5388405=Spending,5388395=Credit Card"),
    [
      { id: 5388380, label: "Bills & Mortgage" },
      { id: 5388405, label: "Spending" },
      { id: 5388395, label: "Credit Card" },
    ],
  );
});

test("whitespace and a trailing comma are forgiven", () => {
  assert.deepEqual(parseAccountChoices("  12 = Spending , "), [
    { id: 12, label: "Spending" },
  ]);
});

test("entries that are not an id and a label are dropped, not guessed at", () => {
  assert.deepEqual(parseAccountChoices("Spending,=Spending,12=,abc=Spending,0=No"), []);
  assert.deepEqual(parseAccountChoices(undefined), []);
  assert.deepEqual(parseAccountChoices(""), []);
});

test("a label may contain an equals sign", () => {
  assert.deepEqual(parseAccountChoices("7=Bills = Mortgage"), [
    { id: 7, label: "Bills = Mortgage" },
  ]);
});

test("category totals count spending only, biggest first", () => {
  const rows = groupByCategory([
    { amount: -50, category: { title: "Groceries" } },
    { amount: -25.5, category: { title: "Groceries" } },
    { amount: -100, category: { title: "Fuel" } },
    { amount: 2000, category: { title: "Salary" } },
  ]);
  assert.deepEqual(rows, [
    { name: "Fuel", spent: 100 },
    { name: "Groceries", spent: 75.5 },
  ]);
});

test("transfers are excluded — moving money is not spending it", () => {
  const rows = groupByCategory([
    { amount: -3000, is_transfer: true, category: { title: "Offset" } },
    { amount: -40, category: { title: "Groceries" } },
  ]);
  assert.deepEqual(rows, [{ name: "Groceries", spent: 40 }]);
});

test("an uncategorised transaction is named rather than dropped", () => {
  const rows = groupByCategory([
    { amount: -10, category: null },
    { amount: -5, category: { title: "   " } },
    { amount: -1 },
  ]);
  assert.deepEqual(rows, [{ name: "Uncategorised", spent: 16 }]);
});

test("rounding does not leave floating-point dust on a total", () => {
  const rows = groupByCategory([
    { amount: -0.1, category: { title: "Bits" } },
    { amount: -0.2, category: { title: "Bits" } },
  ]);
  assert.deepEqual(rows, [{ name: "Bits", spent: 0.3 }]);
});


/*
 * Shaped from this household's real Pocketsmith payload, on a day the tile
 * showed twelve-hour-old figures as if they were live. `current_balance_date`
 * said today; the bank had last reported at 09:17.
 */
const NAB_ACCOUNT = {
  id: 5388380,
  title: "Personal Account",
  type: "bank",
  current_balance: 4573.86,
  current_balance_date: "2026-09-17",
  // Moves when the account record changes, not when a balance arrives -- a
  // month old on an account that is syncing perfectly well.
  updated_at: "2026-08-18T03:10:26Z",
  transaction_accounts: [
    { id: 1, updated_at: "2026-09-16T23:17:36Z" },
    { id: 2, updated_at: "2026-09-16T23:10:02Z" },
  ],
};

test("a balance is dated by the feed that wrote it, not by the account record", () => {
  // The newest of the transaction accounts, not the account's own updated_at
  // (a month earlier) and not current_balance_date (which has no time in it).
  assert.equal(balanceWrittenAt(NAB_ACCOUNT), "2026-09-16T23:17:36Z");
});

test("an account with no feed under it falls back to the date it has", () => {
  assert.equal(
    balanceWrittenAt({ current_balance_date: "2026-09-01", transaction_accounts: [] }),
    "2026-09-01",
  );
  assert.equal(balanceWrittenAt({}), null);
});

test("a half-populated feed does not lose the stamp that is there", () => {
  assert.equal(
    balanceWrittenAt({
      current_balance_date: "2026-09-17",
      transaction_accounts: [{ id: 1 }, { id: 2, updated_at: "2026-09-16T23:17:36Z" }],
    }),
    "2026-09-16T23:17:36Z",
  );
});
