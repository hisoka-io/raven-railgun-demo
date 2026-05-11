import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, WALLET_FOOTPRINT, PIR_TABLES } from "@/lib/numbers";
import { foldMerklePath } from "@/lib/poseidon-fold";
import { rootInHistory, liveNextLeafIndex } from "@/lib/chain-verify";
import { useIndexerStatus } from "@/lib/use-indexer-status";
import { fetchCommitmentAt, type ChainCommitment } from "@/lib/subsquid-client";
import { formatBytes, formatLatency, formatNumber, shortHex } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { BootIndicator } from "@/components/BootIndicator";
import { CONFIG } from "@/lib/config";

interface SiblingResult {
  index: number;
  hex: string;
  postMs: number;
  upBytes: number;
  downBytes: number;
}

type RunningPhase = "starting" | "booting" | "pir" | "fold" | "chain";

type VerifyState =
  | { kind: "idle" }
  | { kind: "running"; phase: RunningPhase; progress?: number }
  | {
      kind: "done";
      siblings: SiblingResult[];
      pirLeafHex: string;
      foldedRoot: string;
      onChain: boolean;
      leafCommit: ChainCommitment | null;
      wallMs: number;
      totalUpBytes: number;
      totalDownBytes: number;
    }
  | { kind: "error"; message: string };

const PHASE_LABEL: Record<RunningPhase, string> = {
  starting: "Starting",
  booting: "Booting PIR session",
  pir: "Fetching encrypted path",
  fold: "Folding with Poseidon",
  chain: "Verifying on mainnet",
};

// Fraction of the run that each phase represents (purely cosmetic; drives
// the mini progress strip on the collapsed technical-details summary).
const PHASE_FRACTION: Record<RunningPhase, number> = {
  starting: 0.04,
  booting: 0.18,
  pir: 0.72,
  fold: 0.86,
  chain: 0.96,
};

const INSTANCE_FOR_TREE = (treeNumber: number) => `commit-tree-${treeNumber}`;
const TREE1_LAST_FILLED_INDEX = 65_534;

function maxValidLeafFor(treeNumber: number, liveFill: number | null): number | null {
  if (treeNumber === CHAIN.liveTreeIndex) {
    return liveFill !== null ? Math.max(0, liveFill - 1) : null;
  }
  if (treeNumber === 1) return TREE1_LAST_FILLED_INDEX;
  return CHAIN.treeMaxItems - 1;
}

export function CommitTreePath() {
  const boot = useBoot();
  const [treeNumber, setTreeNumber] = useState(0);
  const [leafIndex, setLeafIndex] = useState(0);
  const [state, setState] = useState<VerifyState>({ kind: "idle" });
  const [liveFill, setLiveFill] = useState<number | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const chosenInstance = INSTANCE_FOR_TREE(treeNumber);

  useEffect(() => {
    setLiveFill(null);
    if (treeNumber !== CHAIN.liveTreeIndex) return;
    let cancelled = false;
    liveNextLeafIndex()
      .then((n) => { if (!cancelled) setLiveFill(n); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [treeNumber]);

  useEffect(() => {
    setState({ kind: "idle" });
    runIdRef.current += 1;
  }, [treeNumber, leafIndex]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const maxLeafIndex = maxValidLeafFor(treeNumber, liveFill);
  const leafOutOfRange = maxLeafIndex !== null && leafIndex > maxLeafIndex;

  const indexerStatus = useIndexerStatus(chosenInstance);
  const indexerStale = false;

  const stagePhases = useMemo<{
    pir: StagePhase;
    fold: StagePhase;
    chain: StagePhase;
  }>(() => {
    if (state.kind === "idle") return { pir: "idle", fold: "idle", chain: "idle" };
    if (state.kind === "error") return { pir: "error", fold: "error", chain: "error" };
    if (state.kind === "running") {
      const p = state.phase;
      const pirDone = p === "fold" || p === "chain";
      return {
        pir: p === "pir" ? "running" : pirDone ? "done" : (p === "starting" || p === "booting") ? "idle" : "idle",
        fold: p === "fold" ? "running" : p === "chain" ? "done" : "idle",
        chain: p === "chain" ? "running" : "idle",
      };
    }
    return { pir: "done", fold: "done", chain: "done" };
  }, [state]);

  useEffect(() => {
    boot.ensureBooted(chosenInstance).catch(() => undefined);
  }, [boot, chosenInstance]);

  function siblingRowIndex(level: number, leaf: number): number {
    const base = (1 << 17) - (1 << (17 - level));
    return base + ((leaf >>> level) ^ 1);
  }

  async function runVerify() {
    if (leafOutOfRange) {
      setState({ kind: "error", message: "leaf index out of range for this tree" });
      return;
    }
    if (indexerStale) {
      setState({ kind: "error", message: "indexer is mid-catch-up; retry once it converges" });
      return;
    }
    const myRunId = ++runIdRef.current;
    const myInstance = chosenInstance;
    const myTree = treeNumber;
    const myLeaf = leafIndex;
    const cancelled = () => !mountedRef.current || runIdRef.current !== myRunId;
    const safeSet = (s: VerifyState) => { if (!cancelled()) setState(s); };
    const wallStart = performance.now();

    // Immediate feedback on click  -  starting state lands before any
    // async work fires so the user sees the button + collapsed
    // technical-details strip animate within ~1 frame.
    safeSet({ kind: "running", phase: "starting" });

    let cold;
    try {
      safeSet({ kind: "running", phase: "booting" });
      cold = await boot.ensureBooted(myInstance);
    } catch (err) {
      safeSet({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (cancelled()) return;
    safeSet({ kind: "running", phase: "pir", progress: 0 });

    const leafCommit = await fetchCommitmentAt(myTree, myLeaf).catch(() => null);
    if (cancelled()) return;

    const rows = [myLeaf, ...Array.from({ length: 16 }, (_, l) => siblingRowIndex(l, myLeaf))];
    const recoveredHex: string[] = new Array(17);
    const siblings: SiblingResult[] = [];
    let totalUpBytes = 0;
    let totalDownBytes = 0;
    // Single /batch call: all 17 rows are served from the SAME server-side
    // (epoch, state) snapshot, so the folded merkle path is internally
    // consistent — no Frankenstein fold across a chain-event apply.
    let batchResult;
    try {
      batchResult = await boot.batchQuery(myInstance, rows);
    } catch (err) {
      safeSet({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (cancelled()) return;
    if (batchResult.rowsHex.length !== rows.length) {
      safeSet({
        kind: "error",
        message: `batch returned ${batchResult.rowsHex.length} rows; expected ${rows.length}`,
      });
      return;
    }
    totalUpBytes = batchResult.queryBytes;
    totalDownBytes = batchResult.responseBytes;
    // Approx per-row time (single round-trip; charge equally).
    const perRowMs = batchResult.postMs / rows.length;
    const perRowUp = Math.floor(batchResult.queryBytes / rows.length);
    const perRowDown = Math.floor(batchResult.responseBytes / rows.length);
    for (let slot = 0; slot < rows.length; slot += 1) {
      recoveredHex[slot] = `0x${batchResult.rowsHex[slot]}`;
      if (slot >= 1) {
        siblings[slot - 1] = {
          index: slot - 1,
          hex: `0x${batchResult.rowsHex[slot]}`,
          postMs: perRowMs,
          upBytes: perRowUp,
          downBytes: perRowDown,
        };
      }
    }
    if (!cancelled()) safeSet({ kind: "running", phase: "pir", progress: rows.length });

    safeSet({ kind: "running", phase: "fold" });
    let foldedRoot = "";
    try {
      foldedRoot = await foldMerklePath(
        recoveredHex[0],
        siblings.map((s) => s.hex),
        myLeaf
      );
    } catch (err) {
      safeSet({ kind: "error", message: `fold failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (cancelled()) return;

    safeSet({ kind: "running", phase: "chain" });
    let onChain = false;
    try {
      onChain = await rootInHistory(myTree, foldedRoot);
    } catch (err) {
      safeSet({ kind: "error", message: `chain verify failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (cancelled()) return;

    safeSet({
      kind: "done",
      siblings,
      pirLeafHex: recoveredHex[0],
      foldedRoot,
      onChain,
      leafCommit,
      wallMs: performance.now() - wallStart,
      totalUpBytes,
      totalDownBytes,
    });
    void cold;
  }

  const ready = boot.isReady(chosenInstance) && !leafOutOfRange && !indexerStale;
  const running = state.kind === "running";
  const inputMax = maxLeafIndex ?? CHAIN.treeMaxItems - 1;

  const runningPhase: RunningPhase | null = running ? state.phase : null;
  const runningFraction = runningPhase ? PHASE_FRACTION[runningPhase] : 0;
  const runningLabel = runningPhase
    ? runningPhase === "pir"
      ? `${PHASE_LABEL.pir} · 16 queries in flight`
      : PHASE_LABEL[runningPhase]
    : null;

  return (
    <section className="bg-bg">
      <FadeStyle />
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero  -  tight one-screen description + verified storage numbers */}
        <div className="pt-14 sm:pt-20 pb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Demo · Commit-tree path
          </p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl lg:text-[3.75rem] leading-[1.02] tracking-tight max-w-[20ch] font-normal">
            Verify a Merkle root without the tree.
          </h1>

          <p className="mt-6 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            Stock Railgun engines persist every shield + transact event ever appended on
            chain  -  {formatNumber(WALLET_FOOTPRINT.currentMainnetLeaves)} commitments across {CHAIN.staticTrees} filled trees plus tree {CHAIN.liveTreeIndex}  -  alongside the
            full IMT. <span className="text-fg">~{formatBytes(WALLET_FOOTPRINT.currentMainnetBytes)}</span>{" "}
            on a phone today, climbing past <span className="text-fg">~{formatBytes(WALLET_FOOTPRINT.fullSaturationBytes)}</span> once tree {CHAIN.liveTreeIndex} fills. As Railgun gets
            natively integrated into DeFi, trees fill in days. Mobile and edge
            wallets can't keep up.
          </p>
          <p className="mt-3 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            With PIR, a wallet trial-decrypts once, remembers only the{" "}
            <code className="font-mono text-[0.95em] text-fg">(tree, position)</code>{" "}
            of its owned notes  -  a few KB  -  and PIR-fetches the auth path on demand when
            it is about to spend. On-device commit-tree cost collapses from O(N) toward O(owned notes).
          </p>
        </div>

        {/* Step 01 - Pick  -  aligned controls, immediate loader on click */}
        <Step num="01" kicker="Pick a leaf">
          <div className="mt-8 flex flex-wrap items-end gap-4">
            <Field label="tree">
              <select
                value={treeNumber}
                onChange={(e) => setTreeNumber(Number(e.target.value))}
                disabled={running}
                className="h-11 bg-bg-secondary border border-fg-faint px-3 font-mono text-[0.85rem] text-fg outline-none focus:border-accent disabled:opacity-50"
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>tree {n}</option>
                ))}
              </select>
            </Field>
            <Field label="leaf index">
              <input
                type="number"
                min={0}
                max={inputMax}
                value={leafIndex}
                onChange={(e) =>
                  setLeafIndex(
                    Math.max(0, Math.min(CHAIN.treeMaxItems - 1, Number(e.target.value)))
                  )
                }
                disabled={running}
                className="h-11 bg-bg-secondary border border-fg-faint px-3 font-mono text-[0.85rem] text-fg outline-none focus:border-accent w-32 tabular-nums disabled:opacity-50"
              />
            </Field>
            <button
              type="button"
              onClick={runVerify}
              disabled={running || !ready}
              className="h-11 inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {!boot.isReady(chosenInstance)
                ? "Preparing keys"
                : running
                ? state.phase === "pir"
                  ? `Fetching ${state.progress ?? 0}/16`
                  : PHASE_LABEL[state.phase]
                : "Fetch + verify"}
              {running ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowRight size={13} />
              )}
            </button>
            {running && (
              <span className="text-[0.7rem] font-mono text-fg-muted self-center">
                tree {treeNumber} · leaf {formatNumber(leafIndex)}
              </span>
            )}
          </div>
          {leafOutOfRange && (
            <p className="mt-4 text-[0.78rem] text-fg-muted leading-relaxed max-w-[58ch]">
              Leaf {formatNumber(leafIndex)} is past the fill point of tree {treeNumber}.
              Pick a leaf in [0, {formatNumber(maxLeafIndex ?? 0)}].
            </p>
          )}
        </Step>

        {/* Step 02 - Result */}
        <Step num="02" kicker="Result">
          {state.kind === "done" ? (
            <div className="mt-8 rr-fade-in">
              <div className="flex items-start gap-5">
                <span className="inline-flex w-10 h-10 items-center justify-center border border-success/40 bg-success/10 shrink-0 mt-1">
                  <Check size={18} className="text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                    {state.onChain ? "Root in mainnet history" : "Folded root"}
                  </div>
                  <div className="mt-3 font-mono text-[0.95rem] sm:text-[1.05rem] tabular-nums break-all text-fg leading-relaxed">
                    {state.foldedRoot}
                  </div>
                </div>
              </div>
              <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-fg-faint border border-fg-faint">
                <ResultStat label="time" value={formatLatency(state.wallMs)} />
                <ResultStat label="bytes up" value={formatBytes(state.totalUpBytes)} />
                <ResultStat label="bytes down" value={formatBytes(state.totalDownBytes)} />
                <ResultStat label="operator learned" value="nothing" tone="accent" />
              </div>
            </div>
          ) : state.kind === "error" ? (
            <div className="mt-8 border border-error/40 bg-error/5 p-5 text-[0.85rem] text-fg-secondary">
              <strong className="text-error">verify failed</strong> · {state.message}
            </div>
          ) : state.kind === "running" ? (
            <div className="mt-8 rr-fade-in flex items-start gap-5">
              <span className="inline-flex w-10 h-10 items-center justify-center border border-accent/40 bg-accent/5 shrink-0 mt-1">
                <Loader2 size={18} className="text-accent animate-spin" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                  {runningLabel}
                </div>
                <div className="mt-3 h-1 w-full bg-fg-faint relative overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${Math.round(runningFraction * 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-[0.78rem] text-fg-muted leading-relaxed">
                  {state.phase === "pir"
                    ? "16 encrypted queries are flying against the operator. Open DevTools and watch the POST to /v1/instance/" + chosenInstance + "/batch  -  the body is opaque ciphertext, no row index."
                    : state.phase === "fold"
                    ? "Folding the 16 sibling hashes locally with Poseidon to a candidate root."
                    : state.phase === "chain"
                    ? "Read-only eth_call to the Railgun proxy: rootHistory(tree, root)."
                    : state.phase === "booting"
                    ? "Loading the cached PIR session from IndexedDB (or building one if this device hasn't seen this instance before)."
                    : "Click queued. Starting now..."}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-8 text-fg-muted">Run step 01 to populate.</p>
          )}
        </Step>

        {/* Single technical-details disclosure  -  mini progress strip when running + collapsed */}
        <details className="mb-24 border border-fg-faint bg-bg-secondary group">
          <summary className="cursor-pointer list-none px-6 sm:px-8 py-6 hover:bg-bg-hover transition-colors">
            <div className="flex items-center gap-5">
              <span className="inline-flex w-9 h-9 items-center justify-center border border-accent/50 text-accent font-mono text-lg shrink-0 group-open:rotate-45 transition-transform">
                +
              </span>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[0.78rem] uppercase tracking-[0.22em] text-fg font-mono font-medium">
                  {running ? "Live  -  " + (runningLabel ?? "running") : "Show technical details"}
                </span>
                <span className="text-[0.78rem] text-fg-secondary">
                  Per-stage cards · indexer freshness · operator log diff
                </span>
              </div>
              {running && (
                <Loader2 size={16} className="text-accent shrink-0 animate-spin group-open:hidden" />
              )}
            </div>
            {running && (
              <div className="mt-4 h-[2px] w-full bg-fg-faint relative overflow-hidden group-open:hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round(runningFraction * 100)}%` }}
                />
              </div>
            )}
          </summary>
          <div className="px-6 sm:px-8 pt-8 pb-10 space-y-8 border-t border-fg-faint">
            <BootIndicator primaryInstance={chosenInstance} />

            {indexerStatus && indexerStatus.lastApplied !== null && indexerStatus.chainHead !== null && (
              <div className="border border-fg-faint bg-bg-secondary px-4 py-2.5 text-[0.7rem] font-mono text-fg-secondary">
                <div>
                  <span className="uppercase tracking-[0.14em] text-fg-muted text-[0.6rem] mr-3">
                    {chosenInstance} indexer
                  </span>
                  chain head <span className="text-fg">{formatNumber(indexerStatus.chainHead)}</span>
                  {" · "}last leaf event applied at block <span className="text-fg">{formatNumber(indexerStatus.lastApplied)}</span>
                  {" · "}<span className="text-fg">{formatNumber(indexerStatus.lag ?? Math.max(0, indexerStatus.chainHead - indexerStatus.lastApplied))}</span> blocks since last event
                </div>
                {treeNumber === CHAIN.liveTreeIndex && (
                  <div className="mt-1 text-fg-muted text-[0.65rem]">
                    chain head advances live via WS subscribe; "blocks since last event" reflects sparse leaf inserts and is not indexer staleness
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PerStageCard
                index={1}
                title="Fan out 16 PIR queries"
                oneLiner={`Each query fetches one 32 B sibling hash from ${chosenInstance}.`}
                phase={stagePhases.pir}
                client={{
                  label: "Client (query gen)",
                  body: (
                    <>
                      <p>
                        The wallet computes 16 row indices, one per Merkle level, then encrypts each
                        index using the cached PIR session. The encrypted query bytes carry no
                        recoverable index even with the bearer token in hand.
                      </p>
                      <ul className="mt-2 text-mono-xs text-fg-secondary space-y-0.5">
                        <li>per query: ~{PIR_BENCH.clientGenMs.toFixed(2)} ms client gen</li>
                        <li>per query: {formatBytes(PIR_BENCH.upBytes)} up encrypted</li>
                        <li>16 queries fan out concurrently against the K=16 server semaphore</li>
                      </ul>
                    </>
                  ),
                }}
                server={{
                  label: "Server (respond)",
                  body: (
                    <>
                      <p>
                        For each query, the operator runs an NTT-domain matrix-vector multiply over
                        the encrypted index against the {formatBytes(PIR_TABLES.commitTreePathBytes)}
                        {" "}commit-tree table, then ships an encrypted response. The operator never
                        sees which row was requested.
                      </p>
                      <ul className="mt-2 text-mono-xs text-fg-secondary space-y-0.5">
                        <li>per query (3-seed median): {PIR_BENCH.serverRespondMs.toFixed(0)} ms server respond</li>
                        <li>response: {formatBytes(PIR_BENCH.downBytes)} encrypted</li>
                        <li>16 queries in flight: ~{PIR_BENCH.k4WallMs.toFixed(0)} ms wall (K=4 batched, server-side rayon)</li>
                      </ul>
                    </>
                  ),
                }}
                extract={
                  state.kind === "done"
                    ? {
                        label: `Client (extract) - ${state.siblings.length} of 16 sibling hashes recovered`,
                        body: (
                          <div className="space-y-2">
                            {state.siblings.map((s) => (
                              <div key={s.index} className="grid grid-cols-12 gap-2 items-center text-mono-xs">
                                <span className="col-span-1 text-fg-muted">L{s.index}</span>
                                <span className="col-span-2 text-fg-muted">{formatLatency(s.postMs)}</span>
                                <div className="col-span-9">
                                  <HexBlock hex={s.hex} label={`level ${s.index}`} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ),
                      }
                    : undefined
                }
              />

              <PerStageCard
                index={2}
                title="Fold locally with Poseidon"
                oneLiner="Hash the 16 siblings up the tree to a candidate root."
                phase={stagePhases.fold}
                client={{
                  label: "How the fold works",
                  body: (
                    <p>
                      Starting from the leaf commitment, at each level the wallet hashes the
                      current cursor with the sibling at that level using BN254 Poseidon
                      (`@railgun-community/poseidon-hash-wasm`). Side selection is the
                      {" "}{`leafIndex >> level`} parity. Same primitive Railgun&apos;s
                      contracts use for `merkleRoot()`.
                    </p>
                  ),
                  defaultOpen: false,
                }}
                extract={
                  state.kind === "done"
                    ? {
                        label: "Candidate root",
                        defaultOpen: true,
                        body: <HexBlock hex={state.foldedRoot} label="folded root" defaultOpen />,
                      }
                    : undefined
                }
              />

              {state.kind === "done" && (
                <PerStageCard
                  index={3}
                  title="PIR row 0 vs Subsquid leaf"
                  oneLiner="Cross-check the PIR-recovered leaf hash against the public indexer."
                  phase={state.leafCommit ? "done" : "idle"}
                  extract={{
                    label: "side-by-side",
                    defaultOpen: true,
                    body: (
                      <div className="space-y-3">
                        <div>
                          <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted mb-1">
                            recovered from PIR (raven row {leafIndex})
                          </div>
                          <HexBlock hex={state.pirLeafHex} label={`pir row ${leafIndex}`} defaultOpen />
                        </div>
                        {state.leafCommit ? (
                          <div>
                            <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted mb-1">
                              from public Subsquid indexer (commitments(treeNumber={treeNumber}, treePosition={leafIndex}))
                            </div>
                            <HexBlock
                              hex={bigintDecToHex(state.leafCommit.hash)}
                              label="subsquid leaf"
                              defaultOpen
                            />
                          </div>
                        ) : (
                          <p className="text-fg-muted text-[0.78rem]">
                            Subsquid lookup unavailable for this leaf. The PIR row above stands on its own.
                          </p>
                        )}
                      </div>
                    ),
                  }}
                />
              )}

              <PerStageCard
                index={4}
                title="Verify against mainnet"
                oneLiner="Ask the Railgun proxy whether this root has ever been pinned by the chain."
                phase={stagePhases.chain}
                client={{
                  label: "viem call (read-only)",
                  body: (
                    <p>
                      A read-only `eth_call` to{" "}
                      <code className="font-mono text-[0.78rem]">{shortHex(CONFIG.railgunProxy, 6, 4)}</code>
                      {" "}invokes
                      {" "}<code className="font-mono text-[0.78rem]">rootHistory(treeNumber, root)</code>.
                      The proxy returns true if the chain has ever pinned this root for the given
                      tree, false otherwise. No transaction, no gas.
                    </p>
                  ),
                }}
                extract={
                  state.kind === "done"
                    ? {
                        label: "rootHistory result",
                        defaultOpen: true,
                        body: state.onChain ? (
                          <div className="text-success text-[0.85rem]">
                            Mainnet agrees - folded root is in `rootHistory` for tree {treeNumber}.
                          </div>
                        ) : (
                          <div className="text-warning text-[0.85rem]">
                            Root not in mainnet history. Tree 0 is the canonical case; pick a leaf
                            in tree 0 to see the verifying-locally path go green.
                          </div>
                        ),
                      }
                    : undefined
                }
              />

              <PerStageCard
                index={5}
                title="What the operator learned"
                oneLiner="Bearer + 16 encrypted bytestrings. No row index, no auth path."
                phase={state.kind === "done" ? "done" : "idle"}
                client={{
                  label: "Operator log diff",
                  defaultOpen: true,
                  body: (
                    <pre className="text-mono-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">{`> POST /v1/instance/${chosenInstance}/query (x16)
< 200 (encrypted ServerResponse)
. operator sees: bearer + ~${formatBytes(PIR_BENCH.upBytes * 16)} encrypted up
. operator sees: ~${formatBytes(PIR_BENCH.downBytes * 16)} encrypted down
. operator does NOT see: tree ${treeNumber}, leaf ${formatNumber(leafIndex)}`}</pre>
                  ),
                }}
              />
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function Step({
  num,
  kicker,
  children,
}: {
  num: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-fg-faint pt-10 pb-16">
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-3xl text-accent leading-none">{num}</span>
        <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
          {kicker}
        </span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function ResultStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="bg-bg p-5 sm:p-6">
      <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
        {label}
      </div>
      <div
        className={`mt-3 font-mono text-[20px] tabular-nums leading-tight ${
          tone === "accent" ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function FadeStyle() {
  return (
    <style>{`@keyframes rr-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.rr-fade-in{animation:rr-fade-in .45s ease-out}`}</style>
  );
}

function bigintDecToHex(dec: string): string {
  const big = BigInt(dec);
  const hex = big.toString(16);
  return `0x${hex.padStart(64, "0")}`;
}
