"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Profile, Reminder } from "@/lib/types";

/** The day part of an instant, in the household's zone rather than the server's. */
function dayKey(iso: string | null, timeZone: string): string {
  const when = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Number.isNaN(when.getTime()) ? new Date() : when);
}

/**
 * Put a to-do on a calendar.
 *
 * Defaulted rather than blank: the due date if it has one, today if not, and
 * all day unless a time is typed. A job is not a meeting -- "call the plumber"
 * is not nine to ten -- so the time is the option and the whole day is the
 * default, which is also the only one of the two that can be filled in with no
 * typing at all.
 */
export default function ScheduleReminder({
  reminder,
  profiles,
  profileId,
  timeZone,
  onClose,
  onAdded,
}: {
  reminder: Reminder;
  profiles: Profile[];
  profileId: string;
  timeZone: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [date, setDate] = useState(() => dayKey(reminder.dueAt, timeZone));
  const [time, setTime] = useState("");
  // Whose calendar. Whoever is at the screen, not whoever added the reminder:
  // the person standing here is the one choosing.
  const [whose, setWhose] = useState(profileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/reminders/${reminder.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ date, time: time || null, forProfile: whose }),
        profileId,
      });
      onAdded();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet__card" onClick={(click) => click.stopPropagation()}>
        <header className="sheet__head">
          <span />
          <div>
            <h2 className="sheet__title">{reminder.title}</h2>
            <p className="sheet__when">
              Put it on a calendar. It stays on the list either way.
            </p>
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="schedule">
          <label className="schedule__field">
            <span className="schedule__label">When</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="schedule__field">
            <span className="schedule__label">Time (optional)</span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        {profiles.length > 1 ? (
          <div className="tabs" role="tablist">
            {profiles.map((person) => (
              <button
                key={person.id}
                className="tab"
                role="tab"
                aria-selected={whose === person.id}
                onClick={() => setWhose(person.id)}
                disabled={busy}
              >
                {person.name}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className="banner">{error}</div> : null}

        <div className="sheet__actions">
          <button className="btn btn--primary" onClick={() => void add()} disabled={busy || !date}>
            {busy ? "Adding…" : time ? `Add at ${time}` : "Add for the day"}
          </button>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
