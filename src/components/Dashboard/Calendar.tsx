"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent, Profile } from "@/lib/types";
import {
  type CalendarView,
  addDayKeys,
  dayKeysIn,
  openingDay,
  rangeLabel,
  shiftAnchor,
  viewRange,
  VISIBLE_DAYS,
} from "./calendar-range";
import EventDetail from "./EventDetail";
import ReconnectBanner from "./ReconnectBanner";

/** How many chips fit in a month cell before it has to say "+3 more". */
const MONTH_CHIP_LIMIT = 2;

function dayKeyOf(event: CalendarEvent, timeZone: string): string {
  return event.allDay
    ? event.start.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.start));
}

export default function Calendar({
  events,
  profiles,
  connected,
  errors,
  reconnect,
  loaded,
  loading,
  timeZone,
  todayKey,
  view,
  anchor,
  profileId,
  onView,
  onAnchor,
  onChanged,
}: {
  events: CalendarEvent[];
  profiles: Profile[];
  connected: string[];
  errors: string[];
  reconnect: string[];
  loaded: boolean;
  loading: boolean;
  timeZone: string;
  todayKey: string;
  view: CalendarView;
  anchor: string;
  profileId: string | null;
  onView: (view: CalendarView) => void;
  onAnchor: (anchor: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<CalendarEvent | null>(null);

  /*
   * The strip renders six weeks and shows one. Scrolling moves the viewport,
   * not the fetch -- swiping through a fortnight should not be a fortnight of
   * requests to Google, and the events are already in hand.
   *
   * `first` is the leftmost visible day, read back from the scroll position,
   * because the header has to say what is on screen rather than what was
   * fetched.
   */
  const strip = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState(() => openingDay(todayKey));

  const scrollToDay = useCallback((key: string, behavior: ScrollBehavior) => {
    const box = strip.current;
    const column = box?.querySelector<HTMLElement>(`[data-day="${key}"]`);
    if (!box || !column) return;
    box.scrollTo({ left: column.offsetLeft - box.offsetLeft, behavior });
  }, []);

  // Open on today minus two, and go back there when the day rolls over.
  useEffect(() => {
    if (view !== "days") return;
    const target = openingDay(todayKey);
    setFirst(target);
    // Not smooth: this is the strip arriving, not a movement to follow.
    scrollToDay(target, "auto");
  }, [view, todayKey, anchor, scrollToDay]);

  const onScroll = useCallback(() => {
    const box = strip.current;
    if (!box) return;
    const columns = [...box.querySelectorAll<HTMLElement>("[data-day]")];
    // The first column whose right edge is still on screen: the one you are
    // looking at, rather than one a pixel of which is still behind the edge.
    const visible = columns.find(
      (column) => column.offsetLeft - box.offsetLeft + column.offsetWidth > box.scrollLeft + 1,
    );
    const key = visible?.dataset.day;
    if (key) setFirst(key);
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      const box = strip.current;
      if (!box) return;
      box.scrollBy({ left: delta * box.clientWidth, behavior: "smooth" });
    },
    [],
  );

  const days = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKeyOf(event, timeZone);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
    return dayKeysIn(viewRange(view, anchor)).map((key) => ({
      key,
      events: (byDay.get(key) ?? []).sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      }),
    }));
  }, [anchor, events, timeZone, view]);

  const colorOf = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.color ?? "var(--text-faint)";

  const month = anchor.slice(0, 7);
  // "Today" is only worth offering when you have wandered off it.
  const away =
    view === "days"
      ? !dayKeysIn({ from: first, to: addDayKeys(first, VISIBLE_DAYS - 1) }).includes(todayKey)
      : !dayKeysIn(viewRange(view, anchor)).includes(todayKey);

  const chip = (event: CalendarEvent, compact: boolean) => (
    <button
      key={event.id}
      className={`event${event.allDay ? " event--allday" : ""}`}
      style={{ "--person": colorOf(event.profileId) } as React.CSSProperties}
      onClick={() => setOpen(event)}
      title={event.location ? `${event.title} — ${event.location}` : event.title}
    >
      {event.allDay ? null : (
        <span className="event__time">
          {new Intl.DateTimeFormat("en-AU", {
            timeZone,
            hour: "numeric",
            minute: compact ? undefined : "2-digit",
          }).format(new Date(event.start))}
        </span>
      )}
      <span className="event__title">{event.title}</span>
    </button>
  );

  return (
    <section className="panel">
      <header className="panel__head">
        <div className="cal__nav">
          <button
            className="btn btn--quiet"
            onClick={() => (view === "days" ? nudge(-1) : onAnchor(shiftAnchor(view, anchor, -1)))}
            aria-label={view === "days" ? "Earlier days" : "Previous month"}
          >
            ‹
          </button>
          <h2 className="panel__title cal__label">
            {rangeLabel(view, view === "days" ? first : anchor)}
          </h2>
          <button
            className="btn btn--quiet"
            onClick={() => (view === "days" ? nudge(1) : onAnchor(shiftAnchor(view, anchor, 1)))}
            aria-label={view === "days" ? "Later days" : "Next month"}
          >
            ›
          </button>
          {away ? (
            <button
              className="btn btn--quiet"
              onClick={() => {
                onAnchor(todayKey);
                if (view === "days") scrollToDay(openingDay(todayKey), "smooth");
              }}
            >
              Today
            </button>
          ) : null}
          {loading && loaded ? <span className="spinner spinner--sm" /> : null}
        </div>

        <div className="cal__right">
          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={view === "days"}
              onClick={() => onView("days")}
            >
              Days
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={view === "month"}
              onClick={() => onView("month")}
            >
              Month
            </button>
          </div>
          {profiles.map((profile) => (
            <span key={profile.id} className="panel__meta cal__who">
              <span className="dot" style={{ background: profile.color }} />
              {profile.name}
              {connected.includes(profile.id) ? "" : " (not connected)"}
            </span>
          ))}
        </div>
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
        ) : view === "days" ? (
          <div className="days" ref={strip} onScroll={onScroll}>
            {days.map((day) => (
              <div
                key={day.key}
                data-day={day.key}
                className={`day${day.key === todayKey ? " day--today" : ""}${
                  day.key < todayKey ? " day--past" : ""
                }`}
              >
                <div className="day__head">
                  <span className="day__name">
                    {new Intl.DateTimeFormat("en-AU", {
                      timeZone: "UTC",
                      weekday: "short",
                    }).format(new Date(`${day.key}T12:00:00Z`))}
                  </span>
                  <span className="day__num">{Number(day.key.slice(8))}</span>
                </div>
                <div className="day__events">{day.events.map((event) => chip(event, false))}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="month">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
              <span key={name} className="month__weekday">
                {name}
              </span>
            ))}
            {days.map((day) => {
              const shown = day.events.slice(0, MONTH_CHIP_LIMIT);
              const hidden = day.events.length - shown.length;
              return (
                <div
                  key={day.key}
                  className={`month__cell${day.key === todayKey ? " month__cell--today" : ""}${
                    day.key.slice(0, 7) === month ? "" : " month__cell--outside"
                  }`}
                >
                  <span className="month__num">{Number(day.key.slice(8))}</span>
                  <div className="month__events">
                    {shown.map((event) => chip(event, true))}
                    {hidden > 0 ? (
                      // Expanding the tile is the way to see them all, so this
                      // counts rather than pretending to be another chip.
                      <span className="month__more">+{hidden} more</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
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
