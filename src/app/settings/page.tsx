"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Profile } from "@/lib/types";

interface DeployState {
  available: boolean;
  commit: string | null;
  subject: string | null;
  branch: string | null;
  behind: number | null;
  checkedAt: string | null;
  log: string[];
  power?: {
    available: boolean;
    staysAwake: boolean;
    settings: Array<{ key: string; label: string; seconds: number | null }>;
  };
}

interface ClaudeLoginState {
  running: boolean;
  startedAt: string | null;
  url: string | null;
  output: string;
  finishedAt: string | null;
  succeeded: boolean | null;
}

interface EmailModelState {
  chosen: string | null;
  fallback: string;
  choices: Array<{ value: string; label: string; note: string }>;
}

interface ScanMailbox {
  account: string | null;
  provider: string | null;
  messages: number;
  note: string | null;
  error: string | null;
  needsReauth: boolean;
}

interface InspectedMessage {
  account: string | null;
  from: string;
  subject: string;
  receivedAt: string;
  verdict?: string;
  dropped?: string[];
  reply?: string;
  calls: Array<{ name: string; confidence: string; summary: string; wouldFile: boolean }>;
  error?: string;
}

interface ScanState {
  available: boolean;
  /** True while a run started from this screen is still going. */
  running?: boolean;
  startedAt?: string | null;
  /** "live" when this came from the button rather than the scheduled task. */
  source?: "live";
  mode?: "file" | "inspect";
  messages?: InspectedMessage[] | null;
  at: string | null;
  scanned: number | null;
  actioned: number | null;
  queued: number | null;
  mailboxes: ScanMailbox[];
  failure: string | null;
  blocked: string | null;
  log: string[];
}

interface SettingsPayload {
  configured: Record<string, boolean>;
  backend: "api" | "cli";
  health: { ok: boolean; detail: string } | null;
  model: string;
  timezone: string;
  profiles: Profile[];
  connections: Array<{
    profileId: string;
    provider: "google" | "microsoft";
    accountEmail: string | null;
    lastScannedAt: string | null;
    needsReauth?: boolean;
  }>;
}

const CHECKS: Array<[string, string, string]> = [
  ["database", "Postgres", "DATABASE_URL — the shopping list, recipes, notes and queue"],
  ["claude", "Claude", "ANTHROPIC_API_KEY — the parsing layer for voice, photos and email"],
  ["google", "Google OAuth", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — calendar and Gmail"],
  ["microsoft", "Microsoft OAuth", "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET — Outlook mail"],
  ["pocketsmith", "Pocketsmith", "POCKETSMITH_API_KEY — budget and renovation spend"],
  [
    "cameras",
    "Cameras",
    "HOME_ASSISTANT_URL / HOME_ASSISTANT_TOKEN — Home Assistant holds the Blink login, not this app",
  ],
  ["appSecret", "App secret", "APP_SECRET — signs OAuth state and the passcode cookie"],
];

/** "never", or "after 30 minutes". Mirrors `describeTimeout` on the server. */
function describeTimeout(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds === 0) return "never";
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `after ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `after ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The headline of a finished scan: what it did, not how many it looked at.
 *
 * "Nothing new" is only true when a mailbox was actually read. A run where
 * every mailbox was skipped found nothing for an entirely different reason,
 * and saying the reassuring thing there is how a broken connection stays
 * unnoticed for a fortnight.
 */
function describeScan(scan: ScanState): string {
  if (scan.mode === "inspect") {
    // An inspection files nothing by design, so counting what it filed would
    // report a fault every time it worked.
    const seen = scan.scanned ?? 0;
    if (seen === 0) return "No mail in the last 24 hours";
    const acting = (scan.messages ?? []).filter((message) => message.calls.length > 0).length;
    return acting === 0
      ? `Re-read ${seen}, none of them asked for anything`
      : `Re-read ${seen}, ${acting} would do something`;
  }

  const readable = scan.mailboxes.filter((box) => !box.note && !box.error);
  if (scan.mailboxes.length === 0) return "No mailbox was read";
  if (readable.length === 0) {
    return scan.mailboxes.length === 1 ? "The mailbox was skipped" : "Every mailbox was skipped";
  }

  const actioned = scan.actioned ?? 0;
  const queued = scan.queued ?? 0;
  if (actioned === 0 && queued === 0) {
    return scan.scanned ? `Read ${scan.scanned}, filed nothing` : "Nothing new";
  }
  const parts: string[] = [];
  if (actioned > 0) parts.push(`${actioned} filed`);
  if (queued > 0) parts.push(`${queued} waiting for approval`);
  return parts.join(", ");
}

/** "4 minutes ago", for a line about how current a claim is. */
function describeAge(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}

export default function Settings() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<DeployState | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [emailModel, setEmailModel] = useState<EmailModelState | null>(null);
  const [login, setLogin] = useState<ClaudeLoginState | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<SettingsPayload>("/api/settings?health=1"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const loadDeploy = useCallback(async () => {
    try {
      setDeploy(await api<DeployState>("/api/update"));
    } catch {
      // Older build, or not the wall. The section just does not appear.
    }
  }, []);

  const loadLogin = useCallback(async () => {
    try {
      setLogin(await api<ClaudeLoginState>("/api/settings/claude-login"));
    } catch {
      // Older build, or the API backend, which has no sign-in to renew.
    }
  }, []);

  const startLogin = async () => {
    setLoggingIn(true);
    try {
      await api<{ started: boolean; detail: string }>("/api/settings/claude-login", {
        method: "POST",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoggingIn(false);
      void loadLogin();
    }
  };

  const loadEmailModel = useCallback(async () => {
    try {
      setEmailModel(await api<EmailModelState>("/api/settings/email-model"));
    } catch {
      // Older build. The row simply does not appear.
    }
  }, []);

  const chooseEmailModel = async (model: string) => {
    // Optimistic: the select has already moved, and a row that springs back
    // for a second reads as a control that did not take.
    setEmailModel((current) => (current ? { ...current, chosen: model || null } : current));
    try {
      setEmailModel(
        await api<EmailModelState>("/api/settings/email-model", {
          method: "POST",
          body: JSON.stringify({ model }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      void loadEmailModel();
    }
  };

  const loadScan = useCallback(async () => {
    try {
      const next = await api<ScanState>("/api/scan");
      setScan(next);
      // The result replaces the "scanning" line rather than sitting under it:
      // a finished run with "a message takes a moment" still on screen reads
      // as a run that is somehow both done and not.
      if (next.source === "live" && !next.running) setScanNote(null);
    } catch {
      // Older build. The section just does not appear.
    }
  }, []);

  useEffect(() => {
    void loadEmailModel();
    void loadLogin();
  }, [loadEmailModel, loadLogin]);

  // A sign-in waits on a person tapping through a browser on the wall, so
  // the phone that started it needs to see it land.
  useEffect(() => {
    if (!login?.running) return;
    const timer = setInterval(loadLogin, 3_000);
    return () => clearInterval(timer);
  }, [login?.running, loadLogin]);

  useEffect(() => {
    void loadDeploy();
    void loadScan();
    const timer = setInterval(() => {
      void loadDeploy();
      void loadScan();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadDeploy, loadScan]);

  // A run in flight is the one time this screen is worth watching, and
  // fifteen seconds is long enough to look broken.
  useEffect(() => {
    if (!scan?.running) return;
    const timer = setInterval(loadScan, 3_000);
    return () => clearInterval(timer);
  }, [scan?.running, loadScan]);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) setFlash(`${params.get("connected")} connected.`);
    if (params.get("error")) setError(`Connection failed: ${params.get("error")}`);
  }, [load]);

  const update = async () => {
    setUpdating(true);
    setUpdateNote("Asked the wall to update. It rebuilds and restarts itself, which takes a couple of minutes.");
    try {
      const result = await api<{ started: boolean; detail: string }>("/api/update", {
        method: "POST",
      });
      setUpdateNote(result.detail);
    } catch (cause) {
      // The app restarting mid-request is the successful case, not a failure.
      setUpdateNote(
        cause instanceof Error && /fetch|network|load failed/i.test(cause.message)
          ? "Started. The app is restarting, so this page will be unreachable for a minute."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setUpdating(false);
      setTimeout(() => void loadDeploy(), 4000);
    }
  };

  const runScan = async (inspect = false) => {
    setScanning(true);
    setScanNote(null);
    try {
      const result = await api<{ started: boolean; detail: string }>("/api/scan", {
        method: "POST",
        body: JSON.stringify({ inspect }),
      });
      setScanNote(result.detail);
    } catch (cause) {
      setScanNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
      void loadScan();
    }
  };

  const disconnect = async (profileId: string, provider: "google" | "microsoft") => {
    await api("/api/auth/disconnect", {
      method: "POST",
      body: JSON.stringify({ provider }),
      profileId,
    });
    void load();
  };

  return (
    <main className="settings">
      <div>
        <p className="eyebrow">Household</p>
        <h1 style={{ fontSize: "var(--step-3)" }}>Settings</h1>
      </div>

      {flash ? (
        <div
          className="banner"
          style={{
            borderColor: "rgba(74,122,65,0.35)",
            background: "#e9f2e6",
            color: "#2c4d26",
          }}
        >
          {flash}
        </div>
      ) : null}
      {error ? <div className="banner">{error}</div> : null}

      <section>
        <h2 className="aisle__name">Accounts</h2>
        {data?.configured.gmail ? (
          <p className="setting__note" style={{ marginBottom: 12 }}>
            Gmail scanning is on. Google keeps any app asking for Gmail in
            &ldquo;testing&rdquo; until it passes a verification review, and a testing
            app&rsquo;s sign-ins expire after seven days &mdash; so both accounts will
            ask to be reconnected weekly. Publishing the app in the Google Cloud
            console, or turning <code>GOOGLE_ENABLE_GMAIL</code> off, ends that; the
            calendar alone never expires.
          </p>
        ) : null}
        {(data?.profiles ?? []).map((profile) => {
          const google = data?.connections.find(
            (connection) => connection.profileId === profile.id && connection.provider === "google",
          );
          const microsoft = data?.connections.find(
            (connection) =>
              connection.profileId === profile.id && connection.provider === "microsoft",
          );
          return (
            <div key={profile.id} style={{ marginBottom: 16 }}>
              <div className="setting" style={{ borderColor: profile.color }}>
                <div>
                  <div className="setting__name" style={{ color: profile.color }}>
                    {profile.name}
                  </div>
                  <div className="setting__note">
                    Google covers this person&rsquo;s calendar and Gmail; Microsoft covers
                    their Outlook mail.
                  </div>
                </div>
              </div>

              {(
                [
                  ["google", "Google (Calendar + Gmail)", google] as const,
                  ["microsoft", "Outlook / Microsoft 365", microsoft] as const,
                ]
              ).map(([provider, label, connection]) => (
                <div className="setting" key={provider} style={{ marginTop: 8 }}>
                  <div>
                    <div className="setting__name">{label}</div>
                    <div className="setting__note">
                      {!connection
                        ? "Not connected"
                        : connection.needsReauth
                          ? `${connection.accountEmail ?? "Connected"} — sign-in expired. Reconnect to bring the calendar back.`
                          : `${connection.accountEmail ?? "connected"}${
                              connection.lastScannedAt
                                ? ` · last scanned ${new Date(connection.lastScannedAt).toLocaleString()}`
                                : " · not scanned yet"
                            }`}
                    </div>
                  </div>
                  {connection?.needsReauth ? (
                    <a
                      className="btn btn--primary"
                      href={`/api/auth/${provider}?profile=${profile.id}`}
                    >
                      Reconnect
                    </a>
                  ) : connection ? (
                    <button
                      className="btn btn--ghost btn--danger"
                      onClick={() => void disconnect(profile.id, provider)}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <a className="btn" href={`/api/auth/${provider}?profile=${profile.id}`}>
                      Connect
                    </a>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="aisle__name">What&rsquo;s wired up</h2>
        {CHECKS.map(([key, name, note]) => (
          <div className="setting" key={key} style={{ marginBottom: 8 }}>
            <div>
              <div className="setting__name">{name}</div>
              <div className="setting__note">{note}</div>
            </div>
            <span className={`status status--${data?.configured?.[key] ? "on" : "off"}`}>
              <span
                className="dot"
                style={{ background: data?.configured?.[key] ? "var(--sage)" : "var(--line-solid)" }}
              />
              {data?.configured?.[key] ? "set" : "missing"}
            </span>
          </div>
        ))}
      </section>

      <section>
        <h2 className="aisle__name">This deployment</h2>
        <div className="setting">
          <div>
            <div className="setting__name">Timezone</div>
            <div className="setting__note">
              Every spoken &ldquo;Thursday at four&rdquo; is resolved in this zone.
              Change it with HOUSEHOLD_TIMEZONE.
            </div>
          </div>
          <span className="pill">{data?.timezone ?? "—"}</span>
        </div>
        <div className="setting" style={{ marginTop: 8 }}>
          <div>
            <div className="setting__name">Model</div>
            {/* The variable that is actually in play, which is not the same
                one on both backends -- naming the wrong one is how the screen
                came to display a model nothing was using. */}
            <div className="setting__note">
              {data?.backend === "cli" ? "CLAUDE_CLI_MODEL" : "CLAUDE_MODEL"}
              {" \u00b7 email chosen below"}
            </div>
          </div>
          <span className="pill">{data?.model ?? "—"}</span>
        </div>
        <div className="setting" style={{ marginTop: 8 }}>
          <div>
            <div className="setting__name">
              Inference{" "}
              {data ? (
                <span className="pill" style={{ marginLeft: 6 }}>
                  {data.backend === "cli" ? "claude -p" : "Messages API"}
                </span>
              ) : null}
            </div>
            <div className="setting__note">
              {data?.health?.detail ??
                "CLAUDE_BACKEND — api for the Messages API, cli to shell out to a signed-in Claude Code"}
            </div>
          </div>
          {/* Rose, not the faint grey the other rows use when they are off: an
              inference backend that cannot answer takes the mailbox scan,
              voice capture, aisle guessing and Ask down with it. */}
          <span
            className={`status status--${data?.health?.ok ? "on" : "off"}`}
            style={data?.health && !data.health.ok ? { color: "var(--rose)" } : undefined}
          >
            <span
              className="dot"
              style={{
                background: data?.health
                  ? data.health.ok
                    ? "var(--sage)"
                    : "var(--rose)"
                  : "var(--line-solid)",
              }}
            />
            {data?.health ? (data.health.ok ? "reachable" : "not reachable") : "—"}
          </span>
        </div>

        {/* The sign-in expires on its own and nothing renews it, so the
            remedy belongs on the screen that reports the fault -- the same
            reasoning as the per-person Reconnect buttons above. Unlike those,
            this one cannot finish here: `claude auth login` completes on a
            callback to the wall's own localhost, so the browser it opens is
            the wall's and the tapping happens there. */}
        {data?.backend === "cli" && login ? (
          <div className="setting" style={{ marginTop: 8 }}>
            <div>
              <div className="setting__name">
                {login.running
                  ? "Waiting for you at the wall"
                  : login.succeeded
                    ? "Signed in"
                    : "Sign in to Claude"}
              </div>
              <div className="setting__note">
                {login.running
                  ? "A browser is open on the wall's screen. Tap through it there — the sign-in finishes on that machine, not on this one."
                  : login.finishedAt && !login.succeeded
                    ? login.output.trim().slice(-300) || "The sign-in did not complete."
                    : "The Claude Code session expires on its own, and everything that needs a model stops with it: the mailbox scan, voice capture, aisle guessing and Ask."}
                {login.url ? (
                  <>
                    <br />
                    <a href={login.url} target="_blank" rel="noreferrer">
                      Open the sign-in page
                    </a>{" "}
                    — only useful on the wall itself.
                  </>
                ) : null}
              </div>
            </div>
            <button
              className="btn"
              onClick={() => void startLogin()}
              disabled={loggingIn || login.running}
            >
              {loggingIn || login.running ? "Waiting…" : "Sign in"}
            </button>
          </div>
        ) : null}
      </section>

      {deploy?.available ? (
        <section>
          <h2 className="aisle__name">Software</h2>
          <div className="setting">
            <div>
              <div className="setting__name">
                {deploy.behind && deploy.behind > 0
                  ? `${deploy.behind} update${deploy.behind === 1 ? "" : "s"} waiting`
                  : "Up to date"}
              </div>
              <div className="setting__note">
                {deploy.commit ? (
                  <>
                    Running <code>{deploy.commit}</code>
                    {deploy.subject ? ` — ${deploy.subject}` : null}
                    {deploy.branch ? ` (${deploy.branch})` : null}
                  </>
                ) : (
                  "Cannot read the checkout on this machine."
                )}
                <br />
                {deploy.checkedAt
                  ? `Last checked ${describeAge(deploy.checkedAt)}; it checks again every ten minutes on its own.`
                  : "Checked every ten minutes on its own; this button is for now."}
              </div>
            </div>
            <button className="btn btn--primary" onClick={() => void update()} disabled={updating}>
              {updating ? "Starting…" : "Update now"}
            </button>
          </div>
          {updateNote ? (
            <p className="setting__note" style={{ marginTop: 8 }}>
              {updateNote}
            </p>
          ) : null}
          {deploy.power?.available ? (
            <div className="setting" style={{ marginTop: 8 }}>
              <div>
                <div className="setting__name">
                  {deploy.power.staysAwake ? "Stays awake on mains" : "This machine will sleep"}
                </div>
                <div className="setting__note">
                  {deploy.power.settings
                    .map((setting) => `${setting.label}: ${describeTimeout(setting.seconds)}`)
                    .join(" · ")}
                  <br />
                  Read back from the plan, not from what it was told. Re-applied as
                  this account on every update.
                </div>
              </div>
              {/* Rose rather than the faint grey the other rows use when they are
                  off: a wall that sleeps is a fault, not a feature nobody has
                  turned on. */}
              <span
                className={`status status--${deploy.power.staysAwake ? "on" : "off"}`}
                style={deploy.power.staysAwake ? undefined : { color: "var(--rose)" }}
              >
                <span
                  className="dot"
                  style={{
                    background: deploy.power.staysAwake ? "var(--sage)" : "var(--rose)",
                  }}
                />
                {deploy.power.staysAwake ? "awake" : "sleeps"}
              </span>
            </div>
          ) : null}

          {deploy.log.length > 0 ? (
            <pre className="deploy-log">{deploy.log.join("\n")}</pre>
          ) : null}
        </section>
      ) : null}

      {scan?.available ? (
        <section>
          <h2 className="aisle__name">Mailbox scan</h2>
          {emailModel ? (
            <div className="setting" style={{ marginBottom: 8 }}>
              <div>
                <div className="setting__name">Reads the email</div>
                <div className="setting__note">
                  {emailModel.choices.find(
                    (choice) => choice.value === (emailModel.chosen ?? ""),
                  )?.note ?? `Currently ${emailModel.chosen}.`}
                  <br />
                  Deciding whether an email is something you need is the judgement
                  this whole feature rests on. It lives here rather than in a file
                  on the wall, because that file needs a keyboard.
                </div>
              </div>
              <select
                className="btn"
                value={emailModel.chosen ?? ""}
                onChange={(event) => void chooseEmailModel(event.target.value)}
              >
                {emailModel.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.value === "" ? `${choice.label} (${emailModel.fallback})` : choice.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="setting">
            <div>
              <div className="setting__name">
                {scan.running
                  ? "Working\u2026"
                  : scan.failure
                    ? "The last scan did not finish"
                    : scan.blocked
                      ? "The scan had nothing to read"
                      : scan.at
                        ? describeScan(scan)
                        : "No scan has run yet"}
              </div>
              <div className="setting__note">
                {scan.running
                  ? "Reading every connected mailbox. A message takes a moment to classify, so this can run for a few minutes."
                  : (scan.failure ??
                    scan.blocked ??
                    (scan.at
                      ? `${scan.source === "live" ? "Run from this button" : "Last run"} ${describeAge(scan.at)}; the scheduled one runs every fifteen minutes.`
                      : "Nothing has reported yet. Press Scan now \u2014 it runs here in the app and says what it finds, including what went wrong."))}
              </div>
            </div>
            <div style={{ display: "grid", gap: 8, justifyItems: "stretch" }}>
              <button
                className="btn"
                onClick={() => void runScan(false)}
                disabled={scanning || scan.running}
              >
                {scanning || scan.running ? "Working\u2026" : "Scan now"}
              </button>
              {/* The normal path gives a message one chance: claimed by the run
                  that sees it, then left behind a watermark that has moved on.
                  By the time anyone asks why nothing happened, there is no way
                  to ask again -- so this re-reads and reports, and files
                  nothing. */}
              <button
                className="btn"
                onClick={() => void runScan(true)}
                disabled={scanning || scan.running}
              >
                Re-read 24h
              </button>
            </div>
          </div>
          {scanNote ? (
            <p className="setting__note" style={{ marginTop: 8 }}>
              {scanNote}
            </p>
          ) : null}
          {/* A mailbox that was skipped is the answer to "why did nothing
              arrive", so each one says so on its own line rather than being
              summed into a count that hides it. */}
          {scan.mailboxes.map((box, index) => (
            <div className="setting" key={`${box.provider}:${box.account}:${index}`} style={{ marginTop: 8 }}>
              <div>
                <div className="setting__name">{box.account ?? box.provider ?? "Mailbox"}</div>
                <div className="setting__note">
                  {/* A dead grant is a person's job, not an error string: the
                      raw refusal stays in the log below, where it is evidence
                      rather than instruction. */}
                  {box.needsReauth
                    ? "Sign-in expired \u2014 use the Reconnect button above"
                    : (box.error ?? box.note ?? `${box.messages} new message${box.messages === 1 ? "" : "s"} read`)}
                </div>
              </div>
              <span
                className={`status status--${box.error || box.needsReauth ? "off" : "on"}`}
                style={box.error || box.needsReauth ? { color: "var(--rose)" } : undefined}
              >
                <span
                  className="dot"
                  style={{
                    background:
                      box.error || box.needsReauth
                        ? "var(--rose)"
                        : box.note
                          ? "var(--line-solid)"
                          : "var(--sage)",
                  }}
                />
                {box.needsReauth ? "reconnect" : box.error ? "failed" : box.note ? "skipped" : "read"}
              </span>
            </div>
          ))}

          {scan.mode === "inspect" && scan.messages ? (
            scan.messages.length === 0 ? (
              <p className="setting__note" style={{ marginTop: 8 }}>
                No mail at all in the last 24 hours, in any connected mailbox. If
                something is sitting in the inbox, the scanner is not looking at
                the folder it is in.
              </p>
            ) : (
              scan.messages.map((message, index) => (
                <div className="setting" key={`${message.receivedAt}:${index}`} style={{ marginTop: 8 }}>
                  <div>
                    <div className="setting__name">{message.subject}</div>
                    <div className="setting__note">
                      {message.from}
                      <br />
                      {message.error ??
                        (message.calls.length === 0
                          ? // The model's own sentence, not a summary of it. It is
                            // required to give one, and reading it beats guessing
                            // at the prompt from the outside. Failing that, what
                            // the parser threw away -- a reply it could not use
                            // and a considered no are not the same answer.
                            (message.verdict ??
                              message.dropped?.join(" ") ??
                              (message.reply
                                ? `No actions. The model replied: "${message.reply}"`
                                : "Judged to need nothing doing, and it did not say why."))
                          : message.calls
                              .map(
                                (call) =>
                                  `${call.summary} (${call.confidence} confidence, would ${call.wouldFile ? "file it" : "ask first"})`,
                              )
                              .join(" \u00b7 "))}
                    </div>
                  </div>
                  <span
                    className={`status status--${message.error ? "off" : message.calls.length > 0 ? "on" : "off"}`}
                    style={message.error ? { color: "var(--rose)" } : undefined}
                  >
                    <span
                      className="dot"
                      style={{
                        background: message.error
                          ? "var(--rose)"
                          : message.calls.length > 0
                            ? "var(--sage)"
                            : "var(--line-solid)",
                      }}
                    />
                    {message.error
                      ? "failed"
                      : message.calls.length === 0
                        ? "no action"
                        : message.calls.some((call) => call.wouldFile)
                          ? "would file"
                          : "would ask"}
                  </span>
                </div>
              ))
            )
          ) : null}
          {scan.log.length > 0 ? (
            <pre className="deploy-log">{scan.log.join("\n")}</pre>
          ) : null}
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 10 }}>
        <Link className="btn" href="/dashboard">
          Dashboard
        </Link>
        <Link className="btn" href="/capture">
          Capture
        </Link>
      </div>
    </main>
  );
}
