import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { StagePhase } from "@/components/PerStageCard";

export interface TimelineNode {
  id: string;
  label: string;
  hint?: string;
  phase: StagePhase;
}

export function StageTimeline({
  nodes,
  activeIndex,
  onSelect,
}: {
  nodes: TimelineNode[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [scrubIndex, setScrubIndex] = useState(activeIndex);
  useEffect(() => {
    setScrubIndex((cur) => (activeIndex > cur ? activeIndex : cur));
  }, [activeIndex]);

  useEffect(() => {
    const item = itemRefs.current[scrubIndex];
    if (!item) return;
    item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [scrubIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setScrubIndex((cur) => {
          const next = Math.min(nodes.length - 1, cur + 1);
          if (next !== cur) onSelect(next);
          return next;
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setScrubIndex((cur) => {
          const next = Math.max(0, cur - 1);
          if (next !== cur) onSelect(next);
          return next;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes.length, onSelect]);

  return (
    <div className="relative">
      <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-3 flex items-center justify-between">
        <span>stages</span>
        <span className="hidden sm:inline">use keyboard {`<-`} {`->`} to scrub</span>
      </div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto no-scrollbar"
        style={{ scrollSnapType: "x mandatory" }}
      >
        <div className="relative inline-flex items-stretch min-w-full pt-2 pb-3 px-1">
          <div className="absolute top-[1.5rem] left-6 right-6 h-px bg-fg-faint pointer-events-none" />
          {nodes.map((n, i) => {
            const phase = i < activeIndex ? "done" : i === activeIndex ? n.phase : "idle";
            const isFocused = i === scrubIndex;
            return (
              <button
                key={n.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => {
                  setScrubIndex(i);
                  onSelect(i);
                }}
                className={cn(
                  "relative shrink-0 flex flex-col items-center gap-1.5 px-4 py-1 group focus:outline-none",
                  "snap-center"
                )}
                style={{ scrollSnapAlign: "center" }}
                aria-current={isFocused ? "step" : undefined}
                aria-label={`Stage ${i + 1}: ${n.label}`}
              >
                <Dot phase={phase} active={isFocused} />
                <span
                  className={cn(
                    "text-[0.65rem] uppercase tracking-[0.08em] font-mono whitespace-nowrap",
                    isFocused ? "text-fg" : "text-fg-muted"
                  )}
                >
                  {i + 1}. {n.label}
                </span>
                {n.hint && (
                  <span
                    className={cn(
                      "text-[0.55rem] tracking-wider whitespace-nowrap",
                      isFocused ? "text-accent" : "text-fg-muted"
                    )}
                  >
                    {n.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Dot({ phase, active }: { phase: StagePhase; active: boolean }) {
  if (active) {
    return (
      <span className="relative w-3 h-3">
        <motion.span
          aria-hidden
          initial={{ scale: 0.5, opacity: 0.6 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
          className="absolute inset-0 rounded-full bg-accent"
        />
        <span className="relative block w-3 h-3 rounded-full bg-accent border border-accent" />
      </span>
    );
  }
  if (phase === "done") {
    return <span className="block w-3 h-3 rounded-full bg-fg border border-fg" />;
  }
  if (phase === "error") {
    return <span className="block w-3 h-3 rounded-full bg-error border border-error" />;
  }
  return <span className="block w-3 h-3 rounded-full bg-bg border border-fg-faint" />;
}
