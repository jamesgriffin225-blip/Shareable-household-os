"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProfileGate from "@/components/ProfileGate";
import { useCalendar, useHouseholdState, useMoney } from "@/lib/client/api";
import { useIdle } from "@/lib/client/idle";
import { initials, useProfile } from "@/lib/client/profile";
import ActivityFeed from "./ActivityFeed";
import ApprovalQueue from "./ApprovalQueue";
import Cameras, { useCameras } from "./Cameras";
import Fullscreen from "./Fullscreen";
import { useMusic } from "./Music";
import MusicDock from "./MusicDock";
import { useNowPlaying } from "./now-playing";
import QuickCapture from "./QuickCapture";
import MoneyCard from "./Money/MoneyCard";
import Calendar from "./Calendar";
import CalendarAgenda from "./CalendarAgenda";
import Tile, { useTiles } from "./Tile";
import { addDayKeys, type CalendarView, viewRange } from "./calendar-range";
import PhotoLibrary from "./PhotoLibrary";
import Recipes from "./Recipes";
import Reminders from "./Reminders";
import Robots, { useRobots } from "./Robots";
import Screensaver from "./Screensaver";
import ShoppingList from "./ShoppingList";

/**
 * One dashboard, two readings.
 *
 * "wall" is the tablet: full-height grid, screen held awake, photographs after
 * a few idle minutes, dimmed late. "phone" is the same household on a device
 * that lives in a pocket — so it stacks, polls more slowly, and does none of
 * the wall behaviours, all of which would be battery bugs on a phone.
 */
export default function Dashboard({
  timeZone,
  variant = "wall",
}: {
  timeZone: string;
  variant?: "wall" | "phone";
}) {
  const wall = variant === "wall";
  const {
    profiles,
    profile,
    profileId,
    choose,
    ready,
    error: profileError,
  } = useProfile();
  const { state, error, refresh } = useHouseholdState(wall ? 2500 : 8000);
  const tiles = useTiles();
  const [now, setNow] = useState(() => new Date());

  // Today in household time, as a day-key. Everything the calendar does is
  // arithmetic on these, so it is worked out once here and passed down.
  const todayKey = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now),
    [now, timeZone],
  );

  const [view, setView] = useState<CalendarView>("days");
  const [anchor, setAnchor] = useState(todayKey);

  // The wall pages through weeks and months; the phone's agenda is always the
  // next seven days from today, so it asks for a different range entirely.
  const range = useMemo(
    () =>
      wall
        ? viewRange(view, anchor)
        : { from: todayKey, to: addDayKeys(todayKey, 6) },
    [anchor, todayKey, view, wall],
  );
  const calendar = useCalendar(range);
  const money = useMoney();
  const cameras = useCameras();
  const robots = useRobots();
  const music = useMusic(profileId);
  // Whether there is anything to keep playing. Opening the tab is the only
  // signal available — the embed will not tell us it was pressed — so it is
  // corrected by what Spotify says is actually playing, when that is granted.
  const [musicOpened, setMusicOpened] = useState(false);
  const [tab, setTab] = useState<
    "shopping" | "recipes" | "photos" | "music" | "cameras" | "robots"
  >("shopping");
  const [preview, setPreview] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab === "music") setMusicOpened(true);
  }, [tab]);

  // `/dashboard?tab=cameras&expand=1` opens straight on a tab, filling the
  // screen. It is how the living-room TV's Cameras and Robots tiles land on the
  // right panel: a TV remote reaching a tab by arrowing round the wall's
  // layout is several presses for what should be one. Read once, on arrival;
  // after that the tabs behave as they always have.
  const { expand: expandTile } = tiles;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tab");
    if (
      wanted === "shopping" ||
      wanted === "recipes" ||
      wanted === "photos" ||
      wanted === "music" ||
      wanted === "cameras" ||
      wanted === "robots"
    ) {
      setTab(wanted);
      if (params.get("expand") === "1") expandTile("lists");
    }
  }, [expandTile]);

  // Only whether anything is playing: what is playing is the embed's business
  // now that the embed is the floating player.
  const { sounding } = useNowPlaying(profileId, musicOpened);

  // Keep the screen awake — this is a wall display, not a laptop. A phone,
  // though, is a laptop: it gets to sleep.
  useEffect(() => {
    if (!wall) return;
    let sentinel: any = null;
    const request = async () => {
      try {
        sentinel = await (navigator as any).wakeLock?.request("screen");
      } catch {
        /* unsupported, or denied; not worth telling anyone */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release?.().catch(() => undefined);
    };
  }, [wall]);

  const frame = state?.frame;
  const photos = state?.photos ?? [];
  const canShowPhotos = photos.length > 0;
  // Zero disables the timer entirely — no photos, or the screensaver switched
  // off, means the dashboard simply stays up.
  const [idle, resetIdle] = useIdle(
    wall && frame?.enabled && canShowPhotos ? frame.idleSeconds : 0,
  );

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now),
  );
  const dim = wall && (hour >= 21 || hour < 6);

  if (!ready) {
    return (
      <main className={`dash${wall ? "" : " dash--phone"}`}>
        <div />
        <div style={{ display: "grid", placeItems: "center" }}>
          <span className="spinner" />
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <ProfileGate
        profiles={profiles}
        onChoose={choose}
        error={profileError}
        title={wall ? "Who's at the wall?" : "Who's this?"}
        note="Whatever you add from here gets tagged with this name. Swap it any time from the header."
      />
    );
  }

  const pending = state?.approvals.length ?? 0;

  // Only worth showing once there is something to come back to. With the
  // now-playing scope granted this is exact; without it, opening the tab is
  // the best signal there is.
  // Whether the floating player is wanted. The dock itself decides where it
  // sits; this only says whether there is anything worth floating.
  const showMini = musicOpened && tab !== "music" && sounding;

  // Spread into every Tile: which one is open, and how to open or close it.
  const tile = {
    expandedId: tiles.expandedId,
    onExpand: tiles.expand,
    onCollapse: tiles.collapse,
  };

  const showSaver = wall && canShowPhotos && frame && (preview || idle);

  return (
    // The evening dim is a filter, and a filter on the parent would drag the
    // screensaver's photographs through it too — so the dashboard only wears
    // it while the photos are not up, and they get their own gentler one.
    <main
      className={`dash${wall ? "" : " dash--phone"}${
        dim && !showSaver ? " dash--dim" : ""
      }`}
    >
      {capturing ? (
        <QuickCapture
          profileId={profile.id}
          onClose={() => setCapturing(false)}
          onChanged={refresh}
        />
      ) : null}


      {showSaver ? (
        <Screensaver
          photos={photos}
          frame={frame}
          timeZone={timeZone}
          dim={dim}
          onDismiss={() => {
            setPreview(false);
            resetIdle();
          }}
        />
      ) : null}

      <header className="dash__header">
        <div className="dash__clock">
          <span className="dash__time">
            {new Intl.DateTimeFormat("en-AU", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
            }).format(now)}
          </span>
          <span className="dash__date">
            {new Intl.DateTimeFormat("en-AU", {
              timeZone,
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(now)}
          </span>
        </div>

        <div className="dash__right">
          {error ? <span className="pill" style={{ color: "var(--rose)" }}>offline</span> : null}
          {cameras.data?.panels.map((panel) => (
            <button
              key={panel.entityId}
              className={`pill${panel.armed ? " pill--armed" : ""}`}
              onClick={() => setTab("cameras")}
              title={`${panel.name}: ${panel.state.replace(/_/g, " ")}`}
            >
              <span
                className="dot"
                style={{ background: panel.armed ? "var(--sage)" : "var(--text-faint)" }}
              />
              {panel.armed ? "Armed" : "Disarmed"}
            </button>
          ))}
          {profiles.map((person) => (
            <button
              key={person.id}
              onClick={() => choose(person.id)}
              className="avatar avatar--sm"
              title={`Acting as ${person.name}`}
              style={{
                background: person.color,
                opacity: person.id === profileId ? 1 : 0.34,
                cursor: "pointer",
              }}
            >
              {initials(person.name)}
            </button>
          ))}
          {wall ? null : (
            <Link className="pill" href="/capture">
              Capture
            </Link>
          )}
          {/* The front door of the whole app, on the surface people are
              actually standing in front of. */}
          <button className="pill pill--add" onClick={() => setCapturing(true)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
            </svg>
            Add
          </button>
          {/* Wall furniture. An installed PWA is already full screen, so on a
              phone this is a button that does nothing to a header that has no
              room for it. */}
          {wall ? <Fullscreen /> : null}
          <Link className="pill" href="/settings">
            Settings
          </Link>
        </div>
      </header>

      <div
        className={`dash__grid${wall && view === "month" ? " dash__grid--month" : ""}`}
      >
        <div className="dash__calendar">
          <Tile id="calendar" {...tile}>
            {wall ? (
              <Calendar
                events={calendar.events}
                profiles={state?.profiles ?? profiles}
                connected={calendar.connected}
                errors={calendar.errors}
                reconnect={calendar.reconnect}
                profileId={profile.id}
                onChanged={calendar.reload}
                loaded={calendar.loaded}
                loading={calendar.loading}
                timeZone={timeZone}
                todayKey={todayKey}
                view={view}
                anchor={anchor}
                onView={setView}
                onAnchor={setAnchor}
              />
            ) : (
              <CalendarAgenda
                events={calendar.events}
                profiles={state?.profiles ?? profiles}
                connected={calendar.connected}
                errors={calendar.errors}
                reconnect={calendar.reconnect}
                profileId={profile.id}
                onChanged={calendar.reload}
                loaded={calendar.loaded}
                timeZone={timeZone}
                now={now}
              />
            )}
          </Tile>
        </div>

        <div className="dash__col">
          <Tile id="lists" {...tile}>
          <section className="panel">
            <header className="panel__head">
              <div className="tabs" role="tablist">
                <button
                  className="tab"
                  role="tab"
                  aria-selected={tab === "shopping"}
                  onClick={() => setTab("shopping")}
                >
                  Shopping
                </button>
                <button
                  className="tab"
                  role="tab"
                  aria-selected={tab === "recipes"}
                  onClick={() => setTab("recipes")}
                >
                  Recipes
                </button>
                <button
                  className="tab"
                  role="tab"
                  aria-selected={tab === "photos"}
                  onClick={() => setTab("photos")}
                >
                  Photos
                </button>
                {/*
                  * Always here, empty or not: the only way to add the first
                  * playlist is through this tab, so hiding it until one exists
                  * makes the feature unreachable.
                  */}
                <button
                  className="tab"
                  role="tab"
                  aria-selected={tab === "music"}
                  onClick={() => setTab("music")}
                >
                  Music
                </button>
                {cameras.data?.configured ? (
                  <button
                    className="tab"
                    role="tab"
                    aria-selected={tab === "cameras"}
                    onClick={() => setTab("cameras")}
                  >
                    Cameras
                  </button>
                ) : null}
                {/* Shown when there are robots, and also when we could not
                    find out. The second clause used to be absent, so a Home
                    Assistant that could not be reached emptied the list and
                    the tab removed itself -- taking with it the error banner
                    in Robots.tsx written for exactly this, which no one could
                    reach because the tab was gone. A house with no vacuum
                    still gets no tab, which was the original intent; a house
                    whose vacuum cannot be read now gets told. */}
                {robots.data?.configured &&
                (robots.data.robots.length > 0 || robots.data.error) ? (
                  <button
                    className="tab"
                    role="tab"
                    aria-selected={tab === "robots"}
                    onClick={() => setTab("robots")}
                  >
                    Robots
                  </button>
                ) : null}
              </div>
              <span className="panel__meta">
                {tab === "shopping"
                  ? `${state?.shopping.filter((item) => !item.checkedAt).length ?? 0} to get`
                  : tab === "recipes"
                    ? `${state?.recipes.length ?? 0} saved`
                    : tab === "photos"
                      ? `${photos.length} in the frame`
                      : tab === "music"
                        ? music.data?.stations.length
                          ? `${music.data.stations.length} pinned`
                          : "nothing pinned"
                      : tab === "robots"
                        ? (robots.data?.robots.filter((robot) => robot.running)
                            .length ?? 0) > 0
                          ? `${robots.data?.robots.filter((robot) => robot.running).length} out`
                          : "all home"
                        : `${cameras.data?.cameras.length ?? 0} cameras`}
              </span>
            </header>
            <div className="panel__body">
              {!state ? (
                <p className="empty">
                  <span className="spinner" /> Loading…
                </p>
              ) : tab === "shopping" ? (
                <ShoppingList
                  items={state.shopping}
                  profiles={state.profiles}
                  profileId={profile.id}
                  onChanged={refresh}
                />
              ) : tab === "recipes" ? (
                <Recipes
                  recipes={state.recipes}
                  profileId={profile.id}
                  onChanged={refresh}
                />
              ) : tab === "photos" ? (
                <PhotoLibrary
                  photos={state.photos}
                  frame={state.frame}
                  profiles={state.profiles}
                  profileId={profile.id}
                  onChanged={refresh}
                  onPreview={() => setPreview(true)}
                />
              ) : tab === "robots" ? (
                <Robots
                  data={robots.data}
                  profileId={profile.id}
                  onChanged={robots.reload}
                />
              ) : tab === "cameras" ? (
                <Cameras
                  data={cameras.data}
                  profileId={profile.id}
                  onChanged={cameras.reload}
                />
              ) : null}

              {/*
                * Always mounted, and moved with CSS rather than in the DOM:
                * re-parenting an iframe destroys its document, and a music
                * player that stops when you look at the shopping list is not a
                * music player. Off the Music tab it becomes the floating
                * player, which is how Spotify's own transport controls come
                * along with it.
                */}
              <MusicDock
                data={music.data}
                error={music.error}
                profileId={profile.id}
                docked={tab !== "music"}
                showing={showMini}
                onChanged={music.reload}
                onOpen={() => setTab("music")}
              />
            </div>
          </section>
          </Tile>
        </div>

        <div className="dash__col dash__col--split">
          <Tile id="approvals" {...tile}>
          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Needs your OK</h2>
              {pending > 0 ? (
                <span className="pill" style={{ color: "var(--gold)" }}>
                  {pending}
                </span>
              ) : null}
            </header>
            <div className="panel__body">
              {state ? (
                <ApprovalQueue
                  approvals={state.approvals}
                  profileId={profile.id}
                  onChanged={refresh}
                />
              ) : null}
            </div>
          </section>
          </Tile>

          <Tile id="todo" {...tile}>
          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">To do</h2>
              <span className="panel__meta">
                {state?.reminders.filter((reminder) => !reminder.doneAt).length ?? 0} open
              </span>
            </header>
            <div className="panel__body">
              {state ? (
                <Reminders
                  reminders={state.reminders}
                  profiles={state.profiles}
                  profileId={profile.id}
                  timeZone={timeZone}
                  onChanged={refresh}
                />
              ) : null}
            </div>
          </section>
          </Tile>
        </div>

        <div className="dash__col dash__col--split dash__col--money">
          <Tile id="money" {...tile}>
            <MoneyCard
              snapshot={money.snapshot}
              configured={money.configured}
              error={money.error}
              expanded={tiles.expandedId === "money"}
            />
          </Tile>

          <Tile id="activity" {...tile}>
          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Lately</h2>
              <span className="panel__meta">who did what</span>
            </header>
            <div className="panel__body">
              {state ? (
                <ActivityFeed
                  activity={state.activity}
                  profiles={state.profiles}
                  profileId={profile.id}
                  onChanged={refresh}
                />
              ) : null}
            </div>
          </section>
          </Tile>
        </div>
      </div>
    </main>
  );
}
