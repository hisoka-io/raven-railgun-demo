import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getPirContext,
  type ColdResult,
  type QueryResult,
  type BootProgress,
} from "@/lib/pir-context";
import { useToast } from "@/components/ui/Toast";
import fingerprints from "@/lib/crs-fingerprints.json";

export type BootPhase = BootProgress["phase"] | "idle";

export interface InstanceBootState {
  instance: string;
  phase: BootPhase;
  cacheHit: boolean | null;
  paramsReceivedBytes: number;
  paramsExpectedBytes: number;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  cold: ColdResult | null;
}

export const PHASE_LABEL: Record<BootPhase, string> = {
  idle: "idle",
  "wasm-init": "initializing WASM",
  "fetching-params": "downloading params",
  "params-decoded": "decoding params",
  "probing-idb": "probing IndexedDB cache",
  "deserializing-session": "deserializing cached session",
  "building-session": "building session",
  "writing-idb": "caching session",
  ready: "ready",
  error: "error",
};

const FETCH_PHASE_FRACTION: Record<BootPhase, number> = {
  idle: 0,
  "wasm-init": 0.05,
  "fetching-params": 0.05,
  "params-decoded": 0.45,
  "probing-idb": 0.5,
  "deserializing-session": 0.7,
  "building-session": 0.7,
  "writing-idb": 0.95,
  ready: 1,
  error: 1,
};

interface BootApi {
  states: Record<string, InstanceBootState>;
  ensureBooted(instance: string): Promise<ColdResult>;
  query(instance: string, targetIdx: number): Promise<QueryResult>;
  evictCache(): Promise<void>;
  expectedFingerprint(instance: string): string | null;
  isReady(instance: string): boolean;
  progressFraction(instance: string): number;
}

const Ctx = createContext<BootApi | null>(null);

export function useBoot(): BootApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBoot must be used inside <BootProvider>");
  return v;
}

interface FingerprintsManifest {
  capturedAt: string;
  source: string;
  instances: Record<
    string,
    { instance: string; sha256?: string; bytes?: number; capturedAt?: string; error?: string }
  >;
}

const MANIFEST = fingerprints as FingerprintsManifest;

function emptyState(instance: string): InstanceBootState {
  return {
    instance,
    phase: "idle",
    cacheHit: null,
    paramsReceivedBytes: 0,
    paramsExpectedBytes: MANIFEST.instances[instance]?.bytes ?? 0,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    cold: null,
  };
}

export function BootProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, InstanceBootState>>({});
  const inFlight = useRef<Map<string, Promise<ColdResult>>>(new Map());
  const ready = useRef<Set<string>>(new Set());
  const coldResults = useRef<Map<string, ColdResult>>(new Map());
  const failed = useRef<Map<string, Error>>(new Map());
  const toast = useToast();
  const toastIds = useRef<Map<string, number>>(new Map());

  const expectedFingerprint = useCallback(
    (instance: string) => MANIFEST.instances[instance]?.sha256 ?? null,
    []
  );

  useEffect(() => {
    const pir = getPirContext();
    return pir.onProgress((p) => {
      setStates((prev) => {
        const cur = prev[p.instance] ?? emptyState(p.instance);
        const next: InstanceBootState = {
          ...cur,
          phase: p.phase,
          startedAt: cur.startedAt ?? Date.now(),
        };
        if (p.phase === "fetching-params") {
          if (p.detail?.received !== undefined) {
            next.paramsReceivedBytes = p.detail.received;
          }
          if (p.detail?.expected && p.detail.expected > 0) {
            next.paramsExpectedBytes = p.detail.expected;
          }
        } else if (p.phase === "params-decoded" && p.detail?.bytes !== undefined) {
          next.paramsReceivedBytes = p.detail.bytes;
          if (next.paramsExpectedBytes === 0) {
            next.paramsExpectedBytes = p.detail.bytes;
          }
        } else if (p.phase === "ready") {
          next.cacheHit = p.detail?.cacheHit ?? false;
          next.completedAt = Date.now();
        }
        return { ...prev, [p.instance]: next };
      });
    });
  }, []);

  const ensureBooted = useCallback(
    async (instance: string): Promise<ColdResult> => {
      const cachedCold = coldResults.current.get(instance);
      if (ready.current.has(instance) && cachedCold) {
        return cachedCold;
      }
      const existing = inFlight.current.get(instance);
      if (existing) return existing;
      const cachedFail = failed.current.get(instance);
      if (cachedFail) throw cachedFail;

      const p = (async () => {
        const expected = expectedFingerprint(instance);
        const isFirstBoot = ready.current.size === 0;
        const toastId = toast.push({
          variant: "info",
          title: isFirstBoot ? "Preparing privacy keys" : `Preparing keys for ${instance}`,
          body: expected
            ? `~12s, one time per device. Expected fingerprint ${expected.slice(0, 12)}...`
            : "~12s, one time per device.",
        });
        toastIds.current.set(instance, toastId);
        setStates((prev) => ({
          ...prev,
          [instance]: { ...(prev[instance] ?? emptyState(instance)), startedAt: Date.now() },
        }));
        try {
          const cold = await getPirContext().boot(instance);
          ready.current.add(instance);
          coldResults.current.set(instance, cold);
          setStates((prev) => ({
            ...prev,
            [instance]: {
              ...(prev[instance] ?? emptyState(instance)),
              phase: "ready",
              cacheHit: cold.cacheHit,
              cold,
              completedAt: Date.now(),
              errorMessage: null,
            },
          }));
          toast.dismiss(toastId);
          toastIds.current.delete(instance);
          toast.push({
            variant: "success",
            title: cold.cacheHit ? `${instance} ready (cached)` : `${instance} ready`,
            body: cold.cacheHit
              ? `Warm path ${Math.round(cold.totalMs)} ms`
              : `First-time setup ${(cold.totalMs / 1000).toFixed(1)}s; future visits sub-second.`,
            durationMs: 4_000,
          });
          return cold;
        } catch (err) {
          const errorObj = err instanceof Error ? err : new Error(String(err));
          failed.current.set(instance, errorObj);
          setStates((prev) => ({
            ...prev,
            [instance]: {
              ...(prev[instance] ?? emptyState(instance)),
              phase: "error",
              errorMessage: errorObj.message,
            },
          }));
          toast.dismiss(toastId);
          toastIds.current.delete(instance);
          toast.push({
            variant: "error",
            title: `${instance} boot failed`,
            body: errorObj.message,
            durationMs: 8_000,
          });
          throw errorObj;
        }
      })();

      inFlight.current.set(instance, p);
      try {
        return await p;
      } finally {
        inFlight.current.delete(instance);
      }
    },
    [expectedFingerprint, toast]
  );

  const query = useCallback(
    async (instance: string, targetIdx: number): Promise<QueryResult> => {
      if (!ready.current.has(instance)) {
        await ensureBooted(instance);
      }
      return getPirContext().query(targetIdx, instance);
    },
    [ensureBooted]
  );

  const evictCache = useCallback(async () => {
    await getPirContext().evictCache();
    ready.current.clear();
    coldResults.current.clear();
    failed.current.clear();
    setStates({});
  }, []);

  const isReady = useCallback((instance: string) => ready.current.has(instance), []);

  const progressFraction = useCallback(
    (instance: string) => {
      const s = states[instance];
      if (!s) return 0;
      if (s.phase === "fetching-params" && s.paramsExpectedBytes > 0) {
        const fetchFraction = s.paramsReceivedBytes / s.paramsExpectedBytes;
        return 0.05 + 0.4 * Math.min(1, fetchFraction);
      }
      return FETCH_PHASE_FRACTION[s.phase] ?? 0;
    },
    [states]
  );

  const api = useMemo<BootApi>(
    () => ({
      states,
      ensureBooted,
      query,
      evictCache,
      expectedFingerprint,
      isReady,
      progressFraction,
    }),
    [states, ensureBooted, query, evictCache, expectedFingerprint, isReady, progressFraction]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
