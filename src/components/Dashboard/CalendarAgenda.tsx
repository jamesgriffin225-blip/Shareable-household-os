"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent, Profile } from "@/lib/types";
import { groupAgenda } from "./agenda";
import EventDetail from "./EventDetail";
import ReconnectBanner from "./ReconnectBanner";

/**
 * The week for a phone: a list running forwards from today.
 *
 * Seven day-columns need about ninety pixels each before a title stops
 * hyphenating. A phone has four hundred in total, so the grid becomes a list
 * and the day becomes a heading.
 */
export default function CalendarAgenda({
  events,
  profiles,
  connected,
  errors,
  reconnect,
  loaded,
  timeZone,
  now,
  profileId,
  onChanged,
}: {
  events: CalendarEvent[];
  profiles: Profile[];
  connected: string[];
  errors: string[];
  reconnect: string[];
  loaded: boolean;
  timeZone: string;
  now: Date;
  profileId: string | null;
  onChanged: () => void;
}) {
  // The phone is where you are standing when the dentist cancels, so the
  // agenda opens the same sheet the wall does rather than being read-only.
  const [open, setOpen] = useState<CalendarEvent | null>(null);
  const days = useMemo(
    () => groupAgenda(events, { now, timeZone }),
    [events, now, timeZone],
  );

  const colorOf = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.color ?? "var(--text-faint)";

  const count = days.reduce((total, day) => total + day.events.length, 0);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Next seven days</h2>
        <span className="panel__meta">
          {count === 0 ? "clear" : `${count} on`}
        </span>
      </header>
      <div className="panel__body">
        {reconnect.length > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <ReconnectBanner reconnect={reconnect} profiles={profiles} />
          </div>
        ) : null}
        {errors.length > 0 ? (
          <div className="banner" style={{ marginBottom: 12 }}>
            {errors.join(" · ")}
          </div>
        ) : null}
        {!loaded ? (
          <p className="empty">
            <span className="spinner" /> Reading both calendars…
          </p>
        ) : connected.length === 0 ? (
          <p className="empty">
            No Google Calendar connected yet — do it once per person in Settings.
          </p>
        ) : (
          <ol className="agenda">
            {days.map((day) => (
              <li key={day.key} className="agenda__day">
                <h3 className={`agenda__label${day.today ? " agenda__label--today" : ""}`}>
                  {day.label}
                </h3>
                {day.events.length === 0 ? (
                  <p className="agenda__clear">Nothing on.</p>
                ) : (
                  <ul className="agenda__events">
                    {day.events.map((event) => (
                      <li key={event.id}>
                        <button
                          className={`agenda__event${event.past ? " agenda__event--past" : ""}`}
                          style={{ "--person": colorOf(event.profileId) } as React.CSSProperties}
                          onClick={() => setOpen(event)}
                        >
                          <span className="agenda__time">
                            {event.allDay
                              ? "All day"
                              : new Intl.DateTimeFormat("en-AU", {
                                  timeZone,
                                  hour: "numeric",
                                  minute: "2-digit",
                                }).format(new Date(event.start))}
                          </span>
                          <span className="agenda__detail">
                            <span className="agenda__title">{event.title}</span>
                            {event.location ? (
                              <span className="agenda__where">{event.location}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {open ? (
        <EventDetail
          event={open}
          profiles={profiles}
          timeZone={timeZone}
          profileId={profileId}
          onClose={() => setOpen(null)}
          onRemoved={onChanged}
        />
      ) : null}
    </section>
  );
}
