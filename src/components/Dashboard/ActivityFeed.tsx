"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { ActivityEntry, Profile, Source } from "@/lib/types";

const ICONS: Record<Source, string> = {
  voice: "🎙",
  photo: "📷",
  email: "✉️",
  recipe: "📖",
  manual: "✎",
  text: "✎",
};

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default function ActivityFeed({
  activity,
  profiles,
  profileId,
  onChanged,
}: {
  activity: ActivityEntry[];
  profiles: Profile[];
  profileId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  const undo = async (id: number) => {
    setBusy(id);
    try {
      await api("/api/undo", {
        method: "POST",
        body: JSON.stringify({ activityId: id }),
        profileId,
      });
      onChanged();
    } catch {
      /* the row stays; the feed will show the truth on the next poll */
    } finally {
      setBusy(null);
    }
  };

  if (activity.length === 0) {
    return <p className="empty">Nothing has happened yet today.</p>;
  }

  return (
    <div className="feed">
      {activity.map((entry) => {
        const who = profiles.find((profile) => profile.id === entry.profileId);
        return (
          <div className="feed__row" key={entry.id}>
            <span className="feed__icon" title={entry.source}>
              {ICONS[entry.source] ?? "•"}
            </span>
            <span className={`feed__text${entry.undoneAt ? " feed__text--undone" : ""}`}>
              {entry.summary}
              {who ? (
                <span className="feed__who" style={{ color: who.color }}>
                  {" "}
                  · {who.name}
                </span>
              ) : null}
              {entry.source === "email" ? (
                <span className="recipe__meta"> · from email</span>
              ) : null}
            </span>
            {entry.undoable && !entry.undoneAt ? (
              <button
                className="item__undo"
                disabled={busy === entry.id}
                onClick={() => void undo(entry.id)}
              >
                undo
              </button>
            ) : (
              <span className="feed__when">{ago(entry.createdAt)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
