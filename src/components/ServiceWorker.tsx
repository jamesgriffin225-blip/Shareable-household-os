"use client";

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("service worker registration failed", error);
    });

    // A new worker takes over as soon as it activates. Reloading once when it
    // does is what makes a deploy land on a tab that was already open —
    // including the installed app on the wall, which is rarely closed.
    //
    // Only when one was already in charge, though: on a first visit the very
    // first worker claims the page too, and reloading there would make every
    // new device load the app twice.
    const wasControlled = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    const onController = () => {
      if (!wasControlled || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);

  return null;
}
