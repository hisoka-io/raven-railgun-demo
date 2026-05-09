import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { CHAIN, PIR_BENCH, PIR_TABLES } from "@/lib/numbers";
import { formatBytes, formatLatency, formatNumber } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { Tooltip } from "@/components/ui/Tooltip";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { StageTimeline, type TimelineNode } from "@/components/StageTimeline";
import { BootIndicator } from "@/components/BootIndicator";

const PPOI_PATH_INSTANCE = "ppoi-paths-ofac";

interface SiblingResult {
  index: number;
  hex: string;
  postMs: number;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; done: number }
  | { kind: "ok"; siblings: SiblingResult[]; pastFill: boolean }
  | { kind: "error"; message: string };

const RAILGUN_ZERO_LEAF = "0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc";

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
    setState({ kind: "running", done: 0 });
    const myLeaf = leafIndex;
    const siblings: SiblingResult[] = [];
    const settled = await Promise.allSettled(
      Array.from({ length: 16 }, async (_, level) => {
        const idx = siblingRowIndex(level, myLeaf);
        const t0 = performance.now();
        const r = await boot.query(PPOI_PATH_INSTANCE, idx);
        siblings[level] = {
          index: level,
          hex: `0x${r.recoveredHex}`,
          postMs: performance.now() - t0,
        };
        setState((prev) =>
          prev.kind === "running" ? { kind: "running", done: prev.done + 1 } : prev
        );
      })
    );
    const firstReject = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstReject) {
      const reason = firstReject.reason;
      setState({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }
    const pastFill = siblings.every((s) => s.hex.toLowerCase().endsWith(RAILGUN_ZERO_LEAF));
    setState({ kind: "ok", siblings, pastFill });
  }

  const phase: StagePhase = useMemo(
    () =>
      state.kind === "running"
        ? "running"
        : state.kind === "ok"
        ? "done"
        : state.kind === "error"
        ? "error"
        : "idle",
    [state]
  );

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-2">
            spend-time leak
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl mb-3">PPOI Merkle path, privately</h1>
          <p className="text-fg-secondary text-[0.95rem] leading-relaxed">
            When stock wallets prepare a spend, they ask the PPOI server for the Merkle path of
            the input being spent. The server learns spend timing and the exact UTXO before any
            block confirms. Combined with broadcaster collusion this is a deanonymization
            channel. Raven substitutes a 16-sibling private retrieval against{" "}
            <Tooltip
              content={
                <div className="space-y-1">
                  <div>cell shape: 131,072 entries x 32 B = 4.0 MiB</div>
                  <div>row layout: per-list IMT node hashes; flat-index ordering</div>
                  <div>per-query: ~71.9 ms total / 69.3 ms server (3-seed median)</div>
                </div>
              }
            >
              <code className="font-mono text-[0.85rem] underline decoration-dotted underline-offset-2 cursor-help">
                {PPOI_PATH_INSTANCE}
              </code>
            </Tooltip>
            ; the operator does not learn which input is moving.
          </p>
        </div>

        <PpoiPathTimeline phase={phase} />

        <BootIndicator className="mt-6 max-w-2xl" primaryInstance={PPOI_PATH_INSTANCE} />

        <div className="mt-8 border border-fg-faint bg-bg-secondary p-5 max-w-2xl">
          <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-3">
            pick any leaf inside the PPOI tree
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono">
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
                className="bg-bg-input border border-fg-faint px-3 py-2 text-mono-xs text-fg outline-none focus:border-accent w-32"
              />
            </div>
            <button
              type="button"
              onClick={debouncedRun}
              disabled={state.kind === "running" || !boot.isReady(PPOI_PATH_INSTANCE)}
              className="inline-flex items-center gap-2 border border-accent text-accent px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.06em] hover:bg-accent hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!boot.isReady(PPOI_PATH_INSTANCE) ? "Privacy keys still loading" : undefined}
            >
              {!boot.isReady(PPOI_PATH_INSTANCE)
                ? "Preparing privacy keys..."
                : state.kind === "running"
                ? `Fetching siblings (${state.done}/16)...`
                : "Fetch 16 sibling hashes"}
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {state.kind === "error" && (
          <div className="mt-6 border border-error/40 bg-error/5 p-4 text-[0.85rem] text-fg-secondary max-w-3xl">
            <strong className="text-error">verify failed</strong> · {state.message}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </section>
  );
}

function PpoiPathTimeline({ phase }: { phase: StagePhase }) {
  const nodes: TimelineNode[] = [
    { id: "pick", label: "Pick a leaf", phase: phase === "idle" ? "idle" : "done" },
    { id: "fan", label: "16 PIR queries", phase },
    { id: "render", label: "Render path", phase: phase === "done" ? "done" : "idle" },
    { id: "log", label: "Operator log", phase: phase === "done" ? "done" : "idle" },
  ];
  const activeIndex = phase === "idle" ? 0 : phase === "running" ? 1 : phase === "done" ? 3 : 1;
  return (
    <div className="mt-6">
      <StageTimeline nodes={nodes} activeIndex={activeIndex} onSelect={() => undefined} />
    </div>
  );
}
