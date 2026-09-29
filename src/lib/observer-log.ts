// Shape of the recording proxy's log (scripts/observer/proxy.mjs) and what each recorded
// request tells the server that received it.

export const OBSERVER_LOG_FORMAT = "raven-observer-log";

export interface CommitmentMatch {
  commitment: string;
  encodings: string[];
}

export interface BodyPreview {
  kind: "empty" | "text" | "binary";
  text: string;
  truncated?: boolean;
}

export interface ObserverEvent {
  id: number;
  run: string;
  t: string;
  tMs: number;
  upstream: "raven" | "aggregator";
  destination: string;
  method: string;
  route: string;
  routeTemplate: string;
  block?: string;
  /** A `/batch` body's query count, padding included, as the node reads it. */
  batchQueries?: number;
  /** Each query's shard id, in wire order, as the node reads it. */
  shardIds?: number[];
  rpcMethod?: string;
  status?: number;
  durationMs?: number;
  requestBytes: number;
  responseBytes: number;
  requestContentType?: string;
  responseContentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestPreview?: BodyPreview;
  responsePreview?: BodyPreview;
  requestMatches: CommitmentMatch[];
  responseMatches: CommitmentMatch[];
  /** How many watched commitments the request was last searched for. */
  watchedAtScan?: number;
  /** Set when the body was evicted before a later watch-list change could re-check it. */
  rescanDropped?: boolean;
  error?: string;
}

export interface ObserverMeta {
  source: string;
  startedAt: string;
  upstreams: { raven?: string; aggregator?: string };
  commitments: string[];
  commitmentOrigins?: Record<string, string>;
  run: string;
  learn?: boolean;
  note?: string;
  logFile?: string;
}

export interface ObserverLog {
  format: string;
  version: number;
  meta: ObserverMeta;
  events: ObserverEvent[];
}

export function parseObserverLog(raw: unknown): ObserverLog {
  if (typeof raw !== "object" || raw === null) throw new Error("not a JSON object");
  const doc = raw as Partial<ObserverLog>;
  if (doc.format !== OBSERVER_LOG_FORMAT) {
    throw new Error(`not an observer log (format ${String(doc.format)})`);
  }
  if (!doc.meta || !Array.isArray(doc.events)) throw new Error("log has no meta or events");
  for (const e of doc.events) {
    if (typeof e?.id !== "number" || typeof e.tMs !== "number" || !Array.isArray(e.requestMatches)) {
      throw new Error("log holds an event without id, time or match list");
    }
  }
  return {
    format: doc.format,
    version: doc.version ?? 1,
    meta: {
      ...doc.meta,
      commitments: doc.meta.commitments ?? [],
      upstreams: doc.meta.upstreams ?? {},
    },
    events: doc.events,
  };
}

export type EventKind =
  | "names-notes"
  | "write"
  | "txid"
  | "roots"
  | "pin"
  | "list-download"
  | "params"
  | "session"
  | "pir-query"
  | "status"
  | "other";

export interface Explanation {
  kind: EventKind;
  title: string;
  learns: string;
}

const NOTE_READS = new Set([
  "ppoi_pois_per_list",
  "ppoi_merkle_proofs",
  "ppoi_pois_per_blinded_commitment",
]);

export function explain(e: ObserverEvent): Explanation {
  if (e.upstream === "aggregator") {
    const m = e.rpcMethod ?? "";
    if (NOTE_READS.has(m)) {
      return {
        kind: "names-notes",
        title: m === "ppoi_merkle_proofs" ? "Paths for spent notes" : "Status of the wallet's notes",
        learns:
          m === "ppoi_merkle_proofs"
            ? "Which notes this wallet spent (or, through a broadcaster, is about to spend), before the POI proof exists."
            : "Notes this wallet holds and has not yet seen as Valid (all of them on a fresh sync), and the outputs of its transfers, tied to its IP and timing.",
      };
    }
    if (m.startsWith("ppoi_submit")) {
      return {
        kind: "write",
        title: "Proof submission",
        learns:
          "The proof and the new notes it vouches for. This write is the same with or without Raven.",
      };
    }
    if (m === "ppoi_validated_txid" || m === "ppoi_validate_txid_merkleroot") {
      return {
        kind: "txid",
        title: "Transaction-tree check",
        learns: "A tree position and a root that every wallet checks. Names no note.",
      };
    }
    if (m === "ppoi_validate_poi_merkleroots") {
      return {
        kind: "roots",
        title: "Roots check (broadcaster side)",
        learns:
          "Sent by a broadcaster or receiver checking another wallet's pre-transaction proof, not by a self-signed spend. Roots are shared by every note in a block.",
      };
    }
    if (m === "ppoi_node_status" || m === "ppoi_poi_events") {
      return {
        kind: "pin",
        title: "Root pin for a block",
        learns: "Which 65,536-row block a path is in. Names no note.",
      };
    }
    return { kind: "other", title: m || "Aggregator request", learns: "See the body." };
  }
  switch (e.routeTemplate) {
    case "/v1/poi/{listKey}/bc-prefixes":
      return {
        kind: "list-download",
        title: "List index download",
        learns:
          "That a wallet synced the list, and from which position (?since=N is its last sync point). No note: status is answered on the device.",
      };
    case "/v1/instance/{id}/params":
      return {
        kind: "params",
        title: "Public PIR parameters",
        learns: "That a wallet is starting up. The parameters are public and identical for all.",
      };
    case "/v1/instance/{id}/session":
      return {
        kind: "session",
        title: "Encryption key registration",
        learns:
          "Fresh random key material and a random client id, both kept for the life of the wallet process. No note, no index.",
      };
    case "/v1/instance/{id}/batch":
      return {
        kind: "pir-query",
        title: "Encrypted path query",
        learns:
          `The block id${e.block ? ` (${e.block})` : ""}; ` +
          `the query count${e.batchQueries !== undefined ? ` (${e.batchQueries})` : ""}, padded with cover queries to 1, 2, 4, 8, 16 or 32; ` +
          `each query's shard id, in the clear${e.shardIds ? ` (${e.shardIds.join(", ")})` : ""}; the size; ` +
          "and the client id and session handle that link it to this wallet process's other queries to the block. " +
          "The row inside each shard is encrypted.",
      };
    case "/v1/instance/{id}/query":
      return {
        kind: "pir-query",
        title: "Encrypted path query",
        learns:
          `The block id${e.block ? ` (${e.block})` : ""}, the query's shard id in the clear, and the size; ` +
          "when the query carries a session handle, it and the client id link it to this wallet process's other queries to the block. " +
          "The row inside the shard is encrypted.",
      };
    case "/v1/status":
      return {
        kind: "status",
        title: "Node status",
        learns: "A read of the node's own state. The request carries nothing from the wallet.",
      };
    default:
      return { kind: "other", title: e.routeTemplate, learns: "See the body." };
  }
}

/** Requests that disclose a note on a read path; a proof submission discloses by design. A
 *  status or path read to the aggregator counts even when its notes are not on the watch list. */
export function isReadLeak(e: ObserverEvent): boolean {
  const kind = explain(e).kind;
  return kind === "names-notes" || (e.requestMatches.length > 0 && kind !== "write");
}

export function shortCommitment(hex: string): string {
  const h = hex.replace(/^0x/, "");
  return `0x${h.slice(0, 6)}...${h.slice(-4)}`;
}

/** Replay offsets: real gaps, with long pauses (a wallet waiting on a proof) cut to `maxGapMs`
 *  and bursts spread to `minGapMs`, so a scripted session still arrives one request at a time. */
export function replayOffsets(
  events: readonly ObserverEvent[],
  maxGapMs = 1500,
  minGapMs = 600,
): number[] {
  const out: number[] = [];
  let clock = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (i > 0) {
      const gap = Math.max(events[i].tMs - events[i - 1].tMs, 0);
      clock += Math.min(Math.max(gap, minGapMs), maxGapMs);
    }
    out.push(clock);
  }
  return out;
}
