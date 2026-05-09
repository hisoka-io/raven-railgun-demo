import { useEffect, useState } from "react";
import { CONFIG } from "@/lib/config";

export interface IndexerStatus {
  lastApplied: number | null;
  chainHead: number | null;
  lag: number | null;
  events: number | null;
  fetchedAt: number;
}

const RE_LAST = /^raven_railgun_indexer_last_applied_block\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_HEAD = /^raven_railgun_indexer_chain_head_block_per_instance\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_LAG = /^raven_railgun_indexer_lag_blocks_per_instance\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_EVT = /^raven_railgun_consumer_events_processed\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;

function parseFor(text: string, instance: string): IndexerStatus {
  let lastApplied: number | null = null;
  let chainHead: number | null = null;
  let lag: number | null = null;
  let events: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(RE_LAST)) && m[1] === instance) lastApplied = Number(m[2]);
    else if ((m = line.match(RE_HEAD)) && m[1] === instance) chainHead = Number(m[2]);
    else if ((m = line.match(RE_LAG)) && m[1] === instance) lag = Number(m[2]);
    else if ((m = line.match(RE_EVT)) && m[1] === instance) events = Number(m[2]);
  }
  return { lastApplied, chainHead, lag, events, fetchedAt: Date.now() };
}

export function useIndexerStatus(instance: string, intervalMs = 5_000): IndexerStatus | null {
  const [status, setStatus] = useState<IndexerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function poll() {
      try {
        const res = await fetch(`${CONFIG.ravenUrl}/metrics`, {
          headers: { Authorization: `Bearer ${CONFIG.ravenBearer}` },
        });
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setStatus(parseFor(text, instance));
        }
      } catch {
        // best-effort
      }
      if (!cancelled) timer = window.setTimeout(poll, intervalMs);
    }
    poll();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [instance, intervalMs]);

  return status;
}
