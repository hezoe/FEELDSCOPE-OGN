"use client";

import { createContext, useContext, useEffect, useRef, ReactNode } from "react";
import { useTab } from "./TabContext";

// localStorage flag toggled from the Settings screen. Default OFF.
export const POINTER_TRACKING_KEY = "ogn-pointer-tracking";
// Custom event dispatched by the settings toggle so the provider re-configures live.
export const POINTER_TRACKING_EVENT = "ogn-pointer-tracking-change";

// One recorded pointer sample. Serialized as a single JSONL line server-side.
export interface PointerSample {
  t: number; // epoch ms
  type: "move" | "click" | "scroll";
  x: number; // clientX (or scrollX for scroll)
  y: number; // clientY (or scrollY for scroll)
  vw: number; // viewport width  (normalization)
  vh: number; // viewport height (normalization)
  tab: string; // active tab (TabContext)
  sel?: string; // click only: simple target selector (tag#id.class)
}

const MOVE_THROTTLE_MS = 100; // <= 10 samples/sec
const SCROLL_THROTTLE_MS = 200;
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_COUNT = 200;
const API_URL = "/api/analytics/pointer";

export function isPointerTrackingEnabled(): boolean {
  try {
    return localStorage.getItem(POINTER_TRACKING_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPointerTrackingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(POINTER_TRACKING_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new Event(POINTER_TRACKING_EVENT));
  } catch {
    // ignore storage failures (private mode etc.)
  }
}

// Build a compact, human-readable selector for a clicked element.
function selectorFor(el: EventTarget | null): string | undefined {
  if (!(el instanceof Element)) return undefined;
  let sel = el.tagName.toLowerCase();
  if (el.id) sel += `#${el.id}`;
  const cls = typeof el.className === "string" ? el.className.trim() : "";
  if (cls) sel += "." + cls.split(/\s+/).slice(0, 3).join(".");
  return sel.slice(0, 120);
}

// Short random-ish session id without Math.random (avoid across reloads uniqueness concerns).
function makeSessionId(): string {
  try {
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return String(Date.now());
  }
}

const PointerTrackerContext = createContext<null>(null);

export function PointerTrackerProvider({ children }: { children: ReactNode }) {
  const { activeTab } = useTab();
  // Keep the latest tab in a ref so listeners always read the current value.
  const tabRef = useRef(activeTab);
  useEffect(() => {
    tabRef.current = activeTab;
  }, [activeTab]);

  const bufferRef = useRef<PointerSample[]>([]);
  const sessionRef = useRef<string>("");

  useEffect(() => {
    sessionRef.current = makeSessionId();

    let attached = false;
    let lastMove = 0;
    let lastScroll = 0;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    function push(sample: PointerSample) {
      bufferRef.current.push(sample);
      if (bufferRef.current.length >= FLUSH_AT_COUNT) flush(false);
    }

    function flush(useBeacon: boolean) {
      if (bufferRef.current.length === 0) return;
      const events = bufferRef.current;
      bufferRef.current = [];
      const payload = JSON.stringify({ session: sessionRef.current, events });
      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon(API_URL, new Blob([payload], { type: "application/json" }));
          return;
        }
        fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {
          // On failure, drop the batch rather than growing memory unbounded.
        });
      } catch {
        // ignore
      }
    }

    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastMove < MOVE_THROTTLE_MS) return;
      lastMove = now;
      push({
        t: now,
        type: "move",
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tab: tabRef.current,
      });
    };

    const onClick = (e: PointerEvent) => {
      push({
        t: Date.now(),
        type: "click",
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tab: tabRef.current,
        sel: selectorFor(e.target),
      });
    };

    const onScroll = () => {
      const now = Date.now();
      if (now - lastScroll < SCROLL_THROTTLE_MS) return;
      lastScroll = now;
      push({
        t: now,
        type: "scroll",
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tab: tabRef.current,
      });
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);

    function attach() {
      if (attached) return;
      attached = true;
      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerdown", onClick, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", onPageHide);
      flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    }

    function detach() {
      if (!attached) return;
      attached = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onClick);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      flush(false); // send whatever was buffered before turning off
    }

    // Re-evaluate the enabled flag on toggle (same-tab) and cross-tab storage events.
    function reconfigure() {
      if (isPointerTrackingEnabled()) attach();
      else detach();
    }

    reconfigure();
    window.addEventListener(POINTER_TRACKING_EVENT, reconfigure);
    window.addEventListener("storage", reconfigure);

    return () => {
      window.removeEventListener(POINTER_TRACKING_EVENT, reconfigure);
      window.removeEventListener("storage", reconfigure);
      detach();
    };
  }, []);

  return (
    <PointerTrackerContext.Provider value={null}>{children}</PointerTrackerContext.Provider>
  );
}

export function usePointerTracker() {
  return useContext(PointerTrackerContext);
}
