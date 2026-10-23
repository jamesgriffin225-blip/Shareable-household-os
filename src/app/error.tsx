"use client";

import { useEffect } from "react";

/**
 * What the wall shows when a render throws.
 *
 * Next.js replaces a crashed segment with nothing at all, which on a tablet
 * mounted in a kitchen is indistinguishable from a dead machine — and gives
 * whoever is standing in front of it no way to say what happened beyond "it
 * won't load". This says what broke, and offers the one button that usually
 * fixes it.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[household] render failed", error);
  }, [error]);

  return (
    <main className="gate">
      <div className="gate__card">
        <p className="eyebrow">Something broke</p>
        <h1 className="home__title" style={{ fontSize: "var(--step-2)" }}>
          The screen didn&rsquo;t load.
        </h1>
        <div className="banner" style={{ textAlign: "left" }}>
          {error.message || "No message came with the error."}
          {error.digest ? (
            <span className="setting__note">Reference: {error.digest}</span>
          ) : null}
        </div>
        <p className="setting__note">
          The rest of the house is unaffected — this is the display, not the
          data. Everything you have added is still there.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn--primary" onClick={reset}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    </main>
  );
}
