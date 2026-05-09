import { CONFIG } from "./config";

interface PendingMsg {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
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

export interface BootProgress {
  type: "progress";
  instance: string;
  phase:
    | "wasm-init"
    | "fetching-params"
    | "params-decoded"
    | "probing-idb"
    | "deserializing-session"
    | "building-session"
    | "writing-idb"
    | "ready"
    | "error";
  detail?: { received?: number; expected?: number; bytes?: number; cacheHit?: boolean; totalMs?: number };
}

type ProgressListener = (p: BootProgress) => void;

export class PirContext {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingMsg>();
  private bootP: Promise<ColdResult> | null = null;
  private currentInstance: string | null = null;
  private progressListeners = new Set<ProgressListener>();

  onProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../workers/pir-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (
      ev: MessageEvent<
        | { id: number; ok: boolean; result?: unknown; error?: string }
        | BootProgress
      >
    ) => {
      const data = ev.data as { type?: string };
      if (data.type === "progress") {
        for (const fn of this.progressListeners) fn(ev.data as BootProgress);
        return;
      }
      const { id, ok, result, error } = ev.data as {
        id: number;
        ok: boolean;
        result?: unknown;
        error?: string;
      };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error ?? "worker error"));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message));
      this.pending.clear();
    };
    return this.worker;
  }

  private send<T>(payload: Record<string, unknown>): Promise<T> {
    const w = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      w.postMessage({ ...payload, id });
    });
  }

  async boot(instance = CONFIG.defaultInstance): Promise<ColdResult> {
    if (this.bootP && this.currentInstance === instance) return this.bootP;
    this.bootP = null;
    this.currentInstance = instance;
    this.bootP = this.send<ColdResult>({
      type: "boot",
      ravenUrl: CONFIG.ravenUrl,
      bearer: CONFIG.ravenBearer,
      instance,
    });
    return this.bootP;
  }

  getCurrentInstance(): string | null {
    return this.currentInstance;
  }

  async query(targetIdx: number, instance?: string): Promise<QueryResult> {
    const inst = instance ?? this.currentInstance ?? CONFIG.defaultInstance;
    if (!this.bootP || this.currentInstance !== inst) {
      await this.boot(inst);
    }
    return this.send<QueryResult>({
      type: "query",
      ravenUrl: CONFIG.ravenUrl,
      bearer: CONFIG.ravenBearer,
      instance: inst,
      targetIdx,
    });
  }

  async evictCache(): Promise<void> {
    await this.send<void>({ type: "evictCache" });
    this.bootP = null;
    this.currentInstance = null;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.bootP = null;
    for (const p of this.pending.values()) p.reject(new Error("terminated"));
    this.pending.clear();
  }
}

let singleton: PirContext | null = null;
export function getPirContext(): PirContext {
  if (!singleton) singleton = new PirContext();
  return singleton;
}
