import { spawn } from "node:child_process";

/**
 * Start the Claude Code sign-in on the wall, from a phone.
 *
 * Deliberately not the same shape as the Google Reconnect button, because it
 * cannot be. That one is a redirect through an OAuth client this app owns, so
 * the whole flow happens in whichever browser pressed it. `claude auth login`
 * is a terminal flow owned by the CLI: it opens a browser on the machine it
 * runs on and finishes on a callback to that machine's localhost. Press this
 * from a phone and the callback has nowhere to land.
 *
 * So the button does the part that can be done remotely -- starting it, with
 * no terminal and no typed command on a display that has no keyboard -- and
 * the tapping through happens on the wall, which has a touchscreen. Whatever
 * the CLI prints is captured and shown, including the URL, so a sign-in that
 * does not open a browser by itself is still finishable.
 *
 * The session this renews is the one whose silent expiry took down the
 * mailbox scan, voice capture, aisle guessing and Ask together, for days,
 * while the health probe reported "reachable" because it only ran
 * `--version`.
 */

const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** How long to collect output before answering the request that started it. */
const SETTLE_MS = 4_000;

export interface LoginState {
  running: boolean;
  startedAt: string | null;
  /** The sign-in URL, when the CLI printed one. */
  url: string | null;
  output: string;
  finishedAt: string | null;
  /** Null while running, true when the CLI exited cleanly. */
  succeeded: boolean | null;
}

let state: LoginState = {
  running: false,
  startedAt: null,
  url: null,
  output: "",
  finishedAt: null,
  succeeded: null,
};

function binary(): string {
  return process.env.CLAUDE_CLI_PATH || "claude";
}

/** The first https URL in whatever the CLI has said so far. */
export function findLoginUrl(output: string): string | null {
  const match = /https:\/\/[^\s"'<>)\]]+/.exec(output);
  return match ? match[0] : null;
}

export function claudeLoginState(): LoginState {
  return { ...state };
}

export function startClaudeLogin(): Promise<{ started: boolean; detail: string }> {
  if (state.running) {
    return Promise.resolve({
      started: false,
      detail: "A sign-in is already waiting. Finish it on the wall's screen.",
    });
  }

  state = {
    running: true,
    startedAt: new Date().toISOString(),
    url: null,
    output: "",
    finishedAt: null,
    succeeded: null,
  };

  return new Promise((resolve) => {
    // Answered by whichever comes first: a few seconds of output, or the CLI
    // exiting. Only the timer would hang the request whenever the sign-in
    // fails fast or the machine is already signed in -- and because the
    // timer is unref'd, nothing would ever wake it.
    let answered = false;
    const answer = (detail: string) => {
      if (answered) return;
      answered = true;
      resolve({ started: state.running || state.succeeded === true, detail });
    };

    let child;
    try {
      child = spawn(binary(), ["auth", "login"], {
        // On Windows the CLI is a .cmd shim, which spawn cannot exec directly.
        // No argument here comes from a request: this endpoint takes no input.
        shell: process.platform === "win32",
        env: process.env,
      });
    } catch (error) {
      state = {
        ...state,
        running: false,
        finishedAt: new Date().toISOString(),
        succeeded: false,
        output: `Could not start "${binary()}": ${error instanceof Error ? error.message : String(error)}`,
      };
      resolve({ started: false, detail: state.output });
      return;
    }

    const absorb = (chunk: string) => {
      // Capped: this is shown on a phone, and a CLI that decides to stream
      // progress forever must not become a growing string in a long-lived
      // process.
      state.output = `${state.output}${chunk}`.slice(-4000);
      state.url ??= findLoginUrl(state.output);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);

    const timer = setTimeout(() => {
      if (!state.running) return;
      child.kill();
      state = {
        ...state,
        running: false,
        finishedAt: new Date().toISOString(),
        succeeded: false,
        output: `${state.output}\n\nGave up waiting after ten minutes.`.trim(),
      };
    }, LOGIN_TIMEOUT_MS);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      state = {
        ...state,
        running: false,
        finishedAt: new Date().toISOString(),
        succeeded: false,
        output: `${state.output}\nCould not run "${binary()}": ${error.message}`.trim(),
      };
      answer(state.output);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      state = {
        ...state,
        running: false,
        finishedAt: new Date().toISOString(),
        succeeded: code === 0,
      };
      answer(
        code === 0
          ? "Signed in."
          : state.output.trim().slice(-300) || `The sign-in exited ${code}.`,
      );
    });

    // The CLI may be waiting on a browser callback for minutes, so the
    // request answers as soon as there is something worth showing rather than
    // holding a phone open for the whole flow. The GET poll carries the rest.
    const settle = setTimeout(() => {
      answer(
        state.url
          ? "Sign-in started. Finish it in the browser that just opened on the wall."
          : "Sign-in started on the wall. Watch its screen for the browser.",
      );
    }, SETTLE_MS);
    settle.unref?.();
  });
}
