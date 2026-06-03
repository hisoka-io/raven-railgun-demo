import type { ReactElement, ReactNode } from "react";

interface BeforeAfterPaneProps {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
}

export function BeforeAfterPane({
  before,
  after,
  beforeLabel = "Before (today)",
  afterLabel = "After (through NOX)",
}: BeforeAfterPaneProps): ReactElement {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
      <Pane label={beforeLabel} tone="public">
        {before}
      </Pane>
      <Pane label={afterLabel} tone="private">
        {after}
      </Pane>
    </div>
  );
}

function Pane({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "public" | "private";
  children: ReactNode;
}): ReactElement {
  const dot = tone === "public" ? "bg-public" : "bg-private";
  return (
    <div className="bg-bg flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fg-faint">
        <span className={`inline-block w-1.5 h-1.5 ${dot}`} />
        <span className="text-[0.62rem] uppercase tracking-[0.2em] text-fg-secondary font-mono font-medium">
          {label}
        </span>
      </div>
      <div className="p-4 flex flex-col gap-4 min-w-0">{children}</div>
    </div>
  );
}
