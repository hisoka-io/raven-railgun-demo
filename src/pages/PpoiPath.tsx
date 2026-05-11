import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, PIR_TABLES } from "@/lib/numbers";
import { formatBytes, formatLatency, formatNumber } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
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

type RunningPhase = "starting" | "fetching";
const PHASE_LABEL: Record<RunningPhase, string> = {
  starting: "Starting",
  fetching: "Fetching 16-sibling path",
};
const PHASE_FRACTION: Record<RunningPhase, number> = {
  starting: 0.05,
  fetching: 0.85,
};

type State =
  | { kind: "idle" }
  | { kind: "running"; phase: RunningPhase; done: number }
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

  function siblingRowIndex(level: number, leaf: number): number {
    const base = (1 << 17) - (1 << (17 - level));
    return base + ((leaf >>> level) ^ 1);
  }

  async function runVerify() {
    if (state.kind === "running") return;
    const wallStart = performance.now();
    setState({ kind: "running", phase: "starting", done: 0 });
    const myLeaf = leafIndex;
    const siblings: SiblingResult[] = [];
    const rows = Array.from({ length: 16 }, (_, level) => siblingRowIndex(level, myLeaf));
    setState({ kind: "running", phase: "fetching", done: 0 });
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

  const running = state.kind === "running";
  const runningPhase: RunningPhase | null = running ? state.phase : null;
  const runningFraction = runningPhase ? PHASE_FRACTION[runningPhase] : 0;
  const runningLabel = runningPhase ? PHASE_LABEL[runningPhase] : null;

  return (
    <section className="bg-bg">
      <FadeStyle />
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero  -  tight one-screen description */}
        <div className="pt-14 sm:pt-20 pb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Demo · PPOI path
          </p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl lg:text-[3.75rem] leading-[1.02] tracking-tight max-w-[20ch] font-normal">
            Hide the spend.
          </h1>
          <p className="mt-6 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            When preparing a spend, the stock Railgun wallet asks the PPOI server
            for the Merkle path of the input it is about to move. The server
            learns the exact UTXO and the spend timing before the block confirms.
            Combined with a colluding broadcaster, this is a deanonymization
            channel.
          </p>
          <p className="mt-3 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            With PIR, the 16-sibling auth-path retrieval runs encrypted end-to-end
            in one round-trip against{" "}
            <code className="font-mono text-[0.95em] text-fg">{PPOI_PATH_INSTANCE}</code>.
            The operator sees only opaque ciphertext  -  no leaf index, no path.
          </p>
        </div>

        {/* Step 01 - Pick  -  aligned controls, immediate loader on click */}
        <Step num="01" kicker="Pick a leaf">
          <div className="mt-8 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
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
                disabled={running}
                className="h-11 bg-bg-secondary border border-fg-faint px-3 font-mono text-[0.85rem] text-fg outline-none focus:border-accent w-32 tabular-nums disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={runVerify}
              disabled={running || !boot.isReady(PPOI_PATH_INSTANCE)}
              className="h-11 inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {!boot.isReady(PPOI_PATH_INSTANCE)
                ? "Preparing keys"
                : runningPhase
                ? PHASE_LABEL[runningPhase]
                : "Fetch path"}
              {running ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowRight size={13} />
              )}
            </button>
            {running && (
              <span className="text-[0.7rem] font-mono text-fg-muted self-center">
                leaf {formatNumber(leafIndex)}
              </span>
            )}
          </div>
        </Step>

        {/* Step 02 - Result  -  phase-aware running state */}
        <Step num="02" kicker="Result">
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
          ) : runningPhase ? (
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
                  {runningPhase === "fetching"
                    ? "16 encrypted queries are in flight as one /batch round-trip against " + PPOI_PATH_INSTANCE + ". Open DevTools and watch the POST body  -  opaque ciphertext, no leaf index."
                    : "Click queued. Starting now..."}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-8 text-fg-muted">Run step 01 to populate.</p>
          )}
        </Step>

        {/* Technical-details disclosure  -  mini progress strip when running + collapsed */}
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
                  Per-stage card · operator log diff
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
                      All 16 fan out concurrently as one /batch round-trip.
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
                    <pre className="text-mono-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">{`> POST /v1/instance/${PPOI_PATH_INSTANCE}/batch (x1, 16 rows)
< 200 (encrypted ServerResponse[16])
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
