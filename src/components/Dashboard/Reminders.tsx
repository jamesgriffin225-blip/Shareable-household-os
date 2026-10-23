"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import ScheduleReminder from "./ScheduleReminder";
import type { Profile, Reminder } from "@/lib/types";

function due(iso: string | null, timeZone: string): { label: string; late: boolean } | null {
  if (!iso) return null;
  const when = new Date(iso);
  const midnightTomorrow = new Date();
  midnightTomorrow.setHours(24, 0, 0, 0);
  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(when);
  return { label, late: when.getTime() < Date.now() };
}

export default function Reminders({
  reminders,
  profiles,
  profileId,
  timeZone,
  onChanged,
}: {
  reminders: Reminder[];
  profiles: Profile[];
  profileId: string;
  timeZone: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Reminder | null>(null);

  const setDone = async (reminder: Reminder, done: boolean) => {
    setBusy(reminder.id);
    try {
      await api(`/api/reminders/${reminder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done }),
        profileId,
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  /*
   * Gone for good, with no confirmation step.
   *
   * Deliberately: a to-do is not a calendar event, and a second press on every
   * tap would make clearing a finished list tedious enough that nobody would.
   * The safety net is the activity feed instead -- the removal is logged with
   * an undo, so "Lately" can put it back.
   */
  const remove = async (reminder: Reminder) => {
    setBusy(reminder.id);
    try {
      await api(`/api/reminders/${reminder.id}`, { method: "DELETE", profileId });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (reminders.length === 0) {
    return <p className="empty">Nothing outstanding.</p>;
  }

  return (
    <>
      {scheduling ? (
        <ScheduleReminder
          reminder={scheduling}
          profiles={profiles}
          profileId={profileId}
          timeZone={timeZone}
          onClose={() => setScheduling(null)}
          onAdded={onChanged}
        />
      ) : null}
      {reminders.map((reminder) => {
        const who = profiles.find((profile) => profile.id === reminder.addedBy);
        const when = due(reminder.dueAt, timeZone);
        const done = Boolean(reminder.doneAt);
        return (
          <div className={`item${done ? " item--done" : ""}`} key={reminder.id}>
            <button
              className="check"
              disabled={busy === reminder.id}
              onClick={() => void setDone(reminder, !done)}
              aria-label={done ? `Reopen ${reminder.title}` : `Mark ${reminder.title} done`}
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
              <div className="item__name">{reminder.title}</div>
              {when || reminder.source === "email" || reminder.notes ? (
                <div className="item__from">
                  {when ? (
                    <span style={{ color: when.late && !done ? "var(--rose)" : undefined }}>
                      {when.late && !done ? "overdue · " : ""}
                      {when.label}
                    </span>
                  ) : null}
                  {when && (reminder.notes || reminder.source === "email") ? " · " : null}
                  {reminder.notes ?? (reminder.source === "email" ? "from email" : null)}
                </div>
              ) : null}
            </div>
            <div className="item__trail">
              {who ? (
                <span
                  className="item__who"
                  title={`added by ${who.name}`}
                  style={{ background: who.color }}
                />
              ) : null}
              {/* Only for jobs still to do: putting a finished one on the
                  calendar is scheduling something that has already happened. */}
              {done ? null : (
                <button
                  className="item__schedule"
                  disabled={busy === reminder.id}
                  onClick={() => setScheduling(reminder)}
                  title={`Put ${reminder.title} on a calendar`}
                  aria-label={`Put ${reminder.title} on a calendar`}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                       stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                       strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="16" rx="2" />
                    <path d="M3 10h18M8 3v4M16 3v4" />
                  </svg>
                </button>
              )}
              <button
                className="item__remove"
                disabled={busy === reminder.id}
                onClick={() => void remove(reminder)}
                title={`Remove ${reminder.title}`}
                aria-label={`Remove ${reminder.title}`}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
