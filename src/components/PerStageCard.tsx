import { type ReactNode, useState } from "react";
import { ChevronDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export type StagePhase = "idle" | "running" | "done" | "error";

export interface SubCard {
  label: string;
  body: ReactNode;
  defaultOpen?: boolean;
}

export function PerStageCard({
  index,
  title,
  oneLiner,
  phase,
  client,
  server,
  extract,
  liveAction,
  id,
}: {
  index: number;
  title: string;
  oneLiner: string;
  phase: StagePhase;
  client?: SubCard;
  server?: SubCard;
  extract?: SubCard;
  liveAction?: ReactNode;
  id?: string;
}) {
  return (
    <article id={id} className="border border-fg-faint bg-bg-secondary scroll-mt-32">
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-fg-faint">
        <div>
          <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono">
            stage {index}
          </div>
          <h3 className="font-serif text-xl mt-0.5">{title}</h3>
          <p className="text-[0.78rem] text-fg-secondary mt-1 leading-snug">{oneLiner}</p>
        </div>
        <PhaseBadge phase={phase} />
      </header>

      <div className="divide-y divide-fg-faint">
        {client && <SubCardCollapsible title={client.label} defaultOpen={client.defaultOpen}>{client.body}</SubCardCollapsible>}
        {server && <SubCardCollapsible title={server.label} defaultOpen={server.defaultOpen}>{server.body}</SubCardCollapsible>}
        {extract && <SubCardCollapsible title={extract.label} defaultOpen={extract.defaultOpen}>{extract.body}</SubCardCollapsible>}
      </div>

      {liveAction && <div className="px-4 py-3 border-t border-fg-faint">{liveAction}</div>}
    </article>
  );
}

function PhaseBadge({ phase }: { phase: StagePhase }) {
  const map = {
    idle: { color: "text-fg-muted bg-fg-faint/30", label: "idle", icon: null },
    running: { color: "text-accent bg-accent/15", label: "running", icon: <Loader2 size={11} className="animate-spin" /> },
    done: { color: "text-success bg-success/15", label: "done", icon: <CheckCircle2 size={11} /> },
    error: { color: "text-error bg-error/15", label: "error", icon: <AlertCircle size={11} /> },
  } as const;
  const m = map[phase];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5",
        "text-[0.55rem] uppercase tracking-[0.14em] font-mono",
        m.color
      )}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function SubCardCollapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-bg-hover transition-colors"
      >
        <span className="text-[0.78rem] text-fg-secondary">{title}</span>
        <ChevronDown
          size={13}
          className={cn(
            "text-fg-muted transition-transform shrink-0",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          <div className="px-4 pb-3 text-[0.78rem] text-fg-secondary leading-relaxed">
            {children}
          </div>
        </motion.div>
      )}
    </div>
  );
}
