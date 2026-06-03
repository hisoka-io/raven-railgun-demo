import type { ReactElement } from "react";

interface NoxRouteVisualizerProps {
  entry?: string;
  mix?: string;
  exit?: string;
  className?: string;
}

const ENTRY_COLOR = "#B89A7E";
const MIX_COLOR = "#7B8B9A";
const EXIT_COLOR = "#6B9B7B";

interface Hop {
  x: number;
  color: string;
  label: string;
  id?: string;
}

export function NoxRouteVisualizer({ entry, mix, exit, className }: NoxRouteVisualizerProps): ReactElement {
  const y = 54;
  const hops: Hop[] = [
    { x: 96, color: ENTRY_COLOR, label: "ENTRY", id: entry },
    { x: 180, color: MIX_COLOR, label: "MIX", id: mix },
    { x: 264, color: EXIT_COLOR, label: "EXIT", id: exit },
  ];
  const stops = [40, ...hops.map((h) => h.x), 320];

  return (
    <svg
      viewBox="0 0 360 104"
      className={`w-full text-fg-faint ${className ?? ""}`}
      role="img"
      aria-label="NOX Sphinx route: entry, mix, exit"
    >
      <g stroke="currentColor" strokeWidth={1}>
        {stops.slice(0, -1).map((x, i) => (
          <line key={x} x1={x} y1={y} x2={stops[i + 1]} y2={y} />
        ))}
      </g>
      <path d={`M 40 ${y + 14} C 130 ${y + 40}, 230 ${y + 40}, 320 ${y + 14}`} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 4" />

      <text x={40} y={y + 4} textAnchor="middle" className="fill-fg-muted" fontSize="8" fontFamily="var(--font-mono)">you</text>
      <text x={320} y={y + 4} textAnchor="middle" className="fill-fg-muted" fontSize="8" fontFamily="var(--font-mono)">target</text>

      <rect x={64} y={y - 4} width={8} height={8} transform={`rotate(45 68 ${y})`} fill={ENTRY_COLOR} fillOpacity={0.9} />

      {hops.map((h) => (
        <g key={h.label}>
          <circle cx={h.x} cy={y} r={12} fill={h.color} fillOpacity={0.12} stroke={h.color} strokeOpacity={0.65} strokeWidth={1.4} />
          <circle cx={h.x} cy={y} r={3.2} fill={h.color} fillOpacity={0.95} />
          {h.id ? (
            <text x={h.x} y={y - 20} textAnchor="middle" className="fill-fg-muted" fontSize="7.5" fontFamily="var(--font-mono)">
              {h.id.length > 8 ? `${h.id.slice(0, 8)}` : h.id}
            </text>
          ) : null}
          <text x={h.x} y={y + 28} textAnchor="middle" fill={h.color} fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
            {h.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
