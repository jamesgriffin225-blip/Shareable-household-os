"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Approval } from "@/lib/types";

/** Fields worth showing in the inline editor — the rest ride along unchanged. */
const HIDDEN = new Set(["confidence", "confidence_reason"]);

function editableFields(payload: Record<string, unknown>) {
  return Object.entries(payload).filter(
    ([key, value]) =>
      !HIDDEN.has(key) && (typeof value === "string" || typeof value === "number"),
  ) as Array<[string, string | number]>;
}

function sourceLine(approval: Approval): string | null {
  const ref = approval.sourceRef as Record<string, any> | null;
  if (!ref) return null;
  if (approval.source === "email") {
    return `${ref.from ?? "email"} — ${ref.subject ?? "(no subject)"}`;
  }
  if (typeof ref.transcript === "string" && ref.transcript.trim()) {
    return `“${ref.transcript.trim()}”`;
  }
  return null;
}

export default function ApprovalQueue({
  approvals,
  profileId,
  onChanged,
}: {
  approvals: Approval[];
  profileId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (
    approval: Approval,
    decision: "approve" | "discard",
    payload?: Record<string, unknown>,
  ) => {
    setBusy(approval.id);
    setError(null);
    try {
      await api(`/api/approvals/${approval.id}`, {
        method: "POST",
        body: JSON.stringify({ decision, payload }),
        profileId,
      });
      setEditing(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (approvals.length === 0) {
    return <p className="empty">Nothing waiting. Everything went straight in.</p>;
  }

  return (
    <>
      {error ? <div className="banner">{error}</div> : null}
      {approvals.map((approval) => {
        const fields = editableFields(approval.payload);
        const draft = edits[approval.id] ?? {};
        const source = sourceLine(approval);

        return (
          <div className="approval" key={approval.id}>
            <div className="approval__summary">{approval.summary}</div>
            {approval.reason ? <div className="approval__why">{approval.reason}</div> : null}
            {source ? <div className="approval__src">{source}</div> : null}

            {editing === approval.id ? (
              <div className="approval__edit">
                {fields.map(([key, value]) => (
                  <label key={key} className="recipe__meta">
                    {key.replace(/_/g, " ")}
                    <input
                      className="field"
                      value={draft[key] ?? String(value)}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [approval.id]: {
                            ...(current[approval.id] ?? {}),
                            [key]: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <div className="approval__row">
                  <button
                    className="btn btn--primary"
                    disabled={busy === approval.id}
                    onClick={() => {
                      const merged: Record<string, unknown> = {};
                      for (const [key, value] of fields) {
                        const next = draft[key] ?? String(value);
                        merged[key] = typeof value === "number" ? Number(next) : next;
                      }
                      void resolve(approval, "approve", merged);
                    }}
                  >
                    Save &amp; do it
                  </button>
                  <button className="btn btn--ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="approval__row">
                <button
                  className="btn btn--primary"
                  disabled={busy === approval.id}
                  onClick={() => void resolve(approval, "approve")}
                >
                  {busy === approval.id ? <span className="spinner" /> : "Yes, do it"}
                </button>
                {fields.length > 0 ? (
                  <button className="btn" onClick={() => setEditing(approval.id)}>
                    Edit
                  </button>
                ) : null}
                <button
                  className="btn btn--ghost btn--danger"
                  disabled={busy === approval.id}
                  onClick={() => void resolve(approval, "discard")}
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
