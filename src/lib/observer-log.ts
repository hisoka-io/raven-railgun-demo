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
  /** A `/batch` body's query count, from its envelope. */
  batchQueries?: number;
  /** Each query's shard id, in wire order, from the envelope. */
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

/** A proxy listen URL and the run every request through it records. */
export interface ObserverEntrance {
  run: string;
  url: string;
}

export interface ObserverMeta {
  source: string;
  startedAt: string;
  upstreams: { raven?: string; aggregator?: string };
  commitments: string[];
  commitmentOrigins?: Record<string, string>;
  /** Older proxies: the run label a page switch set for new requests. */
  run?: string;
  entrances?: ObserverEntrance[];
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
        title: "Root pin",
        learns: "A request for the root to check a fetched path against. Names no note.",
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
        learns: "Fresh random packing keys the server uses to pack its encrypted answers. No note, no index.",
      };
    case "/v1/instance/{id}/batch":
      return {
        kind: "pir-query",
        title: "Encrypted path query",
        learns:
          "Encrypted PIR queries for Merkle paths. The server answers each without learning which row it returned. No commitment.",
      };
    case "/v1/instance/{id}/query":
      return {
        kind: "pir-query",
        title: "Encrypted path query",
        learns:
          "An encrypted PIR query for a Merkle path. The server answers it without learning which row it returned. No commitment.",
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

/** Which proxy port files a request in which pane, or undefined for a proxy that predates entrances. */
export function entranceSummary(entrances: readonly ObserverEntrance[] | undefined): string | undefined {
  if (!entrances || entrances.length === 0) return undefined;
  const at = (run: string) =>
    entrances
      .filter((e) => e.run === run)
      .map((e) => e.url.replace(/^https?:\/\//, ""))
      .join(" and ") || "none";
  return `The port decides the pane. Raven on enters on ${at("raven")}; Raven off on ${at("stock")}.`;
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall-clock time the request started, HH:MM:SS. */
export function clockTime(tMs: number): string {
  const d = new Date(tMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** The request's own round trip through the proxy. A negative value is a wall-clock step, not a time. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** Rows no view may fold or merge: a read that names a note, or a failure. A proof submission
 *  carries notes in every setup, so it folds unless it failed. */
export function needsAttention(e: ObserverEvent): boolean {
  if (isReadLeak(e)) return true;
  return Boolean(e.error) || e.status === undefined || e.status < 200 || e.status >= 300;
}

export type HighlightTone = "red" | "amber" | "none";

/** Red marks a read that names a note; amber marks a proof submission. */
export function highlightTone(e: ObserverEvent): HighlightTone {
  if (isReadLeak(e)) return "red";
  return explain(e).kind === "write" ? "amber" : "none";
}

// A repeat this far from the last one is a later step of the session, not part of the same burst.
const MERGE_GAP_MS = 60_000;

const KEY_KINDS: ReadonlySet<EventKind> = new Set(["pir-query"]);

export function isKeyRequest(e: ObserverEvent): boolean {
  return needsAttention(e) || KEY_KINDS.has(explain(e).kind);
}

function supportLabel(e: ObserverEvent): string {
  switch (explain(e).kind) {
    case "list-download":
      return "index downloads";
    case "session":
      return "encryption keys";
    case "pin":
      return "root pins";
    case "txid":
      return "transaction checks";
    case "roots":
      return "roots checks";
    case "params":
      return "PIR parameters";
    case "status":
      return "node status";
    case "write":
      return "proof submissions";
    default:
      return e.upstream === "raven" && e.routeTemplate.startsWith("/v1/health") ? "health" : "other";
  }
}

export interface KeyView {
  /** Each row is one request, or a run of identical routine requests shown as one. */
  rows: ObserverEvent[][];
  shown: number;
  folded: number;
  /** What the folded requests are, most frequent first. */
  foldedKinds: string[];
}

export function keyView(events: readonly ObserverEvent[]): KeyView {
  const rows: ObserverEvent[][] = [];
  const kinds = new Map<string, number>();
  let shown = 0;
  let prevKey: string | undefined;
  let prevMs = 0;
  for (const e of events) {
    if (!isKeyRequest(e)) {
      const label = supportLabel(e);
      kinds.set(label, (kinds.get(label) ?? 0) + 1);
      continue;
    }
    shown += 1;
    const key = needsAttention(e) ? undefined : `${e.upstream} ${e.method} ${e.rpcMethod ?? e.routeTemplate}`;
    if (key !== undefined && key === prevKey && Math.abs(e.tMs - prevMs) <= MERGE_GAP_MS) rows[rows.length - 1].push(e);
    else rows.push([e]);
    prevKey = key;
    prevMs = e.tMs;
  }
  const foldedKinds = [...kinds].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { rows, shown, folded: events.length - shown, foldedKinds };
}

export interface PaneSummary {
  total: number;
  toAggregator: number;
  toRaven: number;
  readLeaks: number;
  writes: number;
  /** Distinct watched commitments named by a read. */
  namedNotes: number;
  shortChecked: number;
  verdict: "leak" | "clean" | "unchecked";
  sentBytes: number;
  receivedBytes: number;
}

/** A pane's verdict and counters. Callers pass every request in the pane, never a view of it. */
export function paneSummary(events: readonly ObserverEvent[], watched: number): PaneSummary {
  const leaks = events.filter(isReadLeak);
  const named = new Set(leaks.flatMap((e) => e.requestMatches.map((m) => m.commitment)));
  // A request searched for fewer commitments than are watched now (an older log, or a body
  // evicted before the list grew) is not evidence about the notes added since.
  const shortChecked = events.filter(
    (e) => e.rescanDropped || (e.watchedAtScan !== undefined && e.watchedAtScan < watched),
  ).length;
  return {
    total: events.length,
    toAggregator: events.filter((e) => e.upstream === "aggregator").length,
    toRaven: events.filter((e) => e.upstream === "raven").length,
    readLeaks: leaks.length,
    writes: events.filter((e) => explain(e).kind === "write").length,
    namedNotes: named.size,
    shortChecked,
    verdict: leaks.length > 0 ? "leak" : watched === 0 ? "unchecked" : "clean",
    sentBytes: events.reduce((s, e) => s + e.requestBytes, 0),
    receivedBytes: events.reduce((s, e) => s + e.responseBytes, 0),
  };
}
