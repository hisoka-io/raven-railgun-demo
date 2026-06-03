import type { ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { formatBytes, formatLatency } from "@/lib/format";

export type WireResult =
  | { kind: "idle" }
  | { kind: "loading"; note?: string }
  | { kind: "skipped"; note: string }
  | { kind: "error"; message: string }
  | { kind: "done"; status: number; latencyMs: number; bytes: number; bodyText?: string };

interface WireFormatBlockProps {
  method: string;
  url: string;
  headers: ReadonlyArray<readonly [string, string]>;
  body?: string;
  result: WireResult;
}

function statusTone(status: number): string {
  if (status >= 200 && status < 300) return "text-success bg-success/15";
  if (status >= 400) return "text-error bg-error/15";
  return "text-warning bg-warning/15";
}

export function WireFormatBlock({ method, url, headers, body, result }: WireFormatBlockProps): ReactElement {
  return (
    <div className="border border-fg-faint bg-bg-input">
      <div className="px-3 py-2 border-b border-fg-faint flex items-center gap-2 font-mono text-[0.7rem]">
        <span className="px-1.5 py-0.5 bg-accent-dim text-accent uppercase tracking-[0.1em] font-medium">
          {method}
        </span>
        <span className="text-fg-secondary break-all min-w-0">{url}</span>
      </div>

      {headers.length > 0 ? (
        <dl className="px-3 py-2 border-b border-fg-faint font-mono text-[0.68rem] text-fg-muted space-y-0.5">
          {headers.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-fg-muted">{k}:</dt>
              <dd className="text-fg-secondary break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {body ? (
        <pre className="px-3 py-2 border-b border-fg-faint font-mono text-[0.68rem] text-fg-secondary whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto no-scrollbar">
          {body}
        </pre>
      ) : null}

      <div className="px-3 py-2.5">
        <Result result={result} />
      </div>
    </div>
  );
}

function Result({ result }: { result: WireResult }): ReactElement {
  if (result.kind === "idle") {
    return <span className="font-mono text-[0.7rem] text-fg-muted">not run</span>;
  }
  if (result.kind === "skipped") {
    return <span className="font-mono text-[0.7rem] text-fg-muted">{result.note}</span>;
  }
  if (result.kind === "loading") {
    return (
      <span className="inline-flex items-center gap-2 font-mono text-[0.7rem] text-accent">
        <Loader2 size={12} className="animate-spin" />
        {result.note ?? "in flight"}
      </span>
    );
  }
  if (result.kind === "error") {
    return (
      <div className="font-mono text-[0.7rem] text-error break-all leading-relaxed">{result.message}</div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[0.65rem]">
        <span className={`px-1.5 py-0.5 uppercase tracking-[0.1em] ${statusTone(result.status)}`}>
          {result.status}
        </span>
        <span className="text-accent">{formatLatency(result.latencyMs)}</span>
        <span className="text-fg-muted">{formatBytes(result.bytes)}</span>
      </div>
      {result.bodyText ? (
        <details>
          <summary className="cursor-pointer text-[0.65rem] font-mono text-fg-muted hover:text-fg uppercase tracking-[0.12em]">
            response body
          </summary>
          <pre className="mt-2 font-mono text-[0.66rem] text-fg-secondary whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto no-scrollbar">
            {result.bodyText}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
