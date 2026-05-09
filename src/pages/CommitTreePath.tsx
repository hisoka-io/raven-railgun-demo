import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, WALLET_FOOTPRINT, PIR_TABLES } from "@/lib/numbers";
import { foldMerklePath } from "@/lib/poseidon-fold";
import { rootInHistory, liveNextLeafIndex } from "@/lib/chain-verify";
import { useIndexerStatus } from "@/lib/use-indexer-status";
import { fetchCommitmentAt, type ChainCommitment } from "@/lib/subsquid-client";
import { formatBytes, formatLatency, formatNumber, shortHex } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { BootIndicator } from "@/components/BootIndicator";
import type { QueryResult } from "@/lib/pir-context";
import { CONFIG } from "@/lib/config";

interface SiblingResult {
  index: number;
  hex: string;
  postMs: number;
  upBytes: number;
  downBytes: number;
}

type VerifyState =
  | { kind: "idle" }
  | { kind: "running"; phase: "pir" | "fold" | "chain"; progress?: number }
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

  const chosenInstance = INSTANCE_FOR_TREE(treeNumber);

  useEffect(() => {
    if (treeNumber !== CHAIN.liveTreeIndex) return;
    let cancelled = false;
    liveNextLeafIndex()
      .then((n) => { if (!cancelled) setLiveFill(n); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [treeNumber]);

  const maxLeafIndex = maxValidLeafFor(treeNumber, liveFill);
  const leafOutOfRange = maxLeafIndex !== null && leafIndex > maxLeafIndex;

  const indexerStatus = useIndexerStatus(chosenInstance);

  const stagePhases = useMemo<{
    pir: StagePhase;
    fold: StagePhase;
    chain: StagePhase;
  }>(() => {
    if (state.kind === "idle") return { pir: "idle", fold: "idle", chain: "idle" };
    if (state.kind === "error") return { pir: "error", fold: "error", chain: "error" };
    if (state.kind === "running") {
      return {
        pir: state.phase === "pir" ? "running" : state.phase === "fold" || state.phase === "chain" ? "done" : "idle",
        fold: state.phase === "fold" ? "running" : state.phase === "chain" ? "done" : "idle",
        chain: state.phase === "chain" ? "running" : "idle",
      };
    }
    return { pir: "done", fold: "done", chain: "done" };
  }, [state]);

  useEffect(() => {
    boot.ensureBooted(chosenInstance).catch(() => undefined);
  }, [boot, chosenInstance]);

  const debouncedRun = useDebouncedCallback(() => {
    runVerify();
  }, 1_500);

  function siblingRowIndex(level: number, leaf: number): number {
    const base = (1 << 17) - (1 << (17 - level));
    return base + ((leaf >>> level) ^ 1);
  }

  async function runVerify() {
    const cold = await boot.ensureBooted(chosenInstance);
    const wallStart = performance.now();
    setState({ kind: "running", phase: "pir", progress: 0 });

    const leafCommit = await fetchCommitmentAt(treeNumber, leafIndex).catch(() => null);

    const rows = [leafIndex, ...Array.from({ length: 16 }, (_, l) => siblingRowIndex(l, leafIndex))];
    const recoveredHex: string[] = new Array(17);
    const siblings: SiblingResult[] = [];
    let totalUpBytes = 0;
    let totalDownBytes = 0;
    let done = 0;
    const promises = rows.map(async (idx, slot) => {
      const t0 = performance.now();
      const result: QueryResult = await boot.query(chosenInstance, idx);
      const postMs = performance.now() - t0;
      recoveredHex[slot] = `0x${result.recoveredHex}`;
      totalUpBytes += result.queryBytes;
      totalDownBytes += result.responseBytes;
      if (slot >= 1) {
        siblings[slot - 1] = {
          index: slot - 1,
          hex: `0x${result.recoveredHex}`,
          postMs,
          upBytes: result.queryBytes,
          downBytes: result.responseBytes,
        };
      }
      done += 1;
      setState({ kind: "running", phase: "pir", progress: done });
    });
    try {
      await Promise.all(promises);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }

    setState({ kind: "running", phase: "fold" });
    let foldedRoot = "";
    try {
      foldedRoot = await foldMerklePath(
        recoveredHex[0],
        siblings.map((s) => s.hex),
        leafIndex
      );
    } catch (err) {
      setState({ kind: "error", message: `fold failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    setState({ kind: "running", phase: "chain" });
    let onChain = false;
    try {
      onChain = await rootInHistory(treeNumber, foldedRoot);
    } catch (err) {
      setState({ kind: "error", message: `chain verify failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    setState({
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

  const ready = boot.isReady(chosenInstance) && !leafOutOfRange;
  const running = state.kind === "running";
  const inputMax = maxLeafIndex ?? CHAIN.treeMaxItems - 1;

  return (
    <section className="bg-bg">
      <FadeStyle />
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero */}
        <div className="pt-20 sm:pt-28 pb-16">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Demo · Commit-tree path
          </p>
          <h1 className="mt-5 font-serif text-5xl sm:text-6xl lg:text-[5.5rem] leading-[0.98] tracking-tight max-w-[18ch] font-normal">
            Verify a Merkle root
            <br />
            without the tree.
          </h1>
          <p className="mt-7 text-fg-secondary text-lg leading-relaxed max-w-[58ch]">
            Pull 16 sibling hashes privately, fold them locally, ask mainnet if the
            root agrees.
          </p>
        </div>

        {/* Step 01 — Pick */}
        <Step num="01" kicker="Pick a leaf">
          <div className="mt-8 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <Field label="tree">
              <select
                value={treeNumber}
                onChange={(e) => setTreeNumber(Number(e.target.value))}
                disabled={running}
                className="bg-bg-secondary border border-fg-faint px-3 py-2.5 font-mono text-[0.85rem] text-fg outline-none focus:border-accent"
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
                className="bg-bg-secondary border border-fg-faint px-3 py-2.5 font-mono text-[0.85rem] text-fg outline-none focus:border-accent w-32 tabular-nums"
              />
            </Field>
            <button
              type="button"
              onClick={debouncedRun}
              disabled={running || !ready}
              className="inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {!boot.isReady(chosenInstance)
                ? "Preparing keys"
                : running
                ? state.phase === "pir"
                  ? `Fetching ${state.progress ?? 0}/16`
                  : state.phase === "fold"
                  ? "Folding"
                  : "Verifying"
                : "Fetch + verify"}
              <ArrowRight size={13} />
            </button>
          </div>
        </Step>

        {/* Step 02 — What changes */}
        <Step num="02" kicker="What changes">
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-public">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Stock wallet
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                The phone replays every shield and transact event ever appended on
                chain and persists the full Merkle tree locally. Roughly{" "}
                {formatBytes(WALLET_FOOTPRINT.perDeviceRawBytes)} per device,
                growing daily.
              </p>
            </div>
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-accent">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Raven
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                16 encrypted queries pull just the sibling hashes for the leaf you
                pick. The operator holds the bearer token but never sees which row
                was requested.
              </p>
            </div>
          </div>
        </Step>

        {/* Step 03 — Result */}
        <Step num="03" kicker="Result">
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
          ) : (
            <p className="mt-8 text-fg-muted">Run step 01 to populate.</p>
          )}
          {leafOutOfRange && state.kind !== "done" && (
            <p className="mt-6 text-[0.85rem] text-fg-muted leading-relaxed max-w-[58ch]">
              Leaf {formatNumber(leafIndex)} is past the fill point of tree {treeNumber}. Pick a leaf in [0, {formatNumber(maxLeafIndex ?? 0)}].
            </p>
          )}
        </Step>

        {/* Single technical-details disclosure */}
        <details className="mb-24 border border-fg-faint bg-bg-secondary group">
          <summary className="cursor-pointer list-none flex items-center gap-5 px-6 sm:px-8 py-6 hover:bg-bg-hover transition-colors">
            <span className="inline-flex w-9 h-9 items-center justify-center border border-accent/50 text-accent font-mono text-lg shrink-0 group-open:rotate-45 transition-transform">
              +
            </span>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[0.78rem] uppercase tracking-[0.22em] text-fg font-mono font-medium">
                Show technical details
              </span>
              <span className="text-[0.78rem] text-fg-secondary">
                Per-stage cards · indexer freshness · operator log diff
              </span>
            </div>
          </summary>
          <div className="px-6 sm:px-8 pt-8 pb-10 space-y-8 border-t border-fg-faint">
            <div className="text-fg-secondary leading-relaxed max-w-[72ch]">
              <p>
                Stock Railgun wallets must replay every shield and transact event ever appended on
                chain (~{formatNumber(CHAIN.totalCommits)} commitments today across {CHAIN.staticTrees}
                {" "}filled trees) and persist the full incremental Merkle tree plus a copy of every
                raw commitment record locally. Raven PIR-fetches the auth path on demand: pick any
                leaf in any tree, recover its 16 sibling hashes via 16 encrypted queries against{" "}
                <code className="font-mono text-[0.85rem]">{chosenInstance}</code>, fold them
                locally with Poseidon, ask mainnet whether the root agrees.
              </p>
            </div>

            <BootIndicator primaryInstance={chosenInstance} />

            {indexerStatus && indexerStatus.lastApplied !== null && indexerStatus.chainHead !== null && (
              <div className="border border-fg-faint bg-bg-secondary px-4 py-2.5 text-[0.7rem] font-mono text-fg-secondary">
                <span className="uppercase tracking-[0.14em] text-fg-muted text-[0.6rem] mr-3">
                  {chosenInstance} indexer
                </span>
                applied <span className="text-fg">{formatNumber(indexerStatus.lastApplied)}</span>
                {" · "}head <span className="text-fg">{formatNumber(indexerStatus.chainHead)}</span>
                {" · "}lag <span className="text-fg">{formatNumber(indexerStatus.lag ?? Math.max(0, indexerStatus.chainHead - indexerStatus.lastApplied))}</span> blk
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
                        label: `Client (extract) — ${state.siblings.length} of 16 sibling hashes recovered`,
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
                            Mainnet agrees — folded root is in `rootHistory` for tree {treeNumber}.
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
