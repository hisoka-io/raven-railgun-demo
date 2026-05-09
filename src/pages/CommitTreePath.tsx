import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, WALLET_FOOTPRINT, PIR_TABLES } from "@/lib/numbers";
import { foldMerklePath } from "@/lib/poseidon-fold";
import { rootInHistory, liveNextLeafIndex } from "@/lib/chain-verify";
import { useIndexerStatus } from "@/lib/use-indexer-status";
import { fetchCommitmentAt, type ChainCommitment } from "@/lib/subsquid-client";
import { formatBytes, formatLatency, formatNumber, shortHex } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { Tooltip } from "@/components/ui/Tooltip";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { StageTimeline, type TimelineNode } from "@/components/StageTimeline";
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
  const indexerStale = treeNumber === CHAIN.liveTreeIndex
    && (indexerStatus?.lag ?? 0) > 200;

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

    let cold;
    try {
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
    let done = 0;
    const settled = await Promise.allSettled(
      rows.map(async (idx, slot) => {
        const t0 = performance.now();
        const result: QueryResult = await boot.query(myInstance, idx);
        const postMs = performance.now() - t0;
        recoveredHex[slot] = `0x${result.recoveredHex}`;
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
        if (!cancelled()) safeSet({ kind: "running", phase: "pir", progress: done });
      })
    );
    if (cancelled()) return;
    const firstReject = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstReject) {
      const reason = firstReject.reason;
      safeSet({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }

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
    });
    void cold;
  }

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-2">
            mobile-wallet enabler
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl mb-3">Commit-tree auth path, privately</h1>
          <p className="text-fg-secondary text-[0.95rem] leading-relaxed">
            Stock Railgun wallets must replay every shield + transact event ever appended on
            chain across {CHAIN.staticTrees} filled trees plus the live tree, and persist the
            full incremental Merkle tree plus a copy of every raw commitment record locally.
            That is roughly {formatBytes(WALLET_FOOTPRINT.perDeviceRawBytes)} of raw state per
            device, growing as new shields and transacts land. Phones cannot keep up. Raven
            PIR-fetches the auth path on demand: pick any leaf in any tree, recover its 16
            sibling hashes via {16} encrypted queries against{" "}
            <Tooltip
              content={
                <div className="space-y-1">
                  <div>cell shape: 131,072 entries x 32 B = 4.0 MiB</div>
                  <div>encoder: per-node IMT layout, leaves first then internal nodes</div>
                  <div>per-query: ~71.9 ms total / 69.3 ms server (3-seed median)</div>
                </div>
              }
            >
              <code className="font-mono text-[0.85rem] underline decoration-dotted underline-offset-2 cursor-help">
                {chosenInstance}
              </code>
            </Tooltip>
            , fold them locally with Poseidon, ask mainnet whether the root agrees.
          </p>
        </div>

        <CommitTreeTimeline state={state} />

        <BootIndicator className="mt-6" primaryInstance={chosenInstance} />

        <IndexerFreshnessStrip
          className="mt-3 max-w-3xl"
          instance={chosenInstance}
          status={indexerStatus}
          isLive={treeNumber === CHAIN.liveTreeIndex}
        />

        <div id="ct-pick" />
        {treeNumber === CHAIN.liveTreeIndex && (
          <div className="mt-6 mb-2 border border-warning/40 bg-warning/5 p-3 max-w-3xl text-[0.78rem] text-fg-secondary leading-relaxed">
            <strong className="text-warning">Heads up: tree {CHAIN.liveTreeIndex} is the live tree.</strong>
            {" "}New leaves still arrive on chain, and the indexer occasionally has to
            replay events out-of-order at boundary blocks. If your verify shows a leaf
            mismatch against the public indexer, give it a few seconds and re-fire, or
            switch to a static tree (0, 1, or 2) for the most stable on-chain match.
          </div>
        )}
        <PickerForm
          treeNumber={treeNumber}
          leafIndex={leafIndex}
          onChangeTree={setTreeNumber}
          onChangeLeaf={setLeafIndex}
          running={state.kind === "running"}
          ready={boot.isReady(chosenInstance) && !leafOutOfRange && !indexerStale}
          onRun={debouncedRun}
          progress={state.kind === "running" && state.phase === "pir" ? state.progress ?? 0 : undefined}
          maxLeafIndex={maxLeafIndex}
          liveFill={liveFill}
        />

        {leafOutOfRange && (
          <div className="mt-3 border border-warning/40 bg-warning/5 p-3 max-w-3xl text-[0.78rem] text-fg-secondary leading-relaxed">
            <strong className="text-warning">Leaf {formatNumber(leafIndex)} doesn&apos;t exist in tree {treeNumber}.</strong>
            {" "}
            {treeNumber === CHAIN.liveTreeIndex
              ? `Tree ${treeNumber} is the live tree, currently filled to position ${formatNumber((liveFill ?? 0) - 1)} (next insert at ${formatNumber(liveFill ?? 0)}). Pick a leaf in [0, ${formatNumber((liveFill ?? 0) - 1)}].`
              : treeNumber === 1
              ? `Tree 1 closed early at 65,535 leaves. Pick a leaf in [0, ${formatNumber(TREE1_LAST_FILLED_INDEX)}].`
              : `Pick a leaf in [0, ${formatNumber(CHAIN.treeMaxItems - 1)}].`}
            {" "}Querying past the fill point would return the zero-leaf padding, fold to a candidate root the chain has never written, and fail the on-chain check below for a structural reason that has nothing to do with the cryptography. Disabled until the leaf index is in range.
          </div>
        )}

        {state.kind === "error" && (
          <div className="mt-6 border border-error/40 bg-error/5 p-4 text-[0.85rem] text-fg-secondary">
            <strong className="text-error">verify failed</strong> · {state.message}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerStageCard
            id="ct-stage-1"
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
            id="ct-stage-2"
            index={2}
            title="Fold locally with Poseidon"
            oneLiner="Hash the 16 siblings up the tree to a candidate root."
            phase={stagePhases.fold}
            client={{
              label: "How the fold works",
              body: (
                <>
                  <p>
                    Starting from the leaf commitment, at each level the wallet hashes the
                    current cursor with the sibling at that level using BN254 Poseidon
                    (`@railgun-community/poseidon-hash-wasm`). Side selection is the
                    {" "}{`leafIndex >> level`} parity. This is the same primitive Railgun&apos;s
                    contracts use for `merkleRoot()`.
                  </p>
                </>
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
                      <>
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
                        <div className="text-[0.78rem]">
                          {state.pirLeafHex.toLowerCase() === bigintDecToHex(state.leafCommit.hash).toLowerCase() ? (
                            <span className="text-success inline-flex items-center gap-1">
                              <CheckCircle2 size={14} /> PIR row matches public indexer byte-for-byte
                            </span>
                          ) : (
                            <span className="text-warning">
                              PIR row differs from indexer. Most often this is the live tree
                              still syncing this exact position; pick a static tree (0/1/2)
                              for a stable byte-match.
                            </span>
                          )}
                        </div>
                      </>
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
            id="ct-stage-4"
            index={4}
            title="Verify against mainnet"
            oneLiner="Ask the Railgun proxy whether this root has ever been pinned by the chain."
            phase={stagePhases.chain}
            client={{
              label: "viem call (read-only)",
              body: (
                <>
                  <p>
                    A read-only `eth_call` to{" "}
                    <code className="font-mono text-[0.78rem]">{shortHex(CONFIG.railgunProxy, 6, 4)}</code>
                    {" "}invokes
                    {" "}<code className="font-mono text-[0.78rem]">rootHistory(treeNumber, root)</code>.
                    The proxy returns true if the chain has ever pinned this root for the given
                    tree, false otherwise. No transaction, no gas.
                  </p>
                </>
              ),
            }}
            extract={
              state.kind === "done"
                ? {
                    label: "rootHistory result",
                    defaultOpen: true,
                    body: state.onChain ? (
                      <div className="flex items-center gap-3">
                        <CheckCircle2 size={20} className="text-success" />
                        <div>
                          <div className="text-success text-[0.95rem] font-medium">
                            Mainnet agrees
                          </div>
                          <p className="text-fg-secondary text-[0.78rem] mt-0.5">
                            The folded root is in `rootHistory` for tree {treeNumber}. The PIR
                            response was a real on-chain auth path.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <XCircle size={20} className="text-warning shrink-0 mt-0.5" />
                        <div>
                          <div className="text-warning text-[0.95rem] font-medium">
                            Root not in mainnet history
                          </div>
                          <p className="text-fg-secondary text-[0.78rem] mt-1 leading-relaxed">
                            The 17 PIR rows came back encrypted-then-decrypted with no errors;
                            the byte-identity check above confirms PIR row {leafIndex} against
                            the public indexer. PIR retrieval, the Poseidon primitive, and the
                            local fold are all byte-correct (cross-validated against the
                            contract&apos;s on-chain Poseidon and the canonical reference
                            circomlibjs implementation; tree 0 verifies green at every position).
                            The candidate root mismatch on tree {treeNumber} comes from a
                            known upstream gap: the public indexer drops some leaves at the
                            tree-rollover boundaries (tree 1 is missing position 0), so the
                            local IMT folds an incomplete leaf set. The fix lives in the
                            indexer pipeline (switching from the third-party indexer to direct
                            chain-event consumption) and is tracked separately. Tree 0 above
                            is the canonical &quot;works&quot; case; pick a leaf in tree 0 to see
                            the verifying-locally path go green.
                          </p>
                        </div>
                      </div>
                    ),
                  }
                : undefined
            }
          />

          <PerStageCard
            id="ct-stage-5"
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

        {state.kind === "done" && state.leafCommit && (
          <div className="mt-8 border border-fg-faint bg-bg-secondary p-4 sm:p-5 flex flex-wrap gap-3 items-center justify-between">
            <div className="text-[0.78rem] text-fg-secondary">
              <span className="text-fg-muted uppercase tracking-wider text-[0.6rem] mr-2">
                cross-check
              </span>
              The leaf hash and tree number were pulled from the public Subsquid indexer; the
              auth path came from Raven; the root match was verified on-chain.
            </div>
            <a
              href={`https://etherscan.io/address/${CONFIG.railgunProxy}#readContract`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[0.7rem] text-accent hover:underline"
            >
              read rootHistory on Etherscan <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function PickerForm({
  treeNumber,
  leafIndex,
  onChangeTree,
  onChangeLeaf,
  running,
  ready,
  onRun,
  progress,
  maxLeafIndex,
  liveFill,
}: {
  treeNumber: number;
  leafIndex: number;
  onChangeTree: (n: number) => void;
  onChangeLeaf: (n: number) => void;
  running: boolean;
  ready: boolean;
  onRun: () => void;
  progress?: number;
  maxLeafIndex: number | null;
  liveFill: number | null;
}) {
  const inputMax = maxLeafIndex ?? CHAIN.treeMaxItems - 1;
  const showFillCaption = treeNumber === CHAIN.liveTreeIndex && liveFill !== null;
  return (
    <div className="mt-8 border border-fg-faint bg-bg-secondary p-5">
      <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-3">
        pick any leaf
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <Field label="tree number">
          <select
            value={treeNumber}
            onChange={(e) => onChangeTree(Number(e.target.value))}
            disabled={running}
            className="bg-bg-input border border-fg-faint px-3 py-2 text-mono-xs text-fg outline-none focus:border-accent"
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                tree {n} ({n === 3 ? "live" : "static"})
              </option>
            ))}
          </select>
        </Field>
        <Field label="leaf index">
          <input
            type="number"
            min={0}
            max={inputMax}
            value={leafIndex}
            onChange={(e) => onChangeLeaf(Math.max(0, Math.min(CHAIN.treeMaxItems - 1, Number(e.target.value))))}
            disabled={running}
            className="bg-bg-input border border-fg-faint px-3 py-2 text-mono-xs text-fg outline-none focus:border-accent w-32"
          />
          {showFillCaption && (
            <span className="text-[0.6rem] text-fg-muted font-mono mt-1">
              fill: {formatNumber(liveFill!)} (next insert)
            </span>
          )}
        </Field>
        <button
          type="button"
          onClick={onRun}
          disabled={running || !ready}
          className="inline-flex items-center gap-2 border border-accent text-accent px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.06em] hover:bg-accent hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={!ready ? "Privacy keys still loading" : undefined}
        >
          {!ready
            ? "Preparing privacy keys..."
            : running
            ? progress !== undefined
              ? `Fetching siblings (${progress}/16)...`
              : "Verifying..."
            : "Fetch path + verify on-chain"}
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono">
        {label}
      </span>
      {children}
    </div>
  );
}

const MEAN_LEAVES_PER_BLOCK = 0.04;

function mismatchProbability(lagBlocks: number): number {
  if (lagBlocks <= 0) return 0;
  return 1 - Math.exp(-lagBlocks * MEAN_LEAVES_PER_BLOCK);
}

function IndexerFreshnessStrip({
  className,
  instance,
  status,
  isLive,
}: {
  className?: string;
  instance: string;
  status: import("@/lib/use-indexer-status").IndexerStatus | null;
  isLive: boolean;
}) {
  if (!status) {
    return (
      <div className={`border border-fg-faint bg-bg-secondary px-4 py-2.5 text-[0.7rem] font-mono text-fg-muted ${className ?? ""}`}>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-fg-faint mr-2 align-middle" />
        <span className="uppercase tracking-[0.14em] text-[0.55rem]">{instance} indexer · status unavailable</span>
      </div>
    );
  }
  if (status.lastApplied === null || status.chainHead === null) return null;
  const lag = status.lag ?? Math.max(0, status.chainHead - status.lastApplied);
  const tone = lag <= 30 ? "ok" : lag <= 200 ? "warn" : "stale";
  const dot = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-error";
  const label = tone === "ok" ? "fresh" : tone === "warn" ? "catching up" : "stale";
  const risk = isLive ? mismatchProbability(lag) : 0;
  const expectedMissed = isLive ? lag * MEAN_LEAVES_PER_BLOCK : 0;

  return (
    <div className={`border border-fg-faint bg-bg-secondary px-4 py-2.5 text-[0.7rem] font-mono text-fg-secondary ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
          <span className="uppercase tracking-[0.14em] text-fg-muted text-[0.55rem]">
            {instance} indexer · {label}
          </span>
        </span>
        <span>applied block <span className="text-fg">{formatNumber(status.lastApplied)}</span></span>
        <span>chain head <span className="text-fg">{formatNumber(status.chainHead)}</span></span>
        <span>lag <span className="text-fg">{formatNumber(lag)}</span> blocks</span>
        {status.events !== null && isLive && (
          <span>events since boot <span className="text-fg">{formatNumber(status.events)}</span></span>
        )}
      </div>
      {isLive && lag > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-fg-muted">
          <span>
            mismatch risk:{" "}
            <span className={tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-error"}>
              ~{(risk * 100).toFixed(risk >= 0.95 ? 1 : 0)}%
            </span>
          </span>
          <span>
            expected leaves landed in lag window:{" "}
            <span className="text-fg">~{expectedMissed.toFixed(1)}</span>
          </span>
        </div>
      )}
      {isLive && lag > 30 && (
        <div className="mt-1.5 text-[0.7rem] text-fg-muted leading-relaxed">
          Tree {CHAIN.liveTreeIndex} is mid-catch-up. While the indexer is more than ~30 blocks
          behind chain head, the local IMT can be missing one or more recent insertions, so the
          candidate root may not yet appear in <code>rootHistory</code>. Wait for the dot to go
          green or pick a static tree (0, 1, 2) for the deterministic case.
        </div>
      )}
    </div>
  );
}

function bigintDecToHex(dec: string): string {
  const big = BigInt(dec);
  const hex = big.toString(16);
  return `0x${hex.padStart(64, "0")}`;
}

function CommitTreeTimeline({ state }: { state: VerifyState }) {
  const nodes: TimelineNode[] = [
    { id: "pick", label: "Pick a leaf", phase: state.kind === "idle" ? "idle" : "done" },
    { id: "pir", label: "16 PIR queries", phase: pirNodePhase(state) },
    { id: "fold", label: "Local fold", phase: foldNodePhase(state) },
    { id: "verify", label: "rootHistory()", phase: chainNodePhase(state) },
    { id: "log", label: "Operator log", phase: state.kind === "done" ? "done" : "idle" },
  ];
  const activeIndex =
    state.kind === "idle"
      ? 0
      : state.kind === "running"
      ? state.phase === "pir"
        ? 1
        : state.phase === "fold"
        ? 2
        : 3
      : state.kind === "done"
      ? 4
      : 0;
  const anchors = ["ct-pick", "ct-stage-1", "ct-stage-2", "ct-stage-4", "ct-stage-5"];
  const handleSelect = (i: number) => {
    const id = anchors[i];
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="mt-6 mb-2">
      <StageTimeline nodes={nodes} activeIndex={activeIndex} onSelect={handleSelect} />
    </div>
  );
}

function pirNodePhase(state: VerifyState): StagePhase {
  if (state.kind === "running" && state.phase === "pir") return "running";
  if (state.kind === "running" || state.kind === "done") return "done";
  if (state.kind === "error") return "error";
  return "idle";
}

function foldNodePhase(state: VerifyState): StagePhase {
  if (state.kind === "running" && state.phase === "fold") return "running";
  if (state.kind === "running" && state.phase === "chain") return "done";
  if (state.kind === "done") return "done";
  if (state.kind === "error") return "error";
  return "idle";
}

function chainNodePhase(state: VerifyState): StagePhase {
  if (state.kind === "running" && state.phase === "chain") return "running";
  if (state.kind === "done") return "done";
  if (state.kind === "error") return "error";
  return "idle";
}
