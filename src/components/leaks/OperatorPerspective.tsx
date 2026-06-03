import type { ReactElement } from "react";

export interface LearnedField {
  label: string;
  value: string;
  emphasis?: boolean;
}

interface OperatorPerspectiveProps {
  operator: string;
  learns: LearnedField[];
  note?: string;
  tone?: "leak" | "shielded";
}

export function OperatorPerspective({
  operator,
  learns,
  note,
  tone = "leak",
}: OperatorPerspectiveProps): ReactElement {
  const accent = tone === "leak" ? "border-public/40 bg-public-dim" : "border-private/40 bg-private-dim";
  const heading = tone === "leak" ? "text-public" : "text-private";
  return (
    <div className={`border ${accent} px-4 py-3`}>
      <div className={`text-[0.6rem] uppercase tracking-[0.18em] font-mono font-medium ${heading}`}>
        {operator} access log entry
      </div>
      <dl className="mt-2 font-mono text-[0.72rem] leading-relaxed">
        {learns.map((field) => (
          <div key={field.label} className="flex gap-2">
            <dt className="text-fg-muted shrink-0 w-[5.5rem]">{field.label}</dt>
            <dd className={`min-w-0 break-all ${field.emphasis ? "text-fg" : "text-fg-secondary"}`}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-2.5 text-[0.72rem] text-fg-muted leading-relaxed">{note}</p> : null}
    </div>
  );
}
