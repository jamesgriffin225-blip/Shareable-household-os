import { runToolCall, queueApproval, describeAction } from "./actions.ts";
import { backendHealth, backendName, classifyEmail, claudeConfigured } from "./llm/index.ts";
import {
  alreadySeen,
  listConnections,
  markScanned,
  ReconnectRequired,
  releaseSeen,
  type Connection,
  MAIL_PROVIDERS,
} from "./connections.ts";
import { sql } from "./db.ts";
import { emailModelChoice } from "./model-choice.ts";
import { connectionHasGmail, listRecentMail, type Mail } from "./google.ts";
import { listRecentGraphMail } from "./microsoft.ts";
import { listProfiles } from "./profiles.ts";
import type { Confidence, Profile } from "./types.ts";

/**
 * Actions a mailbox may take on its own, at high confidence only.
 *
 * A recipe or a bulk shopping list arriving from an unread email is exactly
 * the kind of surprise that makes people stop trusting an inbox scanner, so
 * those always wait for a human — everything here is a dated, reversible,
 * single thing.
 */
export const AUTO_EXECUTABLE = new Set([
  "add_calendar_event",
  "add_reminder",
  "log_note",
  "log_expense_note",
]);

export interface ScanReport {
  scanned: number;
  actioned: number;
  queued: number;
  /**
   * What the model made of each message, when asked to re-read rather than
   * to file.
   *
   * A scan normally reports counts, which is right for a kitchen. It is
   * useless for "my email arrived and nothing happened", because the answer
   * is a judgement about one message and the counts have already averaged it
   * away.
   */
  messages?: InspectedMessage[];
  /**
   * Why the scan could not look at anything, when that is the reason it
   * found nothing.
   *
   * Four different situations used to produce a byte-identical empty report:
   * no model backend, no connected account at all, accounts connected but
   * none of them a mailbox, and a genuine quiet morning. Only the last one is
   * reassuring, and the screen was showing the reassuring reading for all
   * four. An email that reached the inbox and produced nothing looked exactly
   * like no email arriving.
   */
  blocked?: string;
  mailboxes: Array<{
    profileId: string;
    provider: string;
    account: string | null;
    messages: number;
    error?: string;
    note?: string;
    needsReauth?: boolean;
    /** Messages read but not classifiable. They are retried, not dropped. */
    failed?: number;
  }>;
}

/** One message, and what the model would do about it. Nothing is executed. */
export interface InspectedMessage {
  account: string | null;
  from: string;
  subject: string;
  receivedAt: string;
  /**
   * The model's own words for why it did nothing, when it did nothing.
   *
   * `no_action` takes a required `reason` -- "one short line for the person"
   * -- and every caller threw it away, `judge` and the first version of this
   * inspection included. So the scanner spent a week declining to file things
   * while saying exactly why, into nothing.
   */
  verdict?: string;
  /**
   * What the parser discarded, and anything the model said as prose.
   *
   * Without these, a reply the parser could not use and a model that chose
   * to do nothing arrive on screen as the same sentence.
   */
  dropped?: string[];
  reply?: string;
  /** Empty when the model decided this one needs nothing doing. */
  calls: Array<{
    name: string;
    confidence: string;
    summary: string;
    /** Whether a live scan would have filed this without asking. */
    wouldFile: boolean;
  }>;
  error?: string;
}

export interface ScanOptions {
  /**
   * Classify and report, change nothing.
   *
   * Reads a fixed window back regardless of the watermark, ignores the
   * already-seen claims, executes nothing, queues nothing, claims nothing and
   * does not move the watermark. It exists because a message gets exactly one
   * chance in the normal path -- claimed on the run that sees it, and then
   * put behind a watermark that has moved past it -- so by the time anyone
   * asks why nothing happened, there is no way to ask again.
   */
  inspect?: boolean;
  /** The window for an inspection. Ignored by a filing scan. */
  hours?: number;
}

function lookbackHours(): number {
  return Number(process.env.EMAIL_SCAN_LOOKBACK_HOURS || 24);
}

function perMailboxLimit(): number {
  return Number(process.env.EMAIL_SCAN_LIMIT || 25);
}

async function fetchMail(connection: Connection, since: Date): Promise<Mail[]> {
  return connection.provider === "google"
    ? listRecentMail(connection, since, perMailboxLimit())
    : listRecentGraphMail(connection, since, perMailboxLimit());
}

/** One message: classify it, then either do it or park it. */
async function judge(
  message: Mail,
  connection: Connection,
  owner: Profile,
  profiles: Profile[],
  recipes: string[],
  report: ScanReport,
  model: string | null,
): Promise<void> {
  const parsed = await classifyEmail({
    mail: message,
    mailbox: `${owner.name}'s ${connection.provider === "google" ? "Gmail" : "Outlook"}`,
    context: { capturedBy: owner, profiles, recipes },
    model,
  });

  const sourceRef = {
    provider: connection.provider,
    account: connection.accountEmail,
    messageId: message.id,
    subject: message.subject,
    from: message.from,
    link: message.link,
    receivedAt: message.receivedAt,
  };

  for (const call of parsed.calls) {
    if (call.name === "no_action") continue;

    const confidence = String(call.input.confidence ?? "low") as Confidence;
    const context = {
      profileId: connection.profileId,
      source: "email" as const,
      sourceRef,
    };

    if (confidence === "high" && AUTO_EXECUTABLE.has(call.name)) {
      const outcome = await runToolCall(call.name, call.input, context);
      if (outcome.executed) report.actioned += 1;
      else report.queued += 1;
      continue;
    }

    await queueApproval({
      action: call.name,
      payload: call.input,
      summary: describeAction(call.name, call.input),
      reason:
        (typeof call.input.confidence_reason === "string"
          ? call.input.confidence_reason
          : null) ??
        (confidence === "high"
          ? "From email — this kind of change always gets a look first"
          : null),
      confidence,
      context,
    });
    report.queued += 1;
  }
}

/** Classify one message and say what would happen, without doing any of it. */
async function inspect(
  message: Mail,
  connection: Connection,
  owner: Profile,
  profiles: Profile[],
  recipes: string[],
  model: string | null,
): Promise<InspectedMessage> {
  const row: InspectedMessage = {
    account: connection.accountEmail,
    from: message.from,
    subject: message.subject,
    receivedAt: message.receivedAt,
    calls: [],
  };

  try {
    const parsed = await classifyEmail({
      mail: message,
      mailbox: `${owner.name}'s ${connection.provider === "google" ? "Gmail" : "Outlook"}`,
      context: { capturedBy: owner, profiles, recipes },
      model,
    });
    if (parsed.dropped?.length) row.dropped = parsed.dropped;
    if (parsed.reply) row.reply = parsed.reply;

    for (const call of parsed.calls) {
      if (call.name === "no_action") {
        const reason = call.input.reason;
        if (typeof reason === "string" && reason.trim()) row.verdict = reason.trim();
        continue;
      }
      const confidence = String(call.input.confidence ?? "low");
      row.calls.push({
        name: call.name,
        confidence,
        summary: describeAction(call.name, call.input),
        wouldFile: confidence === "high" && AUTO_EXECUTABLE.has(call.name),
      });
    }
  } catch (error) {
    // The failure a live scan only ever wrote to a console nobody reads.
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

/** Scan every connected mailbox once. Safe to call repeatedly. */
export async function scanMailboxes(options: ScanOptions = {}): Promise<ScanReport> {
  const report: ScanReport = { scanned: 0, actioned: 0, queued: 0, mailboxes: [] };
  if (options.inspect) report.messages = [];
  if (!claudeConfigured()) {
    report.blocked =
      `Nothing can be classified: the ${backendName()} backend is not configured ` +
      `on this machine, so the scan stops before reading any mailbox.`;
    return report;
  }

  // Asked once, and before the database, because it depends on nothing else:
  // a backend that cannot run turns every message into the same failure, and
  // N identical failures is a worse way to learn one fact than being told it.
  const health = await backendHealth();
  if (!health.ok) {
    report.blocked =
      `The ${backendName()} backend is not answering, so nothing can be ` +
      `classified: ${health.detail}`;
    return report;
  }

  // Read once per scan, not per message: it is one row and it cannot change
  // halfway through a run.
  const chosenModel = await emailModelChoice();

  const [connections, profiles, recipeRows] = await Promise.all([
    listConnections(),
    listProfiles(),
    sql<{ name: string }>("select name from recipes order by lower(name) limit 100"),
  ]);
  const recipes = recipeRows.map((row) => row.name);

  const mailboxes = connections.filter((row) => MAIL_PROVIDERS.includes(row.provider));
  if (mailboxes.length === 0) {
    report.blocked =
      connections.length === 0
        ? "No account is connected, so there is no mailbox to read. Connect Google or Outlook above."
        : `No mailbox is connected. ${connections.length} account${connections.length === 1 ? " is" : "s are"} ` +
          `connected (${[...new Set(connections.map((row) => row.provider))].join(", ")}), ` +
          "none of which is a Google or Outlook mailbox.";
    return report;
  }

  for (const connection of connections) {
    // Spotify lives in the same table and has no inbox behind it.
    if (!MAIL_PROVIDERS.includes(connection.provider)) continue;

    const owner = profiles.find((profile) => profile.id === connection.profileId);
    if (!owner) continue;

    const mailbox: ScanReport["mailboxes"][number] = {
      profileId: connection.profileId,
      provider: connection.provider,
      account: connection.accountEmail,
      messages: 0,
    };

    // A dead grant is a person's job, not a retry's. Scanning runs every 15
    // minutes from a scheduled task nobody watches, so it says so in the report
    // instead of filling the log with the same refusal.
    if (connection.needsReauth) {
      mailbox.note = "Sign-in expired — reconnect this account in Settings";
      report.mailboxes.push(mailbox);
      continue;
    }

    // A Google connection made without the Gmail scope has a working calendar
    // and no mailbox. Saying so beats a 403 on every scan.
    if (connection.provider === "google" && !connectionHasGmail(connection.scope)) {
      mailbox.note = "Calendar only — Gmail access was not granted";
      report.mailboxes.push(mailbox);
      continue;
    }

    try {
      // A fixed window ignores the watermark, which is the whole point of
      // asking for one: the message somebody is chasing is always behind it
      // by the time they chase it. An inspection always uses one, and a
      // filing scan does when it was asked for by a person -- pressing a
      // button means "find what was missed", not "carry on from where the
      // watermark got to". Nothing is filed twice regardless, because
      // `alreadySeen` claims each message and that is exactly its job; the
      // only messages a wider window lets through are the ones never
      // successfully judged.
      const since = options.hours
        ? new Date(Date.now() - options.hours * 60 * 60 * 1000)
        : (connection.lastScannedAt ??
          new Date(Date.now() - lookbackHours() * 60 * 60 * 1000));

      let failed = 0;
      for (const message of await fetchMail(connection, since)) {
        if (options.inspect) {
          mailbox.messages += 1;
          report.scanned += 1;
          report.messages?.push(
            await inspect(message, connection, owner, profiles, recipes, chosenModel),
          );
          continue;
        }

        // The insert is the claim: it stops a second run judging the same
        // message.
        if (await alreadySeen(connection.id, message.id)) continue;
        mailbox.messages += 1;
        report.scanned += 1;

        try {
          await judge(message, connection, owner, profiles, recipes, report, chosenModel);
        } catch (error) {
          await releaseSeen(connection.id, message.id);
          failed += 1;
          console.error(`[scan] message ${message.id}`, error);
        }
      }

      // Nothing is claimed or watermarked by an inspection, so running one
      // cannot cost the next real scan a message.
      if (options.inspect) {
        report.mailboxes.push(mailbox);
        continue;
      }

      if (failed > 0) {
        // Releasing the claim was pointless on its own: markScanned always
        // set last_scanned_at to now(), so the very message just released
        // fell outside the next run's window and was never offered again.
        // Holding the watermark is what actually makes a retry a retry.
        mailbox.failed = failed;
        mailbox.error = `${failed} message${failed === 1 ? "" : "s"} could not be classified; the window is held open so they are tried again.`;
      } else {
        await markScanned(connection.id, null);
      }
    } catch (error) {
      mailbox.error = error instanceof Error ? error.message : String(error);
      // Expected and already recorded on the connection; the next run skips it.
      if (error instanceof ReconnectRequired) mailbox.needsReauth = true;
      else console.error(`[scan] ${connection.profileId}/${connection.provider}`, error);
    }

    report.mailboxes.push(mailbox);
  }

  return report;
}
