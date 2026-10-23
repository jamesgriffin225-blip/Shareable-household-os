# Household coordination app

Read this before changing anything here. It is the working context for
Claude Code: what this app is, which decisions are already settled and why,
and how to debug it when something quietly does nothing.

Names in examples -- Alex and Sam -- are placeholders. The real ones come
from `HOUSEHOLD_PROFILES` and live in Postgres; nothing in the code knows who
lives in your house.

## What it is

A coordination app for two people across two phones and one wall-mounted
touchscreen. Built for a Surface, but nothing depends on that: it is a
Next.js app, Postgres, and some Windows scheduled tasks that only matter if
you deploy it the same way.

- `/capture` — a phone. One microphone button, one camera button. Say or
  photograph something and it lands in the calendar, the shopping list, the
  reminders, the recipes or the notes.
- `/today` — the other half of the phone app, one tap from `/capture`. The same
  dashboard, read for a phone.
- `/dashboard` — the wall display. A scrolling day strip and a month calendar, shopping list,
  recipes, photo frame, cameras, robots, money, the approval queue, and who did
  what. Every tile expands to fill the screen and collapses itself again.
- `/settings` — connect each person's Google and Outlook accounts.

Two installable apps, not three: `/capture` and `/today` share one manifest and
one home-screen icon, and `/dashboard` has its own.

## How it is deployed

Self-hosted on the Surface, not Vercel. `npm start` behind `tailscale serve`
for HTTPS, local Postgres, a scheduled task at log on. See the "Self-hosting
instead" section of README.md.

## When something here silently does nothing

Read this before debugging anything in this app. It was written after a week
spent on a mailbox scanner that was working correctly the whole time: an
expired Claude Code sign-in was being converted into a successful empty
result. The fault was one `catch` block. Everything else was the reason
nobody could see it, and that is what this section is about.

**Expect lost evidence, not broken logic.** Every defect in that week was the
same shape -- something caught, filtered, truncated or defaulted, and
reported success. Before theorising about behaviour, go and find the discard:

- `catch` blocks that return an empty or default value instead of raising
- `?? []`, `Array.isArray(x) ? x : []`, `.filter(isKnown)` over parsed output
- `.slice(0, n)` on an error string; the reason often sits past the counters
- `console.error` on a machine whose console nobody can ever see
- a required field read and then skipped, as `no_action`'s `reason` was
- a watermark or a claim advanced whether or not the work actually succeeded

**A check must be able to fail the way the thing it checks fails.** The health
probe ran `claude --version`, which needs no account, so it reported
"reachable" for days while every call failed to authenticate. Replacing it
with `claude auth status` repeated the mistake one subcommand along: that
confirms a credential exists on disk, and the token behind it was expired.
The only thing that cannot be wrong about whether calls work is a call.
Prefer recorded evidence from the real path over any probe.

**Instrument at the boundary, not at the screen.** Four rounds of better error
display changed nothing, because the error was being swallowed two layers
below all of them. Find the outermost point where the information still
exists and start there.

**Delete indirection before instrumenting it.** Scan now went app to
scheduled task to PowerShell to HTTP back to the same app. Three of those
hops were instrumented before anyone asked why they existed.

**Do not dismiss a signal because you assume you know where it came from.**
"Inference: not reachable" was on screen in the first screenshot of the week
and was waved away three times as an artefact of a test stub. It was real.
Check instead of assuming.

**Get the decisive reading before shipping a hypothesis.** Fixes went out for
the prompt wording and then the model alias. Both were wrong and both cost a
deploy cycle, which is ten minutes of somebody's evening plus a build on slow
hardware. One push that makes the fault state itself beats three that each
narrow it slightly.

**A test can encode the defect.** One asserted `{ calls: [], reply: "" }` on
failure, codifying the very swallow that caused all of this, and it passed
happily throughout. When a test documents behaviour that reads oddly, ask
whether the behaviour is right before preserving it.

**Changes to the deploy mechanism land one release late.** PowerShell parses a
`.ps1` in full before executing it, so the run that delivers a change to
`update.ps1` is still running the previous version of it.

**The display has no keyboard.** Anything configurable only through
`.env.local` cannot be changed, ever, however wrong it proves to be. It
belongs in `app_state` and on the Settings screen.

## Decisions that are not up for casual revision

Each of these was argued through and has a real reason. Change them only with
a reason that engages with the original one.

- **`CLAUDE_BACKEND=cli` in production here.** The Surface runs a signed-in
  Claude Code, and shelling out to `claude -p` avoids an API key. The `api`
  backend is the alternative, one env var away, and both produce identical tool
  calls. Never "simplify" by deleting one of them.
- **Structured output, not `tool_use`, is the contract.** `runToolCall`
  validates and normalises everything it is handed, which is exactly why a
  parsed JSON object from the CLI backend and a `tool_use.input` from the API
  backend are interchangeable. Keep that executor defensive.
- **The CLI backend's prose tool list is generated from `HOUSEHOLD_TOOLS`.**
  Never hand-write it; the two backends would drift on the first new field.
- **Money figures are hidden by default, every load.** The eye is for guests in
  the kitchen; a toggle that remembers "shown" is a toggle that has stopped
  doing its job. Names and structure stay on screen so the tile still reads as
  itself.
- **Pocketsmith accounts are chosen by id, never by name.** Two accounts here
  both begin "Personal Account" and two are credit cards; a name match picks one
  of each pair and looks right while being wrong.
- **A balance is dated by the feed that wrote it, never by the account
  record.** Banks report to Pocketsmith a few times a day, so a figure on the
  wall is routinely eight to twelve hours old and looked live, because
  `current_balance_date` is a DATE -- it said "today" for a balance the bank
  last sent at 9:17 that morning. The account's own `updated_at` is worse: it
  moves when the record changes and reads as a month ago on a healthy feed.
  The stamp that means anything is the newest `updated_at` among the
  `transaction_accounts` underneath. Shown per account, on the line each one
  already has: the money tile has no spare room, and a line added under the
  accounts is clipped at every width while one in the header wraps the tab
  strip and clips the third account.
- **Category spending excludes transfers.** Moving money to the offset account
  is not spending it, and counting it makes the largest row on the page a
  fiction.
- **An expanded tile collapses after twenty seconds, with the count visible.**
  The person who expanded it is not usually the person who finds it. The
  countdown is shown because a panel that moves on its own and does not say so
  reads as a fault.
- **The day strip opens two days back and four forward, not Monday to
  Sunday.** A wall is asked "what is on today, and what is coming" far more
  often than "what did Monday look like", and a Monday-to-Sunday grid spends
  five of its seven columns on the past by Sunday afternoon. It is still seven
  columns filling the panel; they just start two days ago.
- **The strip scrolls the viewport, never the fetch.** Six weeks are rendered
  and one is shown, so swiping through a fortnight is not a fortnight of
  requests to Google -- the events are already in hand. The header names what
  is ON SCREEN, which is why `rangeLabel` takes the leftmost visible day and
  not the anchor. Past the rendered edge, the month view is the better tool,
  and saying so beats an infinite strip that fetches forever.
- **The money tile has its own period type.** It used to borrow the calendar's
  view type, which was fine while that read "week" | "month" and broke the
  moment the calendar stopped being a week. How the wall displays days and how
  far back spending is added up were never the same question.
- **Calendar ranges are computed on `YYYY-MM-DD` day-keys, not instants.**
  "The week containing the 8th" is a question about a calendar, not a moment;
  doing it in `Date`s means passing a timezone through every function and being
  a day out in one of them. See `calendar-range.ts`.
- **"fetch failed" is not a diagnosis.** Node reports every transport
  problem as `TypeError: fetch failed` and puts the reason in `error.cause`,
  so the usual `error.message` gives two words that rule nothing out. On a
  home network the difference is the whole answer: `ECONNREFUSED` is a dead
  service on a reachable machine, `ENOTFOUND` is a `.local` name that mDNS
  did not carry across a VLAN, `ETIMEDOUT` is a firewall, and a `CERT_*` code
  is a trust problem -- four faults, four different fixes, one sentence.
  `describeFetchFailure` unwraps the cause chain, names the code in words,
  and says which origin was dialled, since a wrong address is the commonest
  cause and identifies itself the moment it is printed. Only the origin:
  a path or query string can carry a token and this string reaches a screen
  and a log. Used by the Home Assistant client; the other HTTP clients
  should adopt it as they are touched.
- **A tile is hidden by what it knows, never by what it failed to learn.**
  The robots tab was gated on `configured && robots.length > 0`, so a Home
  Assistant that could not be reached returned an empty list and the tab
  deleted itself -- taking with it the error banner in `Robots.tsx` written
  for exactly that case, which nobody could reach because reaching it needed
  the tab. "There are no robots here" and "I could not ask" are different
  answers and the wall showed neither. The second clause now tolerates an
  error, so a house with no vacuum still gets no tab, which was the original
  intent, while a house whose vacuum cannot be read gets told why. Cameras
  had it right already: `configured` is the only gate.
- **Robots and cameras share one Home Assistant client** (`homeassistant.ts`).
  The two robot domains are mapped onto one set of buttons in `robots.ts`,
  because HA names the same three actions differently for a vacuum and a mower.
- **The service worker never caches a page.** A cached page names its
  JavaScript by content hash and a deploy replaces every one of them, so the
  cached page outlives the files it asks for: the wall shows last week's build,
  or nothing at all. That cost three separate debugging sessions. It keeps the
  icons and manifests, which make it installable, and an offline notice with no
  build in it. Everything on screen comes from `/api` anyway, which was never
  cached, so an offline page was only ever an empty frame.
- **Playlists live in Postgres, edited from the Music tab.** `SPOTIFY_STATIONS`
  only seeds an empty install. Adding music to a kitchen wall must never mean
  editing a file and restarting a server — if a feature's setup lives in
  `.env.local`, it does not get used.
- **Six tabs wrap; they do not scroll and must never be clipped.** A nowrap
  strip overflows the panel silently, so the most recently added tab is the one
  nobody finds. Checked at 1280, 1368 and 1600 wide.
- **The music player is never unmounted, and never re-parented.** Moving an
  iframe in the DOM destroys its document, and silence is the one thing a music
  player must not do when you look at the shopping list. It is moved with CSS
  instead: on the Music tab it is an ordinary pane, off it the SAME element is
  fixed to a corner with everything but the player hidden. One element, two
  places.
- **Which is why the floating player can be paused and skipped.** It used to be
  a separate strip that could only say what was playing, because the controls
  that would make it useful are Spotify's own: the Web API's pause and skip act
  on a Spotify Connect device, which an embed is not, and the embed's iframe
  API has no next or previous at all. Move the embed and its transport comes
  with it. Do not "simplify" this back into a strip that renders track
  metadata.
- **The dock is never `display: none` while it floats.** A fixed-position
  descendant of a hidden subtree renders nothing at all, so "not on the Music
  tab" cannot mean hiding the pane. It is hidden only when the floating player
  is not wanted either.
- **The drag handle is ours because the player is not.** Below the titlebar is
  a cross-origin iframe, so a pointer over the player belongs to Spotify and
  never reaches this page. Pointer capture is taken on the bar, which is where
  the handlers are -- capturing on the dock instead retargets every later move
  and the drag dies on its first pixel -- and the expand button stops the press
  propagating, because a captured pointer does not reliably produce a click on
  the element underneath.
- **One quiet poll does not retire the floating player.** Spotify reports a track
  change, a seek or a buffer as nothing playing; believing the first such read
  pulls the player out from under the finger that is touching it, which is
  indistinguishable from it being broken. It has to stay quiet for 25 seconds.
- **Spotify is an embed, never the iframe API.** Calling the embed's `play()`
  or `resume()` is documented to start 30-second preview playback even for a
  signed-in Premium listener, while the embed's own controls play the whole
  track. So the page renders the player and does not touch it. There is no
  OAuth here and none is wanted.
- **A web page cannot connect a Bluetooth speaker.** Pairing and output routing
  belong to the operating system, and Web Bluetooth reaches low-energy data
  devices only, never A2DP audio. The Music tab links to the two Windows panels
  that do own it. Do not "fix" this with `navigator.bluetooth`.
- **Live view goes through the proxy; everything else about the cameras goes
  through Home Assistant.** HA has never supported Blink live streaming,
  because Blink does not serve RTSP — live view returns `immis://`, Amazon's
  own framing, which ffmpeg and go2rtc cannot read. The proxy is the one thing
  that speaks it. It is optional: a proxy that is down costs the stills
  nothing, by construction in `/api/cameras`.
- **The proxy's token never reaches the browser.** The HLS playlist and its
  segments are re-served from our own origin, which also means the phone can
  watch over Tailscale — it has no route to port 8088 on the Surface.
- **Cameras go through Home Assistant, never Blink directly.** Blink has no
  public API and its current client authenticates by scraping a sign-in page.
- **Gmail is opt-in (`GOOGLE_ENABLE_GMAIL`).** `gmail.readonly` is a restricted
  scope; requesting it pins the OAuth app in testing mode, where refresh tokens
  expire weekly. Asking for it costs the calendar, which is what the household
  actually wanted.
- **A dead refresh token is an outcome, not an error string.** `invalid_grant`
  (and Entra's `interaction_required`) mean no retry will ever work, so the
  connection is flagged `needs_reauth` in Postgres and the panel shows a
  Reconnect button for that person instead of printing what Google said. The
  flag matters as much as the wording: the wall re-reads the calendar every few
  seconds, and without it every one of those polls re-asks a token endpoint
  that will keep saying no. Reconnecting clears it; so does any refresh that
  succeeds.
- **The calendar is never cached in Postgres.** It lives in Google and is read
  and written live.
- **Claude is asked for wall-clock times, never offsets.** A dictated "six
  o'clock Thursday" has no offset in it; `HOUSEHOLD_TIMEZONE` resolves it.
- **The phone is one installed app containing two screens.** `/capture` and
  `/today` share `capture.webmanifest`, so walking between them stays inside the
  same home-screen app. A second icon would make you choose which half of the
  household you wanted before you knew.
- **`Dashboard` has a `variant`, rather than a second component.** The phone
  reading turns off everything that belongs to a wall — wake lock, screensaver,
  evening dim — and polls at 8s instead of 2.5s. Fork it into two components and
  every fix has to be made twice.
- **iOS uses keyboard dictation, not the Web Speech API.** `webkitSpeechRecognition`
  is present on iOS and does nothing in an installed PWA, so the choice is made
  by device (`dictation.ts`) rather than by feature detection. Do not "fix" this
  by re-adding a capability check.
- **iOS gates the microphone behind a secure context.** Over plain HTTP the
  capture screen's whole purpose silently does nothing. HTTPS is a requirement,
  not a nicety.
- **A ticked to-do drops below the open ones, and can be removed outright.**
  A finished job that keeps its place is still competing for the eye with the
  ones that are not done. Within the done group the most recently ticked sits
  first, because that is where an undo goes looking. Removing has no
  confirmation step -- a second press on every tap would make clearing a
  finished list tedious enough that nobody would -- so the safety net is the
  activity feed instead: the removal is logged with an undo and "Lately" puts
  it back.
- **Scheduling a to-do does not finish it.** Putting a job on a calendar is
  not doing it, and quietly clearing the list because a date got picked is the
  kind of surprise that stops people trusting a button. It stays on the list;
  there is a remove on every row if that is what was wanted.
- **The schedule sheet defaults to all day, with the time as the option.** A
  job is not a meeting -- "call the plumber" is not nine to ten -- and the
  whole day is the only one of the two that can be filled in without typing.
  The date defaults to the due date, or today when there is not one.
- **It goes through `runToolCall`, not a second calendar path.** The same
  executor the voice capture and the mailbox scanner use, so the activity
  entry, the undo and the "whose calendar" resolution are the ones that already
  exist rather than a second set that drifts from them. Forced, because a
  person pressed a button rather than a model guessed.
- **Ticking a shopping item keeps it visible for five seconds with an undo**,
  on every screen, and the server holds it a beat longer so a second screen
  never drops it mid-animation.
- **Asking is read-only by construction, not by instruction.** `/api/ask`
  hands the model a briefing and gets prose back; no tool call comes out and
  nothing in that path can write. "When are we next free?" must never be a
  route to moving an appointment, and the way to guarantee that is to give the
  question no machinery rather than to ask it nicely in a prompt.
- **The briefing names every day, including the empty ones.** "When do we next
  have a free Saturday afternoon?" is a question whose answer is a day that is
  *not* in the event list. Handing over only what is booked and hoping the gap
  gets noticed is a guess; a day that reads `(nothing on)` is a fact. A
  calendar that could not be read is named in the answer too -- "you're free on
  Saturday" is a different claim when one of the two diaries was unreadable.
- **Add and Ask are chosen, never inferred.** "Do we need milk" and "we need
  milk" are one character apart and mean opposite things; guessing wrong either
  files a shopping item nobody asked for or answers a question instead of doing
  what was said. Two buttons beat the guess.
- **The email model is sonnet, and it is chosen in Settings, not in a file.**
  It was `CLAUDE_CLI_EMAIL_MODEL=haiku`, put there as a cost lever for the
  high-volume path. Cost per token is an API-backend idea: the CLI backend
  shells out to a signed-in Claude Code, where the constraint is the
  subscription's allowance and not a bill, so haiku was saving money that was
  never being spent and paying for it in the one judgement the whole feature
  rests on -- whether an email is something this household needs. It misread
  a dated invitation as chatter. The CLI backend no longer reads that
  variable at all; the API backend still does, where the saving is real
  money. Sonnet rather than the main model, usually opus, because every
  `claude -p` carries Claude Code's own system prompt and costs roughly 35k
  tokens before ours is counted -- at a few dozen messages a day that
  allowance is worth protecting. The household's own choice lives in
  `app_state` and outranks both, for the same reason playlists do: a setting
  that can only be edited by typing on a wall-mounted machine is a setting
  nobody will ever edit, however wrong it proves to be. The route accepts
  only the names the screen offers, because the value reaches a subprocess
  as `--model`.
- **Email may only auto-execute small, dated, reversible things.** A recipe or a
  bulk list arriving unread is what makes people stop trusting a scanner.
- **An exit code is not a diagnosis: read the failure envelope.** `runCli`
  built its error from stderr alone, so a CLI exiting non-zero while
  reporting the reason on stdout -- exactly what `--output-format json` asks
  it to do -- produced a bare "Claude CLI exited 1" with the answer sitting
  in a variable three lines up. Quoting the raw stdout was not enough
  either: that envelope leads with timing and token counters and carries the
  sentence worth reading in `result` several hundred characters in, so a
  truncated quote showed a wall of zeros and cut off the reason.
  `describeCliFailure` parses it the way `readEnvelope` already parsed the
  success case -- `result`, then `error.message`, then `subtype` -- and
  falls back to stderr and then raw text. The message names the model too,
  and the health probe reads stderr now as well.
- **The settings screen names the model the active backend will use.** It
  was `CLAUDE_MODEL` regardless, under a comment promising the opposite:
  that is the API backend's variable, and a machine running
  `CLAUDE_BACKEND=cli` takes its model from `CLAUDE_CLI_MODEL`. So the
  screen displayed, with confidence, a model the machine was not using.
  `activeModel()` reads the live backend's variables and names the email
  model when it differs, because the high-volume path is deliberately a
  cheaper model and so the likeliest to be set to something unusable.
- **A failed classification is an error, never an empty success.**
  `classifyEmail` caught everything and returned `{ calls: [], reply: "" }`,
  reasoning that an unattended scan must not stop at one unreadable message.
  The reasoning is right and the protection already existed one level up, in
  `scanMailboxes`, which catches per message, releases the claim, counts the
  failure and holds the watermark. This was a second, worse copy that threw
  the reason away first -- so a dead `claude -p` arrived downstream as a
  successful classification containing nothing, which is indistinguishable
  from a model that read the email and decided it needed nothing. That single
  lie survived five rounds of debugging and made three separate improvements
  to the display useless, because the failure never reached any of them. The
  API backend's silent `refusal` return was the same trap and now names
  itself.
- **Health is evidence from real calls, not a probe.** It ran `claude
  --version`, which needs no account, so it reported "reachable" for days
  while every call failed with "Failed to authenticate: OAuth session expired
  and could not be refreshed". Replacing that with `claude auth status` was
  the same mistake one subcommand further along: it still went on saying
  reachable, because it confirms a credential exists on disk and the token
  behind that credential was expired and unrefreshable. A check that cannot
  fail the way the thing it checks fails is not a check, and the only thing
  that cannot be wrong about whether calls work is a call. `runCli` records
  every failure and clears it on success; `health()` believes a recent one
  over any probe, quotes it, and goes red. `auth status` is still asked and
  an explicit "logged out" is still believed, but when its answer is not
  recognised the raw text is shown rather than taken as fine -- an
  unrecognised shape treated as healthy is how this hid in the first place.
  An older CLI without the subcommand still counts as healthy: refusing to
  scan because a probe is unfamiliar is a worse failure than the one being
  prevented.
  The evidence lives in the app's memory, so a deploy clears it and the row
  shows the probe's opinion until the next real call -- at most fifteen
  minutes, or one press of Scan now.
- **Settings can start the sign-in, but cannot finish it.** The button is
  deliberately not the same thing as the per-person Reconnect buttons above
  it, however alike they look. Those redirect through an OAuth client this
  app owns, so the whole flow happens in whichever browser pressed them.
  `claude auth login` is the CLI's own flow: it opens a browser on the
  machine it runs on and completes on a callback to that machine's
  localhost, and it has no headless or paste-a-code mode. Pressed from a
  phone, the callback has nowhere to land. So the button does the half that
  can be done remotely -- starting it, with no terminal and no command typed
  on a display with no keyboard -- and the tapping happens on the wall,
  which has a touchscreen. Whatever the CLI prints is captured and shown,
  the URL included, so a sign-in that fails to open a browser is still
  finishable. It takes no command from the caller, only "go", exactly as the
  update button does.
- **The CLI backend's sign-in expires, and nothing renews it.** Running
  against a signed-in Claude Code is what avoids an API key, and the price is
  an OAuth session that lapses and can only be renewed by a person at that
  machine -- which is wall-mounted with no keyboard. Everything using
  inference goes down together when it does: the mailbox scan, voice and
  photo capture, aisle guessing and Ask. If this becomes a recurring chore,
  `CLAUDE_BACKEND=api` with a key is the alternative that does not expire,
  at the cost of a bill per token.
- **A backend that cannot run is reported once, before anything else.**
  `backendHealth()` existed and nothing on the scan path called it, so a dead
  CLI was learned about N times, once per message, in identical and
  uninformative form. It is asked before the database too, because it depends
  on nothing: a backend that is down should be named even when something
  further in is also broken.
- **The parser says what it threw away.** `readActions` discarded three
  different things in silence: a reply that parsed as JSON but carried no
  `actions` array, an entry that was not an object, and an action name that
  is not a tool. All three arrived on screen as "the model decided nothing
  was needed", which is a different claim, and no retry fires either --
  the JSON was valid, so nothing complained. That one ambiguity survived
  five rounds of debugging. `ParseResult.dropped` names each one, with the
  keys that were actually present, and the inspection prints it. The
  model's `reply` is shown too, since prose instead of actions lands there.
  Diagnostic only: nothing downstream branches on it, and a clean parse
  stays silent.
- **`no_action` carries a reason, and it must be shown.** The tool requires
  one -- "one short line for the person" -- and every caller dropped it on the
  floor: `judge` skips the call, and the first version of the inspection
  copied that skip. So the scanner declined to file things while explaining
  itself, in writing, into nothing, and two rounds of guessing at the prompt
  from the outside followed. The inspection keeps the verdict and the screen
  prints the model's own sentence rather than a summary of it. A message with
  no calls and no reason now reads differently from one that gave a reason,
  which separates "the model declined" from "the backend returned nothing".
- **A dated invitation is never `no_action`.** `EMAIL_RULES` listed "event
  invitations" as actionable and "social chatter" as not, said nothing about
  which wins for a casual invite, and put all of its weight behind silence
  ("most email is this"). A real invitation with a date, a time and a venue
  came back `no_action`, which from the kitchen is indistinguishable from the
  email never arriving. The conflicting term is gone and the case is defined:
  chatter is talk with no commitment in it, and an email naming a time
  somebody could turn up to is not chatter however casually it is written --
  including one a person sent to themselves, which is what people do with
  things they are trying not to forget. Unsure now means propose at low
  confidence, not drop: the approval queue makes a wrong guess cost one tap,
  while a silent miss costs the evening and is never discovered. This also
  settles a disagreement between two prompts in the same file -- `PHOTO_RULES`
  has always said a parked item beats a silent miss, and email was saying the
  opposite about the same household's post.
- **The updater is a scheduled task, not part of the app.** A deploy that runs
  inside the app can only fix a build that still starts, which is exactly the
  situation you are not in when you need it. Being a separate task means a bad
  build is recovered by pushing a good one and waiting, with nobody at the
  machine -- and there is no keyboard on the machine.
- **The update endpoint takes no command, only "go".** It starts one named
  scheduled task through `execFile`, so nothing from a request reaches a shell.
  An endpoint that runs what it is given is a remote shell on the house, and
  the passcode is the only thing in front of it.
- **The wall rests its screen, not itself, from 11pm to 5am.** A Surface cannot
  power itself back on -- its firmware has no wake alarm -- so a nightly
  shutdown means a dark wall until somebody presses the button, and sleep on
  this hardware generation resumes unreliably and would stop the mailbox scan
  and the updater. Six hours rather than two because hours are the weaker half
  of the argument: an ageing backlight dims, it does not flicker, and flicker
  points at the driver board, where capacitors age with heat and last roughly
  twice as long for every ten degrees cooler they run. `rest-screen.ps1` turns
  the display off only while `GetLastInputInfo` says the session is idle, so a
  window that spans the evening costs nothing -- touch the wall and it behaves
  like an ordinary screen timeout. The wake is in a `finally`, so ending the
  task cannot leave the wall dark.
- **The power settings are applied by the machine, as the display account.**
  They used to be printed as four `powercfg` lines to run in an administrator
  window, and the wall slept anyway: power schemes are per-user, elevation
  switches account here, and so the settings landed on a user who never shows
  the dashboard. `powercfg /change` has never needed administrator for your own
  scheme, so that was wrong on two counts. They sit in `tasks.ps1` beside the
  tasks and are re-asserted after every build, because Windows Update resets
  power plans and "set correctly once" is not the same claim as "set correctly
  now". Only the AC side: on battery a wall-mounted Surface should still behave
  like a laptop, and a mains failure long enough to matter is one where
  sleeping is the right answer. Settings reads the plan back with `powercfg /q`
  rather than reporting what was sent, because the whole fault was a machine
  that had been told and had not listened.
- **The mailbox scanner logs what it found.** It used to write its report to
  stdout from a task registered `-WindowStyle Hidden`, so the one subsystem
  built to run unattended was the only one that never said what it did. "No
  email arrived", "the mailbox is not connected" and "the scan never ran" were
  indistinguishable from the kitchen, and an email that reached the inbox and
  produced nothing could not be told from any of them. It writes
  `C:\household\scan.log` on the same terms as `update.log` -- tail-trimmed,
  UTF8, one line a run -- and Settings parses the last line into a row per
  mailbox, each carrying its own skip reason. Failures are logged too: "the
  app was still starting" is a real and harmless cause, and it is also
  indistinguishable from a dead mailbox until somebody can read which it was.
  The raw body is logged exactly as the server wrote it (`Invoke-WebRequest`,
  not `Invoke-RestMethod`), because a PowerShell JSON round trip collapses a
  one-element array into a bare object and that parser bug would get blamed on
  the scanner.
- **The helper scripts the tasks run are written by `tasks.ps1`, not by
  `setup-appliance.ps1`.** Same lesson as the tasks and the power settings,
  for the third time: a file written once at setup can only be changed by
  somebody typing on the machine that deliberately has no keyboard. So the fix
  for a scanner that logged nothing was unreachable by the very mechanism
  built to make things reachable. The updater rewrites both every build, which
  makes them whatever the commit says they are.
- **Scan now runs the scan in this process, not through the scheduled task.**
  It used to start a Windows task, which launched PowerShell, which read a
  secret out of `.env.local`, which made an HTTP request back to this same
  process -- so the app asked itself, over the network, to do something it
  was sitting right next to. Every hop could fail silently on a machine
  nobody can log into, and between them they hid the answer to "why did
  nothing arrive" through three separate attempts at finding it. The button
  calls `scanMailboxes()` directly and reports what came back, errors
  included. It is started rather than awaited -- a scan is a model call per
  message -- and the screen polls every three seconds while one is in flight.
  The scheduled task stays for the unattended path: it runs every fifteen
  minutes and survives the app being down, which is exactly when you want it.
- **An empty scan has to say which kind of empty it is.** No model backend,
  no connected account, accounts connected but none of them a mailbox, and a
  genuinely quiet morning all produced a byte-identical `{0, 0, 0, []}`. Only
  the last is reassuring and the screen showed the reassuring reading for all
  four, so an email that reached the inbox and vanished looked exactly like
  no email arriving. `ScanReport.blocked` names the reason, the guard runs
  before the walk, and Settings shows it in place of the count.
- **Scan now looks back a day; the scheduled task keeps its watermark.**
  Resuming from `last_scanned_at` is right for a job running every fifteen
  minutes and wrong for a person pressing a button: by the time anyone
  presses it, the watermark has already passed whatever made them press it.
  That is not hypothetical -- the message this entire episode was about sat
  behind the watermark for days, so a filing scan could never have reached
  it however well the classifier worked. Safe because `alreadySeen` claims
  every message, which is precisely its job: a wider window lets through
  only the ones never successfully judged, and files nothing twice.
- **A message gets one chance, so there is a way to ask again.** The normal
  path claims a message with `alreadySeen` the moment it reads it, and the
  watermark moves past it either way. So by the time somebody asks why an
  email produced nothing, the message is behind the watermark, already
  claimed, and the judgement that was made about it was never written down
  anywhere. **Re-read 24h** classifies a fixed window again and reports what
  the model makes of each message -- the calls, their confidence, and whether
  a real scan would have filed them -- while executing nothing, queueing
  nothing, claiming nothing and leaving the watermark alone. A test asserts
  all four, because a diagnostic that files a duplicate is worse than no
  diagnostic.
- **Holding the watermark is what makes a retry a retry.** `releaseSeen` on a
  failed message was pointless on its own: `markScanned` wrote `now()`
  regardless, so the message it had just released fell outside the next run's
  window and was never offered again. A mailbox with a failure now keeps its
  watermark, so the window stays open, and the count is reported rather than
  going to a console on a machine with no keyboard.
- **The machine configuration is applied before the "nothing to build" exit,
  not after it.** PowerShell parses a `.ps1` in full before running a line of
  it, so the run that deploys a change to `update.ps1` is still executing the
  previous version. A call added to the configuration block therefore does
  nothing on the build that delivers it -- and when the block sat after the
  early exit, the next run had nothing to build and never reached it either.
  That shipped a commit the machine never applied, with `update.log` and the
  Settings screen both reporting a successful update. Doing it every ten
  minutes costs two small files, five idempotent task definitions and four
  `powercfg` calls, and it stays silent, so the quiet path is still quiet.
- **The scripts are parsed by a real PowerShell, where one exists.** Reading
  them is not enough: `tasks.ps1` writes `scan-email.ps1` out of a
  here-string, so the outer file parsing cleanly says nothing about the script
  it generates -- and that one runs unattended, where a syntax error looks
  exactly like a scan that never happened. The test generates the helpers into
  a temporary root and parses those too. It skips where `pwsh` is absent;
  `PWSH=/path/to/pwsh npm test` turns it on.
- **The scheduled tasks are defined once, in `tasks.ps1`, and the updater
  registers them after every build.** Registering a new task otherwise means
  typing on a wall-mounted display with no keyboard. Registration is
  idempotent, so almost every build rewrites the same definitions and changes
  nothing, and a failure there is logged rather than fatal -- a task set one
  commit behind is worth far less than the build going out.
- **Every control on the phone is at least 44px.** The phone reading was the
  wall's layout stacked, which fitted but was sized for a finger on a 13"
  display at arm's length: an audit at 393px found the profile chips at 26px,
  the tabs at 29 and the agenda rows at 39. The hit area grows, the visual
  weight mostly does not, and the panels keep their 68vh cap -- six panels each
  wanting a full screen is a scroll with no landmarks in it.
- **Wall furniture does not go on the phone.** The full-screen button does
  nothing in an installed PWA, and expanding a panel is meaningless when it is
  already the full width -- "fill the screen" is what scrolling does, and the
  button sits exactly where a thumb reaches to scroll.
- **One light theme, warm paper rather than white.** Accents are the darkened
  text-safe versions because the person colours carry names in the activity
  feed, not just dots.

## Working on it

```bash
npm run check     # tsc --noEmit, tests, eslint — run before every push
npm run build
```

- `db/schema.sql` is the source of truth for the schema. After editing it, run
  `npm run schema` to regenerate `src/lib/schema.generated.ts`; a test fails if
  they drift.
- The schema applies itself idempotently on first request. There are no
  migrations to run.
- Tests are `node --test` with type stripping, so **relative imports inside
  `src/lib` need explicit `.ts` extensions**. Alias imports (`@/lib/...`) do not.
- Nothing in `tests/` touches a live service. The CLI backend is exercised
  against a stand-in binary; Home Assistant against its documented shapes.

## Layout

```
src/lib/          tools.ts (the vocabulary shared by capture and email),
                  llm/ (prompts plus the api and cli backends behind one
                  interface), actions.ts (execute / queue / undo),
                  scan.ts (mailboxes), google.ts, microsoft.ts,
                  pocketsmith.ts, cameras.ts, time.ts, db.ts, state.ts
src/app/api/      one route per thing the screens do
src/components/   Capture/ and Dashboard/ (Dashboard/Money/ for the money tile)
src/styles/       one stylesheet, one committed look
db/schema.sql     source of truth for the schema
```

## Making the wall machine an appliance

**Anything in `scripts/*.ps1` is ASCII only.** Windows PowerShell 5.1 reads a
`.ps1` as ANSI unless it carries a byte-order mark, so a UTF-8 em dash becomes
three mojibake characters and the parser dies -- reporting a missing brace
eighty lines further down. House style loses to the parser here.


`scripts/setup-appliance.ps1`, run **as the display account and NOT elevated**
-- elevation switches user on that machine, and a task registered by the wrong
account never runs for the right one. It writes the two helper scripts, and
applies everything in `tasks.ps1`: the scheduled tasks and the power settings.
Folder ownership and Windows Update hours genuinely need administrator and are
printed at the end to run separately, rather than half succeeding from the
wrong account.

The scan task covers whoever is connected: `scanMailboxes()` walks every
connection row, so a mailbox added later joins the schedule with no change here.

## Shipping a change to the Surface

**Push, and wait.** The display is wall-mounted with no keyboard, so there is
nobody at a prompt. "Household update" runs `scripts/update.ps1` every ten
minutes: it fetches the branch the machine tracks, and when the commit has
moved it fast-forwards, runs `npm ci` only if the lockfile did, builds, and
restarts the app task. With nothing new it compares two hashes and stops
without writing a line.

Settings shows the commit it is running and has an **Update now** button, so a
phone can force it and read the tail of `C:\household\update.log` while it
works.

By hand, in a window where you can see it:

```
powershell -ExecutionPolicy Bypass -File C:\household\scripts\update.ps1 -Force
```
