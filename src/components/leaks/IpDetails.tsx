import type { ReactElement } from "react";

interface DetailRow {
  label: string;
  value: string;
}

interface IpDetailsProps {
  heading: string;
  rows: DetailRow[];
  note?: string;
}

export function IpDetails({ heading, rows, note }: IpDetailsProps): ReactElement {
  return (
    <div className="font-mono">
      <div className="text-fg-muted text-[0.6rem] uppercase tracking-[0.12em] mb-1.5">{heading}</div>
      <dl className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="text-fg-muted w-[5rem] shrink-0">{row.label}</dt>
            <dd className="text-fg break-all min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-1.5 text-fg-secondary leading-snug">{note}</p> : null}
    </div>
  );
}
