"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CategoryReport,
  CalendarEvent,
  HouseholdState,
  MoneySnapshot,
} from "@/lib/types";

export async function api<T>(
  path: string,
  init: RequestInit & { profileId?: string | null } = {},
): Promise<T> {
  const { profileId, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (profileId) headers.set("x-profile-id", profileId);
  if (rest.body && !(rest.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...rest, headers, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }
  return body as T;
}

/**
 * The dashboard's live feed.
 *
 * Polling, not sockets: two phones and a tablet against a serverless backend,
 * where a socket needs a server to hold it open and a poll of a few kilobytes
 * every couple of seconds does not. The revision hash means an unchanged
 * household costs one request and no re-render.
 */
export function useHouseholdState(intervalMs = 2500) {
  const [state, setState] = useState<HouseholdState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef<string>("");
  const inFlight = useRef(false);
  // A forced refresh must not be answered with "unchanged" from a revision the
  // caller is trying to move past, so mutations clear it first.
  const forget = useCallback(() => {
    revision.current = "";
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const query = revision.current ? `?since=${revision.current}` : "";
      const next = await api<HouseholdState & { unchanged?: boolean }>(
        `/api/state${query}`,
      );
      setError(null);
      if (!next.unchanged && next.revision !== revision.current) {
        revision.current = next.revision;
        setState(next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () =>
      document.visibilityState === "visible" ? start() : stop();

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, refresh]);

  const reload = useCallback(async () => {
    forget();
    await refresh();
  }, [forget, refresh]);

  return { state, error, refresh: reload, setState };
}

/**
 * Calendar is a live read against Google, so it gets its own slower loop.
 *
 * The range is the caller's: paging to next month has to refetch, and it has
 * to do so without blanking the panel first, or every step through the year
 * flashes an empty grid.
 */
export function useCalendar(
  range: { from: string; to: string },
  intervalMs = 60_000,
) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reconnect, setReconnect] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const { from, to } = range;

  // Bumped to force a re-read: removing an event should show at once, not at
  // the next minute's poll.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (alive) setLoading(true);
      try {
        const data = await api<{
          events: CalendarEvent[];
          connected: string[];
          errors: string[];
          reconnect?: string[];
        }>(`/api/calendar?from=${from}&to=${to}`);
        if (!alive) return;
        setEvents(data.events);
        setConnected(data.connected);
        setErrors(data.errors);
        setReconnect(data.reconnect ?? []);
      } catch (cause) {
        if (alive) setErrors([cause instanceof Error ? cause.message : String(cause)]);
      } finally {
        if (alive) {
          setLoaded(true);
          setLoading(false);
        }
      }
    };
    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [from, to, intervalMs, nonce]);

  return { events, connected, errors, reconnect, loaded, loading, reload };
}

export function useMoney(intervalMs = 15 * 60_000) {
  const [snapshot, setSnapshot] = useState<MoneySnapshot | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api<{ configured: boolean; snapshot: MoneySnapshot | null }>(
          "/api/money",
        );
        if (!alive) return;
        setConfigured(data.configured);
        setSnapshot(data.snapshot);
        setError(null);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { snapshot, configured, error };
}

/**
 * Spending by category for one range.
 *
 * Fetched on demand rather than polled: it only moves when a transaction
 * lands, and the range is whatever the person is currently asking about.
 */
export function useCategories(range: { from: string; to: string } | null) {
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!range) return;
    let alive = true;
    const { from, to } = range;
    setLoading(true);
    api<{ report: CategoryReport | null }>(`/api/money/categories?from=${from}&to=${to}`)
      .then((data) => {
        if (!alive) return;
        setReport(data.report);
        setError(null);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range]);

  return { report, error, loading };
}
