"use client";

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/lib/types";
import { api } from "./api.ts";

const KEY = "household.profile";

/**
 * Who is using this device. Chosen once and remembered — two people in one
 * house do not need accounts, they need their name on the things they add.
 */
export function useProfile() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api<{ profiles: Profile[] }>("/api/settings");
        if (!alive) return;
        setProfiles(data.profiles);
        const stored =
          typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
        if (stored && data.profiles.some((profile) => profile.id === stored)) {
          setProfileId(stored);
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const choose = useCallback((id: string) => {
    window.localStorage.setItem(KEY, id);
    setProfileId(id);
  }, []);

  const clear = useCallback(() => {
    window.localStorage.removeItem(KEY);
    setProfileId(null);
  }, []);

  const profile = profiles.find((entry) => entry.id === profileId) ?? null;
  return { profiles, profile, profileId, choose, clear, ready, error };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
