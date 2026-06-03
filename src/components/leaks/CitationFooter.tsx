import type { ReactElement } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Citation } from "@/lib/leak-data";

interface CitationFooterProps {
  citations: Citation[];
  verifiedAt: string;
  title?: string;
}

export function CitationFooter({
  citations,
  verifiedAt,
  title = "Sources",
}: CitationFooterProps): ReactElement {
  return (
    <div className="border border-fg-faint bg-bg-secondary">
      <div className="px-4 py-2.5 border-b border-fg-faint flex items-baseline justify-between gap-3">
        <span className="text-[0.62rem] uppercase tracking-[0.2em] text-fg-secondary font-mono font-medium">
          {title}
        </span>
        <span className="text-[0.6rem] text-fg-muted font-mono">
          upstream verified at HEAD on {verifiedAt}
        </span>
      </div>
      <ul className="divide-y divide-fg-faint">
        {citations.map((c) => (
          <li key={c.upstreamUrl} className="px-4 py-3">
            <a
              href={c.upstreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-start gap-1.5 text-[0.8rem] text-fg-secondary hover:text-fg transition-colors"
            >
              <span className="leading-snug">{c.label}</span>
              <ArrowUpRight size={12} className="mt-0.5 shrink-0 text-fg-muted group-hover:text-accent" />
            </a>
            {c.verbatim ? (
              <pre className="mt-2 px-3 py-2 bg-bg-input border border-fg-faint font-mono text-[0.68rem] text-fg-secondary whitespace-pre-wrap leading-relaxed">
                {c.verbatim}
              </pre>
            ) : null}
            <div className="mt-1.5 text-[0.6rem] font-mono text-fg-muted uppercase tracking-[0.12em]">
              audit: {c.auditRef}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
