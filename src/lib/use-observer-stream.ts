import { useEffect, useState } from "react";
import { parseObserverLog, type ObserverEvent, type ObserverLog } from "@/lib/observer-log";

export type StreamState = "idle" | "connecting" | "open" | "error";

/** Follows the recording proxy's SSE stream; `url` undefined disconnects. */
export function useObserverStream(url: string | undefined): {
  state: StreamState;
  log: ObserverLog | null;
  error: string | null;
} {
  const [state, setState] = useState<StreamState>("idle");
  const [log, setLog] = useState<ObserverLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setState("idle");
      return;
    }
    setState("connecting");
    setError(null);
    const source = new EventSource(`${url.replace(/\/$/, "")}/observer/events`);
    source.addEventListener("snapshot", (msg) => {
      try {
        setLog(parseObserverLog(JSON.parse((msg as MessageEvent<string>).data)));
        setState("open");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    source.addEventListener("record", (msg) => {
      const event = JSON.parse((msg as MessageEvent<string>).data) as ObserverEvent;
      setLog((prev) => (prev ? { ...prev, events: [...prev.events, event] } : prev));
    });
    source.onerror = () => {
      setState("error");
      setError(`cannot reach ${url}/observer/events (is the proxy running?)`);
    };
    return () => source.close();
  }, [url]);

  return { state, log, error };
}

export async function postObserverControl(
  url: string,
  path: "run" | "commitments" | "reset",
  body: unknown,
): Promise<void> {
  const res = await fetch(`${url.replace(/\/$/, "")}/observer/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
}
