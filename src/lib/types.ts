export const CATEGORIES = [
  "Produce",
  "Meat & Seafood",
  "Dairy",
  "Bakery",
  "Pantry",
  "Frozen",
  "Drinks",
  "Household",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function normaliseCategory(value: unknown): Category {
  if (typeof value !== "string") return "Other";
  const match = CATEGORIES.find(
    (category) => category.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? "Other";
}

/** Where a change came from. Drives the icon in the activity feed. */
export type Source = "manual" | "voice" | "photo" | "text" | "email" | "recipe";

export type Confidence = "high" | "medium" | "low";

export interface Profile {
  id: string;
  name: string;
  color: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  category: Category;
  note: string | null;
  recipeId: string | null;
  recipeName: string | null;
  addedBy: string | null;
  source: Source;
  checkedAt: string | null;
  createdAt: string;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  category: Category;
}

export interface Recipe {
  id: string;
  name: string;
  servings: string | null;
  instructions: string | null;
  source: string | null;
  addedBy: string | null;
  createdAt: string;
  ingredients: RecipeIngredient[];
}

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  doneAt: string | null;
  addedBy: string | null;
  source: Source;
  createdAt: string;
}

export interface Approval {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
  reason: string | null;
  confidence: Confidence | null;
  source: Source;
  sourceRef: Record<string, unknown> | null;
  profileId: string | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: number;
  action: string;
  summary: string;
  profileId: string | null;
  source: Source;
  entityType: string | null;
  entityId: string | null;
  undoable: boolean;
  undoneAt: string | null;
  createdAt: string;
}

export interface Photo {
  id: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  addedBy: string | null;
  createdAt: string;
}

/**
 * What the wall shows when nobody has touched it.
 *
 * Shared state, not per-device: the point of picking a photo from the sofa on
 * your phone is that it appears on the wall.
 */
export interface FrameSettings {
  enabled: boolean;
  /** Empty means the whole library. */
  selected: string[];
  mode: "single" | "slideshow";
  intervalSeconds: number;
  idleSeconds: number;
  showClock: boolean;
  /**
   * How the living-room TV (the tv-home repo) shows portrait photos: cropped to
   * fill its wide screen, or two portraits side by side, which fills it with
   * nothing cut off. Only the TV reads this; the wall letterboxes over a blurred
   * copy either way. Here rather than on the TV so it is chosen from a phone.
   */
  tvPortraits: "fill" | "pair";
}

export const DEFAULT_FRAME: FrameSettings = {
  enabled: true,
  selected: [],
  mode: "slideshow",
  intervalSeconds: 12,
  idleSeconds: 180,
  showClock: true,
  tvPortraits: "fill",
};

export function normaliseFrame(value: unknown): FrameSettings {
  const raw = (value ?? {}) as Partial<FrameSettings>;
  const clamp = (input: unknown, min: number, max: number, fallback: number) => {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  };
  return {
    enabled: raw.enabled !== false,
    selected: Array.isArray(raw.selected) ? raw.selected.map(String) : [],
    mode: raw.mode === "single" ? "single" : "slideshow",
    intervalSeconds: clamp(raw.intervalSeconds, 3, 600, DEFAULT_FRAME.intervalSeconds),
    // Below about half a minute the dashboard would vanish while you are still
    // reading it; above an hour it would never come on.
    idleSeconds: clamp(raw.idleSeconds, 30, 3600, DEFAULT_FRAME.idleSeconds),
    showClock: raw.showClock !== false,
    tvPortraits: raw.tvPortraits === "pair" ? "pair" : "fill",
  };
}

export interface CalendarEvent {
  id: string;
  profileId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  htmlLink: string | null;
}

export interface MoneyAccount {
  id: number;
  /** What the household calls it, from POCKETSMITH_ACCOUNTS. */
  label: string;
  /** What Pocketsmith calls it, so a renamed account is visible. */
  title: string;
  type: string;
  /** A credit card or loan in the red: show the figure as money owed. */
  owing: boolean;
  balance: number;
  updatedAt: string | null;
}

export interface MoneyBudgetRow {
  name: string;
  spent: number;
  budgeted: number | null;
  periodLabel: string;
}

export interface MoneySnapshot {
  currency: string;
  accounts: MoneyAccount[];
  budgets: MoneyBudgetRow[];
  periodLabel: string;
  /** Every account, offered only when none have been chosen yet. */
  available: Array<{ id: number; title: string; type: string }>;
  refreshedAt: string;
  /** When the oldest figure on show was last written by a bank feed. */
  balancesAsAt: string | null;
  stale: boolean;
}

export interface CategoryReport {
  currency: string;
  from: string;
  to: string;
  total: number;
  rows: Array<{ name: string; spent: number }>;
  truncated: boolean;
  refreshedAt: string;
}

/** Payload of GET /api/state — everything the dashboard polls for. */
export interface HouseholdState {
  profiles: Profile[];
  shopping: ShoppingItem[];
  recipes: Recipe[];
  reminders: Reminder[];
  approvals: Approval[];
  activity: ActivityEntry[];
  photos: Photo[];
  frame: FrameSettings;
  revision: string;
}
