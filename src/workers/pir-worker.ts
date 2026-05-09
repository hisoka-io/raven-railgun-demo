/// <reference lib="webworker" />

import init, {
  init_panic_hook,
  build_client_session,
  build_seeded_query,
  extract_response,
  serialize_client_session,
  deserialize_client_session,
  build_instance_params_blob,
  type ClientSessionHandle,
} from "raven-inspire-client-wasm";

interface ParamsResponse {
  wireSchemaVersion: number;
  crsBincode: Uint8Array;
  shardConfigBincode: Uint8Array;
  inspireParamsBincode: Uint8Array;
  entrySize: number;
  variant: string;
  epoch: bigint;
}

let session: ClientSessionHandle | null = null;
let lastBundle: { bundle: Uint8Array; params: ParamsResponse } | null = null;
let initialized = false;

function formatHttpError(route: string, res: Response): string {
  if (res.status === 429) {
    const retry =
      res.headers.get("x-ratelimit-after") ?? res.headers.get("retry-after");
    return retry
      ? `${route}: rate-limited by operator (retry in ${retry}s)`
      : `${route}: rate-limited by operator`;
  }
  if (res.status === 503) return `${route}: operator at capacity (HTTP 503)`;
  return `${route}: HTTP ${res.status}`;
}

function readU64LE(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  if (hi !== 0)
    throw new Error(`readU64LE: payload exceeds 2^32 (hi=${hi}) at ${offset}`);
  return lo;
}

function readByteVec(buf: Uint8Array, offset: number) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = readU64LE(view, offset);
  const start = offset + 8;
  const end = start + len;
  if (end > buf.length)
    throw new Error(`readByteVec: truncated (need ${end}, have ${buf.length})`);
  return { value: new Uint8Array(buf.subarray(start, end)), next: end };
}

function readString(buf: Uint8Array, offset: number) {
  const inner = readByteVec(buf, offset);
  return { value: new TextDecoder().decode(inner.value), next: inner.next };
}

function decodeInstanceParams(buf: Uint8Array): ParamsResponse {
  if (buf.length < 4) throw new Error(`/params body too short: ${buf.length}`);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const envelope = (view.getUint8(0) << 8) | view.getUint8(1);
  if (envelope !== 1) throw new Error(`unexpected envelope=${envelope}`);
  let off = 2;
  const wireSchemaVersion = view.getUint16(off, true);
  off += 2;
  const crs = readByteVec(buf, off);
  off = crs.next;
  const shard = readByteVec(buf, off);
  off = shard.next;
  const inspire = readByteVec(buf, off);
  off = inspire.next;
  const entrySize = readU64LE(view, off);
  off += 8;
  const variant = readString(buf, off);
  off = variant.next;
  const epochLo = view.getUint32(off, true);
  const epochHi = view.getUint32(off + 4, true);
  const epoch = (BigInt(epochHi) << 32n) | BigInt(epochLo);
  return {
    wireSchemaVersion,
    crsBincode: crs.value,
    shardConfigBincode: shard.value,
    inspireParamsBincode: inspire.value,
    entrySize,
    variant: variant.value,
    epoch,
  };
}

async function ensureInit(): Promise<void> {
  if (initialized) return;
  await init();
  init_panic_hook();
  initialized = true;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.length);
  view.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface IDBChunkMeta {
  chunkCount: number;
  totalLen: number;
  sha256: string;
}

const DB_NAME = "raven-pir-session-cache-v1";
const STORE = "sessions";
const CHUNK_SIZE = 32 * 1024 * 1024;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGetSession(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    const meta = await new Promise<IDBChunkMeta | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(`${key}#meta`);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!meta) return null;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < meta.chunkCount; i += 1) {
      const chunk = await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(`${key}#chunk-${i}`);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      if (!chunk) return null;
      chunks.push(chunk);
    }
    const total = new Uint8Array(meta.totalLen);
    let off = 0;
    for (const c of chunks) {
      total.set(c, off);
      off += c.length;
    }
    const hash = await sha256Hex(total);
    if (hash !== meta.sha256) return null;
    return total;
  } catch {
    return null;
  }
}

async function idbPutSession(key: string, blob: Uint8Array): Promise<void> {
  try {
    const db = await openDb();
    const hash = await sha256Hex(blob);
    const chunkCount = Math.max(1, Math.ceil(blob.length / CHUNK_SIZE));
    const meta: IDBChunkMeta = {
      chunkCount,
      totalLen: blob.length,
      sha256: hash,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(meta, `${key}#meta`);
      for (let i = 0; i < chunkCount; i += 1) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, blob.length);
        store.put(blob.slice(start, end), `${key}#chunk-${i}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
  }
}

export interface ColdResult {
  paramsFetchMs: number;
  paramsBodyBytes: number;
  envelopeDecodeMs: number;
  buildSessionMs: number;
  totalMs: number;
  cacheHit: boolean;
  cfCacheStatus: string | null;
  etag: string | null;
}

export interface QueryResult {
  buildQueryMs: number;
  postMs: number;
  extractMs: number;
  totalMs: number;
  queryBytes: number;
  responseBytes: number;
  freshness: string | null;
  recoveredHex: string;
  request: {
    method: "POST";
    url: string;
    bodyBytesPreviewHex: string;
    bodyBytesLen: number;
  };
  response: {
    status: number;
    bodyBytesPreviewHex: string;
    bodyBytesLen: number;
  };
}

type Inbound =
  | { type: "ping"; id: number }
  | {
      type: "boot";
      id: number;
      ravenUrl: string;
      bearer: string;
      instance: string;
    }
  | {
      type: "query";
      id: number;
      ravenUrl: string;
      bearer: string;
      instance: string;
      targetIdx: number;
    }
  | { type: "evictCache"; id: number };

self.onmessage = async (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  try {
    if (msg.type === "ping") {
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true });
      return;
    }
    if (msg.type === "boot") {
      const result = await handleBoot(msg.ravenUrl, msg.bearer, msg.instance);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
      return;
    }
    if (msg.type === "query") {
      const result = await handleQuery(
        msg.ravenUrl,
        msg.bearer,
        msg.instance,
        msg.targetIdx
      );
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
      return;
    }
    if (msg.type === "evictCache") {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const req = tx.objectStore(STORE).clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
      }
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true });
      return;
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: (msg as { id: number }).id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function postProgress(instance: string, phase: BootPhase, detail?: Record<string, unknown>) {
  (self as unknown as Worker).postMessage({
    type: "progress",
    instance,
    phase,
    detail: detail ?? {},
  });
}

type BootPhase =
  | "wasm-init"
  | "fetching-params"
  | "params-decoded"
  | "probing-idb"
  | "deserializing-session"
  | "building-session"
  | "writing-idb"
  | "ready"
  | "error";

async function handleBoot(
  ravenUrl: string,
  bearer: string,
  instance: string
): Promise<ColdResult> {
  postProgress(instance, "wasm-init");
  await ensureInit();
  const t0 = performance.now();

  postProgress(instance, "fetching-params");
  const fetchRes = await fetch(
    `${ravenUrl}/v1/instance/${encodeURIComponent(instance)}/params`,
    { headers: { Authorization: `Bearer ${bearer}` } }
  );
  if (!fetchRes.ok) throw new Error(formatHttpError("/params", fetchRes));
  const cfCacheStatus = fetchRes.headers.get("cf-cache-status");
  const etag = fetchRes.headers.get("etag");
  const reader = fetchRes.body?.getReader();
  const expectedTotal = Number(fetchRes.headers.get("content-length") ?? 0);
  let received = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        postProgress(instance, "fetching-params", {
          received,
          expected: expectedTotal,
        });
      }
    }
  } else {
    const buf = new Uint8Array(await fetchRes.arrayBuffer());
    chunks.push(buf);
    received = buf.length;
  }
  const body = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.length;
  }
  const t1 = performance.now();

  postProgress(instance, "params-decoded", { bytes: body.length });
  const params = decodeInstanceParams(body);
  const t2 = performance.now();

  postProgress(instance, "probing-idb");
  const crsHash = await sha256Hex(params.crsBincode);
  const cacheKey = `v1:${instance}:${crsHash}`;
  const bundle = build_instance_params_blob(
    params.inspireParamsBincode,
    params.shardConfigBincode
  );

  let cacheHit = false;
  let newSession: ClientSessionHandle | null = null;
  const cached = await idbGetSession(cacheKey);
  if (cached) {
    try {
      postProgress(instance, "deserializing-session");
      newSession = deserialize_client_session(bundle, params.crsBincode, cached);
      cacheHit = true;
    } catch {
      newSession = null;
    }
  }
  if (!newSession) {
    postProgress(instance, "building-session");
    newSession = build_client_session(bundle, params.crsBincode);
    try {
      postProgress(instance, "writing-idb");
      const blob = serialize_client_session(newSession);
      await idbPutSession(cacheKey, blob);
    } catch {
    }
  }
  const t3 = performance.now();

  session = newSession;
  lastBundle = { bundle, params };
  postProgress(instance, "ready", { cacheHit, totalMs: t3 - t0 });

  return {
    paramsFetchMs: t1 - t0,
    paramsBodyBytes: body.length,
    envelopeDecodeMs: t2 - t1,
    buildSessionMs: t3 - t2,
    totalMs: t3 - t0,
    cacheHit,
    cfCacheStatus,
    etag,
  };
}

async function handleQuery(
  ravenUrl: string,
  bearer: string,
  instance: string,
  targetIdx: number
): Promise<QueryResult> {
  if (!session || !lastBundle) throw new Error("worker: boot before query");
  const t0 = performance.now();
  const queryBundle = build_seeded_query(
    session,
    lastBundle.params.shardConfigBincode,
    BigInt(targetIdx)
  );
  const queryBundleParsed = decodeQueryBundle(queryBundle);
  const t1 = performance.now();

  const wire = new Uint8Array(2 + queryBundleParsed.queryBytes.length);
  wire[0] = 0;
  wire[1] = 1;
  wire.set(queryBundleParsed.queryBytes, 2);
  const url = `${ravenUrl}/v1/instance/${encodeURIComponent(instance)}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      Authorization: `Bearer ${bearer}`,
    },
    body: wire,
  });
  const respBytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(formatHttpError("/query", res));
  if (respBytes.length < 2 || ((respBytes[0] << 8) | respBytes[1]) !== 1)
    throw new Error("bad response envelope");
  const inner = respBytes.subarray(2);
  const freshness = res.headers.get("x-raven-freshness");
  const t2 = performance.now();

  const plaintext = extract_response(
    session,
    lastBundle.params.crsBincode,
    queryBundleParsed.clientStateBincode,
    inner,
    Number(lastBundle.params.entrySize)
  );
  const t3 = performance.now();

  const recoveredHex = bytesToHexLocal(plaintext.subarray(0, 32));
  const previewBytes = wire.subarray(0, Math.min(64, wire.length));
  const respPreview = inner.subarray(0, Math.min(64, inner.length));
  return {
    buildQueryMs: t1 - t0,
    postMs: t2 - t1,
    extractMs: t3 - t2,
    totalMs: t3 - t0,
    queryBytes: wire.length,
    responseBytes: inner.length,
    freshness,
    recoveredHex,
    request: {
      method: "POST",
      url,
      bodyBytesPreviewHex: bytesToHexLocal(previewBytes),
      bodyBytesLen: wire.length,
    },
    response: {
      status: res.status,
      bodyBytesPreviewHex: bytesToHexLocal(respPreview),
      bodyBytesLen: inner.length,
    },
  };
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function decodeQueryBundle(bytes: Uint8Array): {
  queryBytes: Uint8Array;
  clientStateBincode: Uint8Array;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stateLen = readU64LE(view, 0);
  const stateStart = 8;
  const stateEnd = stateStart + stateLen;
  if (stateEnd + 8 > bytes.length)
    throw new Error("decodeQueryBundle: truncated client_state");
  const queryLen = readU64LE(view, stateEnd);
  const queryStart = stateEnd + 8;
  const queryEnd = queryStart + queryLen;
  if (queryEnd > bytes.length) throw new Error("decodeQueryBundle: truncated query");
  return {
    clientStateBincode: bytes.subarray(stateStart, stateEnd),
    queryBytes: bytes.subarray(queryStart, queryEnd),
  };
}
