"use client";

import { useState } from "react";

export default function Unlock() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Wrong passcode");
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <form className="home__card" onSubmit={submit} style={{ maxWidth: 380 }}>
        <p className="eyebrow">Household</p>
        <h1 className="home__title" style={{ fontSize: "var(--step-3)" }}>
          Passcode
        </h1>
        <input
          className="field"
          type="password"
          inputMode="numeric"
          autoFocus
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="••••"
        />
        {error ? <div className="banner">{error}</div> : null}
        <button className="btn btn--primary" disabled={busy || !passcode}>
          {busy ? <span className="spinner" /> : "Unlock this device"}
        </button>
      </form>
    </main>
  );
}
