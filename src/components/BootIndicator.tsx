import { useState } from "react";
import { useBoot, PHASE_LABEL, type InstanceBootState } from "@/lib/boot-context";
import { CheckCircle2, AlertCircle, Loader2, Info, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";

export function BootIndicator({
  className,
  primaryInstance,
}: {
  className?: string;
  primaryInstance?: string;
}) {
  const boot = useBoot();
  const [expanded, setExpanded] = useState(false);

  const allEntries = Object.values(boot.states).filter(
    (s) => s.phase !== "idle" || s.startedAt !== null
  );
  if (allEntries.length === 0) return null;

  const primary = primaryInstance
    ? allEntries.find((s) => s.instance === primaryInstance) ?? null
    : null;
  const others = primary
    ? allEntries.filter((s) => s.instance !== primaryInstance)
    : allEntries;

  const visibleEntries = primary
    ? expanded
      ? [primary, ...others]
      : [primary]
    : allEntries;

  const showToggle = !!primary && others.length > 0;

  return (
    <div className={cn("border border-fg-faint bg-bg-secondary", className)}>
      <div className="px-4 py-2 border-b border-fg-faint flex items-center gap-2 text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono">
        {showToggle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 hover:text-fg transition-colors"
            title={expanded ? "Collapse" : `Show ${others.length} other booted instance${others.length === 1 ? "" : "s"}`}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}
        <span>boot status</span>
        {showToggle && !expanded && (
          <span className="text-fg-faint normal-case tracking-normal text-[0.6rem]">
            (+{others.length} more)
          </span>
        )}
        <span className="flex-1" />
        <Tooltip
          content={
            <div className="space-y-1.5 leading-snug">
              <p>
                Each instance fetches its public CRS once (~33.4 MiB) and runs the WASM
                build_session step (~12s on first visit). The session blob is then
                chunked + SHA-256 verified into IndexedDB. Future visits short-circuit
                to a sub-second deserialize.
              </p>
              <p className="text-fg-muted">
                The 33.4 MiB / 12s figure is the V1 production cell at d=2048. Future
                seed-derived optimizations are tracked in our roadmap and can compress
                the cold-path payload to a few KiB; this version of the demo ships the
                full CRS to keep the verifier path identical to the locked benchmark.
              </p>
            </div>
          }
        >
          <Info size={11} className="text-fg-muted hover:text-fg cursor-help" />
        </Tooltip>
      </div>
      <div className="divide-y divide-fg-faint">
        {visibleEntries.map((s) => (
          <BootRow key={s.instance} state={s} fraction={boot.progressFraction(s.instance)} />
        ))}
      </div>
    </div>
  );
}

function BootRow({ state, fraction }: { state: InstanceBootState; fraction: number }) {
  const elapsedMs = state.completedAt
    ? state.completedAt - (state.startedAt ?? state.completedAt)
    : state.startedAt
    ? Date.now() - state.startedAt
    : 0;
  const isReady = state.phase === "ready";
  const isError = state.phase === "error";
  const isFetching = state.phase === "fetching-params";

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2 text-mono-xs">
        <PhaseIcon phase={state.phase} />
        <span className="text-fg flex-1 break-all">{state.instance}</span>
        {state.cacheHit !== null && (
          <Tooltip
            content={
              <div className="space-y-1 leading-snug">
                <p className="font-medium">
                  {state.cacheHit ? "Warm path · IDB hit" : "Cold path · IDB miss"}
                </p>
                <p>
                  IndexedDB (browser-side persistent storage) is checked by CRS hash
                  before any network fetch. {state.cacheHit
                    ? "The cached PIR session blob was found and deserialized in place; no params download needed."
                    : "No matching session blob was found, so the CRS was downloaded fresh and a new session was built. The result has now been written to IDB - the next visit on this device will be a hit."}
                </p>
              </div>
            }
          >
            <span
              className={cn(
                "text-[0.55rem] uppercase tracking-[0.14em] font-mono px-1.5 py-0.5 cursor-help",
                state.cacheHit
                  ? "bg-success/15 text-success"
                  : "bg-accent-dim text-accent"
              )}
            >
              {state.cacheHit ? "warm · IDB hit" : "cold · IDB miss"}
            </span>
          </Tooltip>
        )}
        <span className="text-fg-muted text-[0.6rem]">
          {(elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1 bg-fg-faint relative overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300",
              isReady
                ? "bg-success"
                : isError
                ? "bg-error"
                : "bg-accent"
            )}
            style={{ width: `${Math.min(100, fraction * 100)}%` }}
          />
        </div>
        <span className="text-[0.55rem] uppercase tracking-[0.14em] font-mono text-fg-muted shrink-0">
          {PHASE_LABEL[state.phase]}
        </span>
      </div>
      {isFetching && state.paramsExpectedBytes > 0 && (
        <div className="mt-1 text-[0.6rem] text-fg-muted font-mono">
          {formatBytes(state.paramsReceivedBytes)} / {formatBytes(state.paramsExpectedBytes)}
        </div>
      )}
      {isError && state.errorMessage && (
        <div className="mt-1 text-[0.7rem] text-error">{state.errorMessage}</div>
      )}
    </div>
  );
}

function PhaseIcon({ phase }: { phase: InstanceBootState["phase"] }) {
  if (phase === "ready") return <CheckCircle2 size={12} className="text-success shrink-0" />;
  if (phase === "error") return <AlertCircle size={12} className="text-error shrink-0" />;
  return <Loader2 size={12} className="text-accent shrink-0 animate-spin" />;
}
