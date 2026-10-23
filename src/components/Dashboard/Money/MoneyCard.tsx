"use client";

import { useEffect, useMemo, useState } from "react";
import { useCategories } from "@/lib/client/api";
import type { MoneySnapshot } from "@/lib/types";
import {
  addDayKeys,
  endOfMonthKey,
  periodLabel,
  shiftPeriod,
  startOfMonthKey,
  startOfWeekKey,
} from "../calendar-range";
import Eye from "./Eye";
import { money } from "./money-format";

type Tab = "accounts" | "budgets" | "categories";

/**
 * "as at 9:17 am" -- worded as a fact rather than a warning.
 *
 * This is how bank feeds work and nothing is wrong when it says four hours;
 * the tile only needs to stop implying the number is from this second. Under
 * an hour it says nothing at all, because then it effectively is.
 *
 * It rides on the line each account already has, because the tile has no room
 * to spare. A line added under the accounts is clipped at every width the wall
 * runs at; put in the header it wraps the tab strip, which costs forty pixels
 * and clips the third account -- the exact complaint this tile was rebuilt to
 * fix. Per account is also the truer answer: these banks are on different
 * schedules, and on a normal day they are four hours apart.
 */
function describeAsAt(iso: string | null): { short: string; full: string } | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const hours = (Date.now() - when.getTime()) / 3_600_000;
  if (hours < 1) return null;

  if (hours > 48) {
    const days = Math.round(hours / 24);
    return {
      short: `${days}d ago`,
      full: `This bank last reported ${days} days ago`,
    };
  }
  // en-AU like the rest of the dashboard: "9:17 am", not the browser's guess.
  const clock = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  }).format(when);
  return hours < 24
    ? { short: clock, full: `This bank last reported at ${clock}` }
    : {
        short: `${clock} yest.`,
        full: `This bank last reported at ${clock} yesterday`,
      };
}
type Period = "week" | "month" | "range";

/**
 * Figures go back into hiding on their own.
 *
 * The whole point is guests in the kitchen, and the failure mode is revealing
 * the mortgage and then walking off. A minute is long enough to read it.
 */
const REHIDE_AFTER_MS = 60_000;

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function MoneyCard({
  snapshot,
  configured,
  error,
  expanded,
}: {
  snapshot: MoneySnapshot | null;
  configured: boolean;
  error: string | null;
  expanded: boolean;
}) {
  const [tab, setTab] = useState<Tab>("accounts");

  const [revealed, setRevealed] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(todayKey);
  const [custom, setCustom] = useState(() => ({
    from: startOfMonthKey(todayKey()),
    to: todayKey(),
  }));

  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REHIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const range = useMemo(() => {
    if (period === "week") {
      const from = startOfWeekKey(anchor);
      return { from, to: addDayKeys(from, 6) };
    }
    if (period === "month") {
      return { from: startOfMonthKey(anchor), to: endOfMonthKey(anchor) };
    }
    return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }, [anchor, custom, period]);

  // Only asked for while the tab is open — it is the one call here that walks
  // every transaction in the range.
  const categories = useCategories(tab === "categories" ? range : null);

  const hidden = !revealed;
  const currency = snapshot?.currency ?? categories.report?.currency ?? "AUD";
  const amount = (value: number, cents = false) =>
    money(value, currency, { hidden, cents });

  const body = () => {
    if (!configured) {
      return <p className="empty">Set POCKETSMITH_API_KEY to show the money here.</p>;
    }
    if (!snapshot && error) {
      // Spinning forever is a lie. Say what broke.
      return <div className="banner">Pocketsmith: {error}</div>;
    }
    if (!snapshot) {
      return (
        <p className="empty">
          <span className="spinner" /> Fetching…
        </p>
      );
    }

    if (tab === "accounts") {
      if (snapshot.accounts.length === 0) {
        return (
          <div>
            <p className="empty" style={{ paddingTop: 0 }}>
              No accounts chosen yet. Put this in <code>.env.local</code>, with the
              ids you want:
            </p>
            <p className="money__hint">POCKETSMITH_ACCOUNTS=id=Label,id=Label</p>
            <div className="money__ids">
              {snapshot.available.map((account) => (
                <div className="budget__row" key={account.id}>
                  <span>
                    {account.title}
                    <span className="recipe__meta"> · {account.type}</span>
                  </span>
                  <span className="money__id">{account.id}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }
      return (
        <>
          <div className="money__accounts">
            {snapshot.accounts.map((account) => (
              <div className="money__account" key={account.id}>
                <span className="money__label">{account.label}</span>
                <span className={`money__balance${account.owing ? " money__balance--owing" : ""}`}>
                  {amount(Math.abs(account.balance), true)}
                </span>
                <span className="money__sub">
                  {account.owing ? "owing" : "available"}
                  {account.title === account.label ? "" : ` · ${account.title}`}
                  {describeAsAt(account.updatedAt) ? (
                    <span className="money__asat" title={describeAsAt(account.updatedAt)!.full}>
                      {" · "}
                      {describeAsAt(account.updatedAt)!.short}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (tab === "budgets") {
      if (snapshot.budgets.length === 0) {
        return (
          <p className="empty">
            No budgets in Pocketsmith yet. Add them there and they show up here.
          </p>
        );
      }
      return (
        <div>
          {snapshot.budgets.map((row) => (
            <div className="budget__row" key={row.name}>
              <span>
                {row.name}
                {row.budgeted ? (
                  <div className="bar" style={{ maxWidth: 180 }}>
                    <div
                      className={`bar__fill${row.spent > row.budgeted ? " bar__fill--over" : ""}`}
                      style={{
                        width: `${Math.min(100, (row.spent / row.budgeted) * 100)}%`,
                      }}
                    />
                  </div>
                ) : null}
              </span>
              <span>
                {amount(row.spent)}
                {row.budgeted ? ` / ${amount(row.budgeted)}` : ""}
              </span>
            </div>
          ))}
        </div>
      );
    }

    const report = categories.report;
    const top = report?.rows.slice(0, expanded ? 40 : 8) ?? [];
    const biggest = top[0]?.spent ?? 0;

    return (
      <div>
        <div className="money__period">
          <div className="tabs" role="tablist">
            {(["week", "month", "range"] as Period[]).map((option) => (
              <button
                key={option}
                className="tab"
                role="tab"
                aria-selected={period === option}
                onClick={() => setPeriod(option)}
              >
                {option === "range" ? "Dates" : option === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>

          {period === "range" ? (
            <div className="money__dates">
              <input
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, from: event.target.value }))
                }
              />
              <span className="recipe__meta">to</span>
              <input
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, to: event.target.value }))
                }
              />
            </div>
          ) : (
            <div className="cal__nav">
              <button
                className="btn btn--quiet"
                onClick={() => setAnchor(shiftPeriod(period, anchor, -1))}
                aria-label="Previous"
              >
                ‹
              </button>
              <span className="money__range">{periodLabel(period, anchor)}</span>
              <button
                className="btn btn--quiet"
                onClick={() => setAnchor(shiftPeriod(period, anchor, 1))}
                aria-label="Next"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {categories.error ? (
          <div className="banner">Pocketsmith: {categories.error}</div>
        ) : categories.loading && !report ? (
          <p className="empty">
            <span className="spinner" /> Adding it up…
          </p>
        ) : !report || report.rows.length === 0 ? (
          <p className="empty">Nothing spent in this range.</p>
        ) : (
          <>
            <div className="budget__row money__total">
              <span>Total spent</span>
              <span>{amount(report.total)}</span>
            </div>
            {top.map((row) => (
              <div className="budget__row" key={row.name}>
                <span>
                  {row.name}
                  <div className="bar" style={{ maxWidth: 180 }}>
                    <div
                      className="bar__fill"
                      style={{
                        width: `${biggest ? Math.max(3, (row.spent / biggest) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </span>
                <span>{amount(row.spent)}</span>
              </div>
            ))}
            {report.truncated ? (
              <p className="recipe__meta">
                Only the first thousand transactions in this range were counted.
              </p>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <div className="tabs" role="tablist">
          {(["accounts", "budgets", "categories"] as Tab[]).map((option) => (
            <button
              key={option}
              className="tab"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
            >
              {option === "accounts"
                ? "Accounts"
                : option === "budgets"
                  ? "Budgets"
                  : "Categories"}
            </button>
          ))}
        </div>
        <div className="money__head-right">
          {snapshot?.stale ? <span className="panel__meta">last good figures</span> : null}
          <button
            className="btn btn--quiet money__eye"
            onClick={() => setRevealed((current) => !current)}
            aria-pressed={revealed}
            title={revealed ? "Hide the figures" : "Show the figures"}
            aria-label={revealed ? "Hide the figures" : "Show the figures"}
          >
            <Eye open={revealed} />
          </button>
        </div>
      </header>
      <div className="panel__body">{body()}</div>
    </section>
  );
}
