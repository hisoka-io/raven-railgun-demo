import { useEffect, useState } from "react";
import { CONFIG } from "./config";
import type { StatusBody } from "./raven-client";

export type StreamState = "connecting" | "open" | "closed" | "error";

export interface EventStream {
  status: StatusBody | null;
  state: StreamState;
  lastEventAt: number | null;
  errorMessage: string | null;
}

const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 30_000, 60_000, 300_000];

let singleton: {
  source: EventSource | null;
  status: StatusBody | null;
  state: StreamState;
  lastEventAt: number | null;
  errorMessage: string | null;
  subscribers: Set<(snap: EventStream) => void>;
  reconnectAttempt: number;
  reconnectTimer: number | null;
} | null = null;

function getSingleton() {
  if (singleton) return singleton;
  singleton = {
    source: null,
    status: null,
    state: "connecting",
    lastEventAt: null,
    errorMessage: null,
    subscribers: new Set(),
    reconnectAttempt: 0,
    reconnectTimer: null,
  };
  return singleton;
}

function broadcast() {
  const s = getSingleton();
  const snap: EventStream = {
    status: s.status,
    state: s.state,
    lastEventAt: s.lastEventAt,
    errorMessage: s.errorMessage,
  };
  for (const fn of s.subscribers) fn(snap);
}

function ensureOpen() {
  const s = getSingleton();
  if (s.source) return;
  const url = `${CONFIG.ravenUrl}/v1/events`;
  s.state = "connecting";
  broadcast();
  try {
    const es = new EventSource(url, { withCredentials: false });
    s.source = es;
    es.addEventListener("status", (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent<string>).data) as StatusBody;
        s.status = parsed;
        s.state = "open";
        s.lastEventAt = Date.now();
        s.errorMessage = null;
        broadcast();
      } catch (err) {
        s.errorMessage = err instanceof Error ? err.message : String(err);
        broadcast();
      }
    });
    es.addEventListener("open", () => {
      s.state = "open";
      s.errorMessage = null;
      s.reconnectAttempt = 0;
      broadcast();
    });
    es.addEventListener("error", () => {
      try { es.close(); } catch { /* best effort */ }
      s.source = null;
      s.state = "closed";
      s.errorMessage = "stream error";
      broadcast();
      const idx = Math.min(s.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1);
      const delay = BACKOFF_SCHEDULE_MS[idx];
      s.reconnectAttempt += 1;
      if (s.reconnectTimer !== null) window.clearTimeout(s.reconnectTimer);
      s.reconnectTimer = window.setTimeout(() => {
        s.reconnectTimer = null;
        if (!singleton?.source && (singleton?.subscribers.size ?? 0) > 0) {
          ensureOpen();
        }
      }, delay);
    });
  } catch (err) {
    s.errorMessage = err instanceof Error ? err.message : String(err);
    s.state = "error";
    broadcast();
  }
}

function maybeClose() {
  const s = getSingleton();
  if (s.subscribers.size > 0) return;
  s.source?.close();
  s.source = null;
  s.state = "closed";
  if (s.reconnectTimer !== null) {
    window.clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
}

export function useEventsStream(): EventStream {
  const [snap, setSnap] = useState<EventStream>(() => {
    const s = getSingleton();
    return {
      status: s.status,
      state: s.state,
      lastEventAt: s.lastEventAt,
      errorMessage: s.errorMessage,
    };
  });

  useEffect(() => {
    const s = getSingleton();
    s.subscribers.add(setSnap);
    ensureOpen();
    return () => {
      s.subscribers.delete(setSnap);
      maybeClose();
    };
  }, []);

  return snap;
}
