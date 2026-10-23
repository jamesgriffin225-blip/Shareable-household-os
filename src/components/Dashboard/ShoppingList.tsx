"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { CATEGORIES, type Profile, type ShoppingItem } from "@/lib/types";

/** How long a ticked item lingers, with an undo, before it goes. */
const LINGER_MS = 5000;

export default function ShoppingList({
  items,
  profiles,
  profileId,
  onChanged,
}: {
  items: ShoppingItem[];
  profiles: Profile[];
  profileId: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Drives the countdown on lingering items, and only ticks while something is
  // actually counting down — this panel is on a wall all day.
  const anyChecked = items.some((item) => item.checkedAt) || Object.keys(pendingIds).length > 0;
  useEffect(() => {
    if (!anyChecked) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(timer);
  }, [anyChecked]);

  const setChecked = async (item: ShoppingItem, checked: boolean) => {
    setPendingIds((current) => {
      const next = { ...current };
      if (checked) next[item.id] = Date.now();
      else delete next[item.id];
      return next;
    });
    try {
      await api(`/api/shopping/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checked }),
        profileId,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPendingIds((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await api("/api/shopping", {
        method: "POST",
        body: JSON.stringify({ name }),
        profileId,
      });
      setDraft("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(false);
    }
  };

  const visible = items.filter((item) => {
    const checkedAt = pendingIds[item.id] ?? (item.checkedAt ? Date.parse(item.checkedAt) : null);
    return checkedAt === null || now - checkedAt < LINGER_MS;
  });

  const grouped = CATEGORIES.map((category) => ({
    category,
    items: visible.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  const whoOf = (id: string | null) =>
    profiles.find((profile) => profile.id === id) ?? null;

  return (
    <>
      <form className="adder" onSubmit={add}>
        <input
          className="field"
          placeholder="Add something…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={adding}
        />
        <button className="btn btn--primary" disabled={adding || !draft.trim()}>
          {adding ? <span className="spinner" /> : "Add"}
        </button>
      </form>

      {error ? <div className="banner">{error}</div> : null}

      {grouped.length === 0 ? (
        <p className="empty">Nothing on the list. Enjoy it.</p>
      ) : (
        grouped.map((group) => (
          <div className="aisle" key={group.category}>
            <h3 className="aisle__name">{group.category}</h3>
            {group.items.map((item) => {
              const checkedAt =
                pendingIds[item.id] ?? (item.checkedAt ? Date.parse(item.checkedAt) : null);
              const done = checkedAt !== null;
              const who = whoOf(item.addedBy);
              return (
                <div className={`item${done ? " item--done" : ""}`} key={item.id}>
                  <button
                    className="check"
                    onClick={() => void setChecked(item, !done)}
                    aria-label={done ? `Put ${item.name} back` : `Tick off ${item.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <path
                        d="M2 7.5 5.5 11 12 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  <div>
                    <div className="item__name">
                      {item.quantity || item.unit ? (
                        <span className="item__qty">
                          {[item.quantity, item.unit].filter(Boolean).join(" ")}{" "}
                        </span>
                      ) : null}
                      {item.name}
                    </div>
                    {item.recipeName || item.source === "email" ? (
                      <div className="item__from">
                        {item.recipeName ? `for ${item.recipeName}` : "from email"}
                      </div>
                    ) : null}
                  </div>

                  <div className="item__trail">
                    {/* Who added it, as a dot — the name on every row is more
                        noise than answer on a list this long. */}
                    {who ? (
                      <span
                        className="item__who"
                        title={`added by ${who.name}`}
                        style={{ background: who.color }}
                      />
                    ) : null}
                    {done ? (
                      <button
                        className="item__undo"
                        onClick={() => void setChecked(item, false)}
                      >
                        Undo {Math.max(1, Math.ceil((LINGER_MS - (now - checkedAt!)) / 1000))}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
