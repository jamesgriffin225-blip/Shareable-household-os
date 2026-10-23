"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough to read a full list; short enough that the wall resets itself. */
const COLLAPSE_AFTER_MS = 20_000;

/**
 * A dashboard panel that can be blown up to fill the screen.
 *
 * It wraps the panel rather than replacing its header, which is why the button
 * is positioned over the corner instead of sitting in the markup: every panel
 * builds its own header — tabs, a legend, a count — and threading an extra
 * child through all eight of them would be worse than one absolute button.
 *
 * Expansion collapses itself after twenty seconds of nobody touching it. A
 * wall display that stays zoomed into the shopping list because someone walked
 * away is a wall display showing the wrong thing, and the person who expanded
 * it is not usually the person who finds it.
 */
export default function Tile({
  id,
  expandedId,
  onExpand,
  onCollapse,
  children,
}: {
  id: string;
  /** Which tile is open, if any — one at a time, held by the dashboard. */
  expandedId: string | null;
  onExpand: (id: string) => void;
  onCollapse: () => void;
  children: React.ReactNode;
}) {
  const expanded = expandedId === id;
  const frame = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(COLLAPSE_AFTER_MS);

  // A ref, not state: every interaction touches it, and re-rendering the panel
  // under someone's finger to store a timestamp would be absurd. It starts at
  // zero rather than "now" because reading the clock during render isn't pure;
  // the effect below sets it the moment the tile actually opens.
  const lastTouch = useRef(0);

  const keepAwake = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    lastTouch.current = Date.now();
    setRemaining(COLLAPSE_AFTER_MS);

    const tick = setInterval(() => {
      const left = COLLAPSE_AFTER_MS - (Date.now() - lastTouch.current);
      if (left <= 0) onCollapse();
      else setRemaining(left);
    }, 250);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse();
      else keepAwake();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(tick);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, keepAwake, onCollapse]);

  const seconds = Math.ceil(remaining / 1000);

  return (
    <>
      {expanded ? <div className="tile__scrim" onClick={onCollapse} /> : null}
      <div
        ref={frame}
        className={`tile${expanded ? " tile--expanded" : ""}`}
        onPointerDown={expanded ? keepAwake : undefined}
        onPointerMove={expanded ? keepAwake : undefined}
        onScroll={expanded ? keepAwake : undefined}
        onWheel={expanded ? keepAwake : undefined}
      >
        {children}
        <button
          className="tile__expand"
          onClick={() => (expanded ? onCollapse() : onExpand(id))}
          aria-label={expanded ? "Close" : "Expand"}
          title={expanded ? "Close" : "Expand"}
        >
          {expanded ? (
            <>
              <span aria-hidden="true">✕</span>
              {/* The countdown is the honest version of a panel that is about
                  to move on its own. Without it, the collapse reads as a bug. */}
              <span className="tile__countdown">{seconds}</span>
            </>
          ) : (
            <span aria-hidden="true">⤢</span>
          )}
        </button>
      </div>
    </>
  );
}

/** One expanded tile at a time, held by the dashboard. */
export function useTiles() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expand = useCallback((id: string) => setExpandedId(id), []);
  const collapse = useCallback(() => setExpandedId(null), []);
  return { expandedId, expand, collapse };
}
