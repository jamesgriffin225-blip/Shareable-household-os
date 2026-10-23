import { getState, setState } from "./db.ts";
import type {
  CategoryReport,
  MoneyAccount,
  MoneyBudgetRow,
  MoneySnapshot,
} from "./types.ts";

const BASE = "https://api.pocketsmith.com/v2";
const CACHE_KEY = "pocketsmith:snapshot";
const CACHE_MS = 15 * 60 * 1000;
/** 100 a page; ten pages is a very busy month and a hard stop on a runaway. */
const MAX_PAGES = 10;

export function pocketsmithConfigured(): boolean {
  return Boolean(process.env.POCKETSMITH_API_KEY);
}

export interface AccountChoice {
  id: number;
  label: string;
}

/**
 * Which accounts the tile shows, and what to call them.
 *
 * By id, not by name, and that is not fussiness: this household has two
 * accounts whose titles both begin "Personal Account" and two that are credit
 * cards. A name match would pick one of each pair and look right while being
 * wrong, which is the worst kind of wrong for a number on a wall.
 *
 * `POCKETSMITH_ACCOUNTS=5388380=Bills & Mortgage,5388405=Spending`
 * Order is preserved. Labels may not contain a comma.
 */
export function parseAccountChoices(raw: string | undefined): AccountChoice[] {
  return (raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const split = entry.indexOf("=");
      if (split < 1) return null;
      const id = Number(entry.slice(0, split).trim());
      const label = entry.slice(split + 1).trim();
      if (!Number.isInteger(id) || id <= 0 || !label) return null;
      return { id, label };
    })
    .filter((choice): choice is AccountChoice => choice !== null);
}

interface Page {
  body: any;
  next: string | null;
}

async function apiPage(path: string): Promise<Page> {
  const key = process.env.POCKETSMITH_API_KEY;
  if (!key) throw new Error("POCKETSMITH_API_KEY is not set");
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    headers: { "X-Developer-Key": key, accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Pocketsmith ${response.status} on ${path.split("?")[0]}`);
  }
  // Pagination is in a Link header, RFC 5988 style: <url>; rel="next".
  const link = response.headers.get("link") || "";
  const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
  return { body: await response.json(), next };
}

async function api(path: string): Promise<any> {
  return (await apiPage(path)).body;
}

async function apiAll(path: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = path;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const result: Page = await apiPage(url);
    if (Array.isArray(result.body)) out.push(...result.body);
    url = result.next;
  }
  return out;
}

/**
 * Pocketsmith's budget rows nest their figures a level or two down and have
 * shifted key names over the life of the API. Read the shapes we know about
 * and fall back to zero rather than showing a wrong number confidently.
 */
function readAmount(source: any, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

export function readBudgetRows(raw: any[]): MoneyBudgetRow[] {
  return raw
    .map((entry): MoneyBudgetRow | null => {
      const period = entry?.current_period ?? entry?.currentPeriod ?? entry;
      const expenses = period?.expenses ?? {};
      const spent = Math.abs(
        readAmount(expenses, "actual_amount", "actualAmount", "actual") ?? 0,
      );
      const budgeted = readAmount(
        expenses,
        "budget_amount",
        "budgetAmount",
        "budgeted",
      );
      const name = entry?.category?.title ?? entry?.category_title ?? "Uncategorised";
      const start = period?.start_date ?? period?.startDate ?? "";
      const end = period?.end_date ?? period?.endDate ?? "";
      if (!name) return null;
      return {
        name,
        spent,
        budgeted: budgeted === null ? null : Math.abs(budgeted),
        periodLabel: start && end ? `${start} → ${end}` : "current period",
      };
    })
    .filter((row): row is MoneyBudgetRow => row !== null);
}

export interface RawTransaction {
  amount?: unknown;
  is_transfer?: unknown;
  category?: { title?: unknown } | null;
}

/**
 * Spending by category over a range.
 *
 * Transfers are dropped. Moving three thousand dollars from Spending to the
 * offset account is not three thousand dollars of spending, and leaving them
 * in makes the biggest "category" on the page an illusion.
 *
 * Income is dropped too: this answers "where did it go", and a salary credit
 * sitting at the top of a spending list answers nothing.
 */
export function groupByCategory(
  transactions: RawTransaction[],
): Array<{ name: string; spent: number }> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction?.is_transfer === true) continue;
    const amount = Number(transaction?.amount ?? 0);
    if (!Number.isFinite(amount) || amount >= 0) continue;
    const title = transaction?.category?.title;
    const name =
      typeof title === "string" && title.trim() ? title.trim() : "Uncategorised";
    totals.set(name, (totals.get(name) ?? 0) + Math.abs(amount));
  }
  return [...totals]
    .map(([name, spent]) => ({ name, spent: Math.round(spent * 100) / 100 }))
    .sort((a, b) => b.spent - a.spent);
}

/**
 * When a balance was actually last written by the bank feed.
 *
 * Not `current_balance_date`, which is a DATE -- it said "2026-09-17" for a
 * figure the bank had last reported at 9:17 that morning, so a twelve-hour-old
 * balance and a live one were indistinguishable on the wall.
 *
 * The account's own `updated_at` is no use either: it moves when the account
 * record changes, and reads as a month ago on accounts that are syncing fine.
 * The feed writes to the transaction accounts underneath, so the newest stamp
 * among them is when this number last came from a bank.
 */
export function balanceWrittenAt(account: any): string | null {
  const stamps: string[] = (account?.transaction_accounts ?? [])
    .map((entry: any) => entry?.updated_at)
    .filter((value: unknown): value is string => typeof value === "string" && value !== "");
  if (stamps.length > 0) return stamps.reduce((a, b) => (a > b ? a : b));
  // An offline or manually-kept account has no feed under it; the date is the
  // only thing there is, and for those it is the honest answer.
  return account?.current_balance_date ? String(account.current_balance_date) : null;
}

function readAccounts(raw: any[], choices: AccountChoice[]): MoneyAccount[] {
  const byId = new Map<number, any>(raw.map((account) => [Number(account?.id), account]));
  return choices
    .map((choice): MoneyAccount | null => {
      const account = byId.get(choice.id);
      if (!account) return null;
      const balance = Number(account.current_balance ?? 0);
      const type = String(account.type ?? "bank");
      return {
        id: choice.id,
        label: choice.label,
        // What Pocketsmith calls it, kept so a renamed account is obvious.
        title: String(account.title ?? choice.label),
        type,
        // Credit cards and loans carry a negative balance for money owed;
        // saying "-$11,871" on a wall reads as an error, "owing" does not.
        owing: (type === "credits" || type === "loans") && balance < 0,
        balance,
        updatedAt: balanceWrittenAt(account),
      };
    })
    .filter((account): account is MoneyAccount => account !== null);
}

async function build(): Promise<MoneySnapshot> {
  const me = await api("/me");
  const userId = me.id;
  const currency = String(me.base_currency_code || "AUD").toUpperCase();

  const choices = parseAccountChoices(process.env.POCKETSMITH_ACCOUNTS);
  const rawAccounts = (await api(`/users/${userId}/accounts`)) as any[];

  const budgets = readBudgetRows(await api(`/users/${userId}/budget?roll_up=true`))
    .filter((row) => row.spent > 0 || (row.budgeted ?? 0) > 0)
    .sort((a, b) => (b.budgeted ?? 0) - (a.budgeted ?? 0) || b.spent - a.spent);

  const accounts = readAccounts(rawAccounts, choices);

  return {
    currency,
    accounts,
    budgets,
    periodLabel: budgets[0]?.periodLabel ?? "current period",
    // With nothing configured the tile can't guess, so it offers the list —
    // picking three ids off the wall beats digging through Pocketsmith.
    available: choices.length
      ? []
      : rawAccounts
          .map((account) => ({
            id: Number(account?.id),
            title: String(account?.title ?? "(untitled)"),
            type: String(account?.type ?? ""),
          }))
          .filter((account) => Number.isInteger(account.id)),
    refreshedAt: new Date().toISOString(),
    // The oldest of the figures on show. `refreshedAt` says when we last asked
    // Pocketsmith, which is always minutes ago and says nothing about whether
    // the banks have reported since -- they do that a few times a day.
    balancesAsAt: oldestStamp(accounts),
    stale: false,
  };
}

function oldestStamp(accounts: MoneyAccount[]): string | null {
  const stamps = accounts
    .map((account) => account.updatedAt)
    .filter((value): value is string => Boolean(value));
  return stamps.length > 0 ? stamps.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * The dashboard asks for this every few minutes and Pocketsmith is not a fast
 * API, so it is cached in Postgres — shared across every device. A failed
 * refresh serves the last good snapshot marked stale rather than blanking the
 * panel.
 */
export async function moneySnapshot(
  options: { force?: boolean } = {},
): Promise<MoneySnapshot | null> {
  if (!pocketsmithConfigured()) return null;

  const cached = await getState<MoneySnapshot>(CACHE_KEY);
  const fresh =
    cached && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_MS;
  if (cached && fresh && !options.force) return cached.value;

  try {
    const snapshot = await build();
    await setState(CACHE_KEY, snapshot);
    return snapshot;
  } catch (error) {
    console.error("[pocketsmith] refresh failed", error);
    if (cached) return { ...cached.value, stale: true };
    throw error;
  }
}

/**
 * Spending by category between two dates.
 *
 * Cached per range, because "this month" is asked for by every device every
 * time the tab is opened and the answer only moves when a transaction lands.
 */
export async function categoryReport(
  from: string,
  to: string,
): Promise<CategoryReport | null> {
  if (!pocketsmithConfigured()) return null;

  const key = `pocketsmith:categories:${from}:${to}`;
  const cached = await getState<CategoryReport>(key);
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_MS) {
    return cached.value;
  }

  const me = await api("/me");
  const transactions = await apiAll(
    `/users/${me.id}/transactions?` +
      new URLSearchParams({ start_date: from, end_date: to, per_page: "100" }),
  );

  const rows = groupByCategory(transactions as RawTransaction[]);
  const report: CategoryReport = {
    currency: String(me.base_currency_code || "AUD").toUpperCase(),
    from,
    to,
    total: Math.round(rows.reduce((sum, row) => sum + row.spent, 0) * 100) / 100,
    rows,
    // Ten pages is the ceiling; say so rather than quietly under-reporting.
    truncated: transactions.length >= MAX_PAGES * 100,
    refreshedAt: new Date().toISOString(),
  };
  await setState(key, report);
  return report;
}
