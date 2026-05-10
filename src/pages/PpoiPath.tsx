import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, PIR_TABLES } from "@/lib/numbers";
import { formatBytes, formatLatency, formatNumber } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { BootIndicator } from "@/components/BootIndicator";

const PPOI_PATH_INSTANCE = "ppoi-paths-ofac";
const RAILGUN_ZERO_LEAF = "0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc";

interface SiblingResult {
  index: number;
  hex: string;
  postMs: number;
  upBytes: number;
  downBytes: number;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; done: number }
  | {
      kind: "ok";
      siblings: SiblingResult[];
      pastFill: boolean;
      wallMs: number;
      totalUpBytes: number;
      totalDownBytes: number;
    }
  | { kind: "error"; message: string };

export function PpoiPath() {
  const boot = useBoot();
  const [leafIndex, setLeafIndex] = useState(0);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    boot.ensureBooted(PPOI_PATH_INSTANCE).catch(() => undefined);
  }, [boot]);

  const debouncedRun = useDebouncedCallback(() => {
    runVerify();
  }, 1_500);

  function siblingRowIndex(level: number, leaf: number): number {
    const base = (1 << 17) - (1 << (17 - level));
    return base + ((leaf >>> level) ^ 1);
  }

  async function runVerify() {
    if (state.kind === "running") return;
    const wallStart = performance.now();
    setState({ kind: "running", done: 0 });
    const myLeaf = leafIndex;
    const siblings: SiblingResult[] = [];
    const rows = Array.from({ length: 16 }, (_, level) => siblingRowIndex(level, myLeaf));
    let batchResult;
    try {
      batchResult = await boot.batchQuery(PPOI_PATH_INSTANCE, rows);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (batchResult.rowsHex.length !== rows.length) {
      setState({
        kind: "error",
        message: `batch returned ${batchResult.rowsHex.length} rows; expected ${rows.length}`,
      });
      return;
    }
    const perRowMs = batchResult.postMs / rows.length;
    const perRowUp = Math.floor(batchResult.queryBytes / rows.length);
    const perRowDown = Math.floor(batchResult.responseBytes / rows.length);
    for (let level = 0; level < rows.length; level += 1) {
      siblings[level] = {
        index: level,
        hex: `0x${batchResult.rowsHex[level]}`,
        postMs: perRowMs,
        upBytes: perRowUp,
        downBytes: perRowDown,
      };
    }
    setState((prev) =>
      prev.kind === "running" ? { kind: "running", done: rows.length } : prev
    );
    const totalUpBytes = batchResult.queryBytes;
    const totalDownBytes = batchResult.responseBytes;
    const pastFill = siblings.every((s) => s.hex.toLowerCase().endsWith(RAILGUN_ZERO_LEAF));
    setState({
      kind: "ok",
      siblings,
      pastFill,
      wallMs: performance.now() - wallStart,
      totalUpBytes,
      totalDownBytes,
    });
  }

  const phase: StagePhase =
    state.kind === "running"
      ? "running"
      : state.kind === "ok"
      ? "done"
      : state.kind === "error"
      ? "error"
      : "idle";

  return (
    <section className="bg-bg">
      <FadeStyle />
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero */}
        <div className="pt-20 sm:pt-28 pb-16">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Demo · PPOI path
          </p>
          <h1 className="mt-5 font-serif text-5xl sm:text-6xl lg:text-[5.5rem] leading-[0.98] tracking-tight max-w-[18ch] font-normal">
            Hide the
            <br />
            spend.
          </h1>
          <p className="mt-7 text-fg-secondary text-lg leading-relaxed max-w-[58ch]">
            The operator no longer learns which UTXO you are about to spend
            before chain confirms.
          </p>
        </div>

        {/* Step 01 - Pick */}
        <Step num="01" kicker="Pick a leaf">
          <div className="mt-8 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                leaf index
              </span>
              <input
                type="number"
                min={0}
                max={CHAIN.treeMaxItems - 1}
                value={leafIndex}
                onChange={(e) =>
                  setLeafIndex(
                    Math.max(0, Math.min(CHAIN.treeMaxItems - 1, Number(e.target.value)))
                  )
                }
                disabled={state.kind === "running"}
                className="bg-bg-secondary border border-fg-faint px-3 py-2.5 font-mono text-[0.85rem] text-fg outline-none focus:border-accent w-32 tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={debouncedRun}
              disabled={state.kind === "running" || !boot.isReady(PPOI_PATH_INSTANCE)}
              className="inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {!boot.isReady(PPOI_PATH_INSTANCE)
                ? "Preparing keys"
                : state.kind === "running"
                ? `Fetching ${state.done}/16`
                : "Fetch path"}
              <ArrowRight size={13} />
            </button>
          </div>
        </Step>

        {/* Step 02 - What changes */}
        <Step num="02" kicker="What changes">
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-public">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Stock wallet
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                When preparing a spend, the wallet asks the PPOI server for the
                Merkle path of the input being spent. The server learns the exact
                UTXO and the spend timing before any block confirms.
              </p>
            </div>
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-accent">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Raven
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                16 encrypted queries pull each sibling on the path privately. The
                operator does not learn which input is moving.
              </p>
            </div>
          </div>
        </Step>

        {/* Step 03 - Result */}
        <Step num="03" kicker="Result">
          {state.kind === "error" ? (
            <div className="mt-8 border border-error/40 bg-error/5 p-5 text-[0.85rem] text-fg-secondary">
              <strong className="text-error">verify failed</strong> · {state.message}
            </div>
          ) : state.kind === "ok" ? (
            <div className="mt-8 rr-fade-in">
              <div className="flex items-start gap-5">
                <span className="inline-flex w-10 h-10 items-center justify-center border border-success/40 bg-success/10 shrink-0 mt-1">
                  <Check size={18} className="text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                    Path retrieved · {state.siblings.length}/16 siblings
                  </div>
                  <div className="mt-3 font-mono text-[0.95rem] sm:text-[1.05rem] tabular-nums break-all text-fg leading-relaxed">
                    {state.siblings[0]?.hex}
                  </div>
                </div>
              </div>
              {state.pastFill && (
                <div className="mt-6 border border-warning/40 bg-warning/5 p-4 text-[0.8rem] text-fg-secondary leading-relaxed max-w-[58ch]">
                  <strong className="text-warning">All 16 siblings came back as the empty-leaf zero hash.</strong>{" "}
                  This leaf is past the current PPOI list fill. Pick a smaller leaf index for real path data.
                </div>
              )}
              <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-fg-faint border border-fg-faint">
                <ResultStat label="time" value={formatLatency(state.wallMs)} />
                <ResultStat label="bytes up" value={formatBytes(state.totalUpBytes)} />
                <ResultStat label="bytes down" value={formatBytes(state.totalDownBytes)} />
                <ResultStat label="operator learned" value="nothing" tone="accent" />
              </div>
            </div>
          ) : (
            <p className="mt-8 text-fg-muted">Run step 01 to populate.</p>
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
                Per-stage card · operator log diff
              </span>
            </div>
          </summary>
          <div className="px-6 sm:px-8 pt-8 pb-10 space-y-8 border-t border-fg-faint">
            <div className="text-fg-secondary leading-relaxed max-w-[72ch]">
              <p>
                When stock wallets prepare a spend, they ask the PPOI server for the Merkle path of
                the input being spent. The server learns spend timing and the exact UTXO before any
                block confirms. Combined with broadcaster collusion this is a deanonymization
                channel. Raven substitutes a 16-sibling private retrieval against{" "}
                <code className="font-mono text-[0.85rem]">{PPOI_PATH_INSTANCE}</code>; the
                operator does not learn which input is moving.
              </p>
            </div>

            <BootIndicator primaryInstance={PPOI_PATH_INSTANCE} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PerStageCard
                index={1}
                title="Per-list-node encoder, 16 queries"
                oneLiner={`Each query returns one 32 B sibling hash from the per-list IMT.`}
                phase={phase}
                client={{
                  label: "Client (query gen)",
                  body: (
                    <p>
                      Each query encrypts a single row index. The 16 indices walk the levels 0..15
                      of the per-list IMT for the leaf at index{" "}
                      <code className="font-mono text-[0.78rem]">{formatNumber(leafIndex)}</code>.
                      All 16 fan out concurrently.
                    </p>
                  ),
                }}
                server={{
                  label: "Server (respond)",
                  body: (
                    <p>
                      The operator runs a private retrieval against the
                      {" "}{formatBytes(PIR_TABLES.ppoiPathBytes)} per-list-node table. Each row
                      holds exactly one 32 B sibling. 16 in parallel, ~{PIR_BENCH.k4WallMs.toFixed(0)}
                      {" "}ms wall on the K=4 batched path.
                    </p>
                  ),
                }}
                extract={
                  state.kind === "ok"
                    ? {
                        label: `Recovered ${state.siblings.length} sibling hashes`,
                        defaultOpen: true,
                        body: (
                          <div className="space-y-2">
                            {state.pastFill && (
                              <div className="border border-warning/40 bg-warning/5 p-3 text-[0.78rem] text-fg-secondary leading-relaxed">
                                <strong className="text-warning">All 16 siblings came back as the empty-leaf zero hash.</strong>
                                {" "}This leaf index is past the current OFAC PPOI list fill, so the
                                PPOI table returned the per-level zero padding instead of real
                                sibling data. Pick a smaller leaf index, or check the operator
                                page to see how many entries the list has indexed so far.
                              </div>
                            )}
                            {state.siblings.map((s) => (
                              <div key={s.index} className="grid grid-cols-12 gap-2 items-center text-mono-xs">
                                <span className="col-span-1 text-fg-muted">L{s.index}</span>
                                <span className="col-span-2 text-fg-muted">
                                  {formatLatency(s.postMs)}
                                </span>
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
                title="What the operator learned"
                oneLiner="16 encrypted bytestrings. No leaf index, no path."
                phase={state.kind === "ok" ? "done" : "idle"}
                client={{
                  label: "Operator log diff",
                  defaultOpen: true,
                  body: (
                    <pre className="text-mono-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">{`> POST /v1/instance/${PPOI_PATH_INSTANCE}/query (x16)
< 200 (encrypted ServerResponse)
. up: ~${formatBytes(PIR_BENCH.upBytes * 16)} encrypted
. down: ~${formatBytes(PIR_BENCH.downBytes * 16)} encrypted
. operator does NOT see: leaf ${formatNumber(leafIndex)}, list key`}</pre>
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
