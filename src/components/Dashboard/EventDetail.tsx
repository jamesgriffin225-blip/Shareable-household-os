"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { CalendarEvent, Profile } from "@/lib/types";

function span(event: CalendarEvent, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (event.allDay) return `${day.format(new Date(`${event.start.slice(0, 10)}T12:00:00Z`))} · all day`;

  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const start = new Date(event.start);
  const end = new Date(event.end);
  const sameDay =
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(start) ===
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(end);

  return sameDay
    ? `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`
    : `${day.format(start)}, ${time.format(start)} → ${day.format(end)}, ${time.format(end)}`;
}

/** The whole of an event, for the times the two-line chip isn't enough. */
export default function EventDetail({
  event,
  profiles,
  timeZone,
  profileId,
  onClose,
  onRemoved,
}: {
  event: CalendarEvent;
  profiles: Profile[];
  timeZone: string;
  /** Who is at the screen — recorded in the activity feed as the remover. */
  profileId: string | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  // Two presses, not a browser confirm(). This is a wall in a kitchen: a
  // stray palm on "Remove" should not silently delete somebody's dentist
  // appointment, and a modal dialog on a touchscreen is worse than a button
  // that changes its mind.
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await api("/api/calendar/event", {
        method: "DELETE",
        profileId,
        body: JSON.stringify({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          location: event.location,
          notes: event.notes,
        }),
      });
      onRemoved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setConfirming(false);
    } finally {
      setRemoving(false);
    }
  };

  useEffect(() => {
    const onKey = (key: KeyboardEvent) => {
      if (key.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const owner = profiles.find((profile) => profile.id === event.profileId);

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet__card" onClick={(click) => click.stopPropagation()}>
        <header className="sheet__head">
          <span
            className="sheet__owner"
            style={{ background: owner?.color ?? "var(--text-faint)" }}
          />
          <div>
            <h2 className="sheet__title">{event.title}</h2>
            <p className="sheet__when">{span(event, timeZone)}</p>
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <dl className="sheet__facts">
          <div>
            <dt>Whose</dt>
            <dd>{owner?.name ?? "Unknown"}</dd>
          </div>
          {event.location ? (
            <div>
              <dt>Where</dt>
              <dd>
                {/* Australian addresses come out of Google as one line; a maps
                    link is more use on a wall than the text is. */}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.location}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {event.notes ? <p className="sheet__notes">{event.notes}</p> : null}

        {error ? <div className="banner">{error}</div> : null}

        <div className="sheet__actions">
          {event.htmlLink ? (
            <a
              className="btn btn--ghost"
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Calendar
            </a>
          ) : null}

          {confirming ? (
            <>
              <button
                className="btn btn--danger btn--solid"
                onClick={() => void remove()}
                disabled={removing}
              >
                {removing ? "Removing…" : "Yes, remove it"}
              </button>
              <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button
              className="btn btn--ghost btn--danger"
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
