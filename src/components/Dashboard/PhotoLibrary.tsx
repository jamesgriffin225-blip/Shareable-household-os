"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { prepare } from "@/lib/client/images";
import type { FrameSettings, Photo, Profile } from "@/lib/types";

export default function PhotoLibrary({
  photos,
  frame,
  profiles,
  profileId,
  onChanged,
  onPreview,
}: {
  photos: Photo[];
  frame: FrameSettings;
  profiles: Profile[];
  profileId: string;
  onChanged: () => void;
  onPreview: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveFrame = async (patch: Partial<FrameSettings>) => {
    setError(null);
    try {
      await api("/api/photos/frame", {
        method: "PUT",
        body: JSON.stringify(patch),
        profileId,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setError(null);
    setUploading({ done: 0, total: files.length });
    // One request per photo: it keeps each body well under the serverless
    // limit and means a failure loses one photo, not the whole batch.
    for (const [index, file] of files.entries()) {
      try {
        const prepared = await prepare(file);
        const form = new FormData();
        form.set("profileId", profileId);
        form.set("image", prepared.full, "photo.jpg");
        form.set("thumb", prepared.thumb, "thumb.jpg");
        form.set("width", String(prepared.width));
        form.set("height", String(prepared.height));
        await api("/api/photos", { method: "POST", body: form, profileId });
      } catch (cause) {
        setError(
          `${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      setUploading({ done: index + 1, total: files.length });
    }
    setUploading(null);
    onChanged();
  };

  const toggle = (id: string) => {
    const selected = new Set(frame.selected);
    if (frame.mode === "single") {
      void saveFrame({ selected: selected.has(id) ? [] : [id] });
      return;
    }
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    void saveFrame({ selected: [...selected] });
  };

  const remove = async (photo: Photo) => {
    if (!window.confirm("Remove this photo from the frame?")) return;
    try {
      await api(`/api/photos/${photo.id}`, { method: "DELETE", profileId });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chosen = new Set(frame.selected);
  const showing = frame.selected.length === 0 ? photos.length : frame.selected.length;

  return (
    <>
      <div className="frame-controls">
        <div className="frame-controls__row">
          <button
            className="btn btn--primary"
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(uploading)}
          >
            {uploading ? `Adding ${uploading.done}/${uploading.total}…` : "Add photos"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={upload}
            aria-label="Choose photos"
          />
          <button className="btn" onClick={onPreview} disabled={photos.length === 0}>
            Show now
          </button>
        </div>

        <div className="frame-controls__row">
          <div className="tabs tabs--fill" role="tablist" aria-label="Frame mode">
            <button
              className="tab"
              role="tab"
              aria-selected={frame.mode === "single"}
              onClick={() =>
                void saveFrame({
                  mode: "single",
                  // A single frame can only mean one photo.
                  selected: frame.selected.slice(0, 1),
                })
              }
            >
              Single
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={frame.mode === "slideshow"}
              onClick={() => void saveFrame({ mode: "slideshow" })}
            >
              Slideshow
            </button>
          </div>
        </div>

        <div className="frame-controls__grid">
          <label className="frame-controls__labelled">
            <span>Starts after</span>
            <select
              className="field field--inline"
              value={frame.idleSeconds}
              onChange={(event) => void saveFrame({ idleSeconds: Number(event.target.value) })}
            >
              <option value={60}>1 minute</option>
              <option value={180}>3 minutes</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={3600}>1 hour</option>
            </select>
          </label>
          {frame.mode === "slideshow" ? (
            <label className="frame-controls__labelled">
              <span>Changes every</span>
              <select
                className="field field--inline"
                value={frame.intervalSeconds}
                onChange={(event) =>
                  void saveFrame({ intervalSeconds: Number(event.target.value) })
                }
              >
                <option value={5}>5 seconds</option>
                <option value={12}>12 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
              </select>
            </label>
          ) : null}
          <label className="frame-controls__labelled">
            <span>Portraits on the TV</span>
            <select
              className="field field--inline"
              value={frame.tvPortraits}
              onChange={(event) =>
                void saveFrame({ tvPortraits: event.target.value === "pair" ? "pair" : "fill" })
              }
            >
              <option value="fill">Fill the screen</option>
              <option value="pair">Two side by side</option>
            </select>
          </label>
        </div>

        <div className="frame-controls__row frame-controls__row--quiet">
          <label className="frame-controls__field">
            <input
              type="checkbox"
              checked={frame.enabled}
              onChange={(event) => void saveFrame({ enabled: event.target.checked })}
            />
            <span>Screensaver on</span>
          </label>
          <label className="frame-controls__field">
            <input
              type="checkbox"
              checked={frame.showClock}
              onChange={(event) => void saveFrame({ showClock: event.target.checked })}
            />
            <span>Clock over photos</span>
          </label>
          <span className="recipe__meta frame-controls__count">
            {photos.length === 0
              ? "nothing yet"
              : frame.selected.length === 0
                ? `showing all ${showing}`
                : `showing ${showing}`}
          </span>
        </div>
      </div>

      {error ? <div className="banner">{error}</div> : null}

      {photos.length === 0 ? (
        <p className="empty">
          No photos yet. Add some here, or send them from a phone on the capture
          screen.
        </p>
      ) : (
        <div className="thumbs">
          {photos.map((photo) => {
            const picked = chosen.has(photo.id);
            const who = profiles.find((profile) => profile.id === photo.addedBy);
            return (
              <div
                className={`thumb${picked ? " thumb--picked" : ""}`}
                key={photo.id}
                title={photo.caption ?? undefined}
              >
                <button
                  className="thumb__pick"
                  onClick={() => toggle(photo.id)}
                  aria-pressed={picked}
                  aria-label={
                    picked ? "Remove from the frame" : "Show this on the frame"
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/photo/${photo.id}?size=thumb`} alt={photo.caption ?? ""} />
                </button>
                {who ? (
                  <span
                    className="thumb__who"
                    title={`added by ${who.name}`}
                    style={{ background: who.color }}
                  />
                ) : null}
                <button
                  className="thumb__remove"
                  onClick={() => void remove(photo)}
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
