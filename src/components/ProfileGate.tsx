"use client";

import { initials } from "@/lib/client/profile";
import type { Profile } from "@/lib/types";

export default function ProfileGate({
  profiles,
  onChoose,
  title = "Who's this?",
  note,
  error = null,
}: {
  profiles: Profile[];
  onChoose: (id: string) => void;
  title?: string;
  note?: string;
  /** Why the list is empty, when the reason is known. */
  error?: string | null;
}) {
  return (
    <div className="gate">
      <div className="gate__card">
        <h1 className="home__title" style={{ fontSize: "var(--step-3)" }}>
          {title}
        </h1>
        {note ? <p className="setting__note">{note}</p> : null}
        <div className="gate__people">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className="gate__person"
              onClick={() => onChoose(profile.id)}
            >
              <span className="avatar" style={{ background: profile.color }}>
                {initials(profile.name)}
              </span>
              <span style={{ fontSize: "var(--step-1)" }}>{profile.name}</span>
            </button>
          ))}
        </div>
        {/*
          * An empty list has two very different causes, and saying "check
          * DATABASE_URL" for both of them sends you to read a file that is
          * perfectly fine. If the request failed, show what it said.
          */}
        {profiles.length === 0 ? (
          error ? (
            <div className="banner">
              Couldn&rsquo;t read the household: {error}
              <span className="setting__note">
                Usually Postgres not running, rather than anything in the app.
              </span>
            </div>
          ) : (
            <p className="empty">
              No profiles yet. The database seeds them on first use, so this
              means it answered and had none — check DATABASE_URL points at the
              right database.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
