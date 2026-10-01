import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileJson, Pause, Play, Radio, RotateCcw, SkipForward } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes, formatLatency } from "@/lib/format";
import {
  explain,
  isReadLeak,
  parseObserverLog,
  replayOffsets,
  shortCommitment,
  type ObserverEvent,
  type ObserverLog,
} from "@/lib/observer-log";
import { postObserverControl, useObserverStream } from "@/lib/use-observer-stream";

const DEFAULT_PROXY_URL = import.meta.env.VITE_OBSERVER_URL ?? "http://127.0.0.1:8790";
const SAMPLE_LOG_URL = "/samples/observer-synthetic-session.json";
const PROXY_URL_KEY = "raven-observer-proxy-url";
const SPEEDS = [1, 4, 16] as const;

type Mode = "live" | "replay";

function loadStoredUrl(): string {
  try {
    return localStorage.getItem(PROXY_URL_KEY) ?? DEFAULT_PROXY_URL;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

function storeUrl(url: string): void {
  try {
    localStorage.setItem(PROXY_URL_KEY, url);
  } catch {
    // Per-viewer convenience only.
  }
}

export function Observer(): ReactElement {
  const [mode, setMode] = useState<Mode>("live");
  const [proxyUrl, setProxyUrl] = useState(loadStoredUrl);
  const [connectedUrl, setConnectedUrl] = useState<string | undefined>(undefined);
  const live = useObserverStream(mode === "live" ? connectedUrl : undefined);
  const replay = useReplay();

  const log = mode === "live" ? live.log : replay.log;
  const events = useMemo(
    () => (mode === "live" ? (live.log?.events ?? []) : replay.visible),
    [mode, live.log, replay.visible],
  );
  const commitments = log?.meta.commitments ?? [];

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10">
        <div className="pt-14 sm:pt-20 pb-10 max-w-[80ch]">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Wire observer · Terminal Wallet to its POI servers
          </p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl lg:text-[4.2rem] leading-[1.02] tracking-tight font-normal">
            What the servers see.
          </h1>
          <p className="mt-5 text-fg-secondary text-[1.02rem] leading-relaxed">
            Every request the wallet sends to the Proof of Innocence aggregator and to Raven passes
            through a recording proxy that forwards it unchanged. Each one is checked for the
            wallet's own note commitments, in hex, decimal and raw bytes. A request that carries
            one is marked red.
          </p>
        </div>

        <SourceBar
          mode={mode}
          setMode={setMode}
          proxyUrl={proxyUrl}
          setProxyUrl={setProxyUrl}
          connectedUrl={connectedUrl}
          connect={(url) => {
            storeUrl(url);
            setConnectedUrl(url);
          }}
          disconnect={() => setConnectedUrl(undefined)}
          liveState={live.state}
          liveError={live.error}
          liveRun={live.log?.meta.run}
          replay={replay}
        />

        {log ? (
          <>
            <CommitmentsStrip
              commitments={commitments}
              origins={log.meta.commitmentOrigins ?? {}}
              learned={Boolean(log.meta.learn)}
              editable={mode === "live" && live.state === "open"}
              onApply={(list) =>
                connectedUrl
                  ? postObserverControl(connectedUrl, "commitments", { commitments: list })
                  : Promise.resolve()
              }
            />
            {log.meta.note ? (
              <p className="mt-3 text-[0.8rem] text-fg-muted leading-relaxed max-w-[110ch]">
                <span className="font-mono uppercase tracking-[0.14em] text-[0.62rem] mr-2">
                  {log.meta.source}
                </span>
                {log.meta.note}
              </p>
            ) : null}
          </>
        ) : null}

        <div className="mt-8">
          <SideBySide events={events} commitments={commitments} origins={log?.meta.commitmentOrigins ?? {}} />
        </div>

        <Explainer />
      </div>
    </section>
  );
}

function SourceBar(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  proxyUrl: string;
  setProxyUrl: (u: string) => void;
  connectedUrl: string | undefined;
  connect: (u: string) => void;
  disconnect: () => void;
  liveState: string;
  liveError: string | null;
  liveRun: string | undefined;
  replay: ReplayControls;
}): ReactElement {
  const { mode, setMode, replay } = props;
  const [controlError, setControlError] = useState<string | null>(null);

  const control = (path: "run" | "reset", body: unknown) => {
    if (!props.connectedUrl) return;
    setControlError(null);
    postObserverControl(props.connectedUrl, path, body).catch((err: unknown) =>
      setControlError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <div className="border border-fg-faint bg-bg-secondary">
      <div className="flex border-b border-fg-faint">
        {(["live", "replay"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "px-4 py-2.5 text-[0.7rem] font-mono uppercase tracking-[0.18em] border-b-2 -mb-px",
              mode === m ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {m === "live" ? "Live proxy" : "Replay a log"}
          </button>
        ))}
      </div>

      {mode === "live" ? (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={props.proxyUrl}
              onChange={(e) => props.setProxyUrl(e.target.value)}
              className="flex-1 min-w-[16rem] bg-bg-input border border-fg-faint px-3 py-2 text-[0.8rem] text-fg"
              aria-label="Proxy URL"
            />
            {props.connectedUrl ? (
              <Button onClick={props.disconnect}>Disconnect</Button>
            ) : (
              <Button primary onClick={() => props.connect(props.proxyUrl.trim())}>
                <Radio size={13} /> Connect
              </Button>
            )}
            <StatePill state={props.connectedUrl ? props.liveState : "idle"} />
          </div>
          {props.connectedUrl && props.liveState === "open" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[0.62rem] uppercase tracking-[0.18em] text-fg-muted font-mono mr-1">
                Label new requests as
              </span>
              <Button active={props.liveRun === "stock"} onClick={() => control("run", { run: "stock" })}>
                Stock POI node (Raven off)
              </Button>
              <Button active={props.liveRun === "raven"} onClick={() => control("run", { run: "raven" })}>
                Raven (Raven on)
              </Button>
              <span className="flex-1" />
              <Button onClick={() => control("reset", {})}>
                <RotateCcw size={12} /> Clear
              </Button>
            </div>
          ) : null}
          {props.liveError || controlError ? (
            <p className="text-[0.78rem] text-error font-mono">{controlError ?? props.liveError}</p>
          ) : null}
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 border border-fg-faint px-3 py-2 text-[0.72rem] font-mono uppercase tracking-[0.12em] text-fg-secondary hover:text-fg hover:border-fg cursor-pointer">
              <FileJson size={13} /> Open a saved log
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) replay.loadFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <Button onClick={() => replay.loadUrl(SAMPLE_LOG_URL)}>Load the synthetic session</Button>
            {replay.log ? (
              <>
                <span className="w-px h-6 bg-fg-faint mx-1" />
                <Button primary onClick={replay.playing ? replay.pause : replay.play}>
                  {replay.playing ? <Pause size={13} /> : <Play size={13} />}
                  {replay.playing ? "Pause" : replay.done ? "Replay" : "Play"}
                </Button>
                <Button onClick={replay.showAll}>
                  <SkipForward size={13} /> Show all
                </Button>
                {SPEEDS.map((s) => (
                  <Button key={s} active={replay.speed === s} onClick={() => replay.setSpeed(s)}>
                    {s}x
                  </Button>
                ))}
                <span className="font-mono text-[0.72rem] text-fg-muted">
                  {replay.visible.length} / {replay.log.events.length} requests
                </span>
              </>
            ) : null}
          </div>
          {replay.error ? <p className="text-[0.78rem] text-error font-mono">{replay.error}</p> : null}
        </div>
      )}
    </div>
  );
}

function originSummary(commitments: string[], origins: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const c of commitments) {
    const o = origins[c] ?? "list";
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts].map(([o, n]) => `${n} ${o}`).join(" · ");
}

function CommitmentsStrip(props: {
  commitments: string[];
  origins: Record<string, string>;
  learned: boolean;
  editable: boolean;
  onApply: (list: string[]) => Promise<void>;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 border border-fg-faint p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.62rem] uppercase tracking-[0.18em] text-fg-muted font-mono mr-1">
          Watching {props.commitments.length} note commitment{props.commitments.length === 1 ? "" : "s"}
        </span>
        {props.commitments.length > 0 ? (
          <span className="text-[0.62rem] uppercase tracking-[0.14em] text-fg-muted font-mono mr-1">
            ({originSummary(props.commitments, props.origins)}
            {props.learned ? "; learning from clear-text requests" : ""})
          </span>
        ) : (
          <span className="text-[0.62rem] uppercase tracking-[0.14em] text-warning font-mono mr-1">
            nothing is checked until the wallet's commitments are on this list
          </span>
        )}
        {props.commitments.map((c) => (
          <code
            key={c}
            title={`0x${c} (${props.origins[c] ?? "list"})`}
            className="font-mono text-[0.72rem] px-2 py-0.5 bg-public-dim text-fg"
          >
            {shortCommitment(c)}
          </code>
        ))}
        {props.editable ? (
          <button
            type="button"
            onClick={() => {
              setDraft(props.commitments.map((c) => `0x${c}`).join("\n"));
              setEditing((v) => !v);
            }}
            className="ml-auto text-[0.68rem] font-mono uppercase tracking-[0.14em] text-accent hover:text-fg"
          >
            {editing ? "Cancel" : "Edit list"}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="bg-bg-input border border-fg-faint p-2 text-[0.75rem] text-fg"
            placeholder="One commitment per line, 0x-prefixed or bare hex"
          />
          <div className="flex items-center gap-2">
            <Button
              primary
              onClick={() => {
                setError(null);
                props
                  .onApply(draft.split(/[\s,]+/).filter(Boolean))
                  .then(() => setEditing(false))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
              }}
            >
              Apply
            </Button>
            <span className="text-[0.72rem] text-fg-muted">Applies to requests recorded from now on.</span>
            {error ? <span className="text-[0.72rem] text-error font-mono">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideBySide({
  events,
  commitments,
  origins,
}: {
  events: ObserverEvent[];
  commitments: string[];
  origins: Record<string, string>;
}): ReactElement {
  const stock = events.filter((e) => e.run === "stock");
  const raven = events.filter((e) => e.run === "raven");
  const other = events.filter((e) => e.run !== "stock" && e.run !== "raven");
  const t0 = events.length > 0 ? events[0].tMs : 0;
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
        <RunPane
          tone="public"
          label="Stock POI node · Raven off"
          events={stock}
          t0={stock[0]?.tMs ?? t0}
          commitments={commitments}
          origins={origins}
        />
        <RunPane
          tone="private"
          label="Raven · Raven on"
          events={raven}
          t0={raven[0]?.tMs ?? t0}
          commitments={commitments}
          origins={origins}
        />
      </div>
      {other.length > 0 ? (
        <div className="mt-6 border border-fg-faint">
          <div className="px-4 py-2.5 border-b border-fg-faint text-[0.62rem] uppercase tracking-[0.2em] text-fg-secondary font-mono">
            Unlabeled requests ({other.length}): set the run label before starting a run
          </div>
          <EventList events={other} t0={other[0].tMs} commitments={commitments} />
        </div>
      ) : null}
    </>
  );
}

function RunPane(props: {
  tone: "public" | "private";
  label: string;
  events: ObserverEvent[];
  t0: number;
  commitments: string[];
  origins: Record<string, string>;
}): ReactElement {
  const { events } = props;
  const watched = props.commitments.length;
  const toAgg = events.filter((e) => e.upstream === "aggregator");
  const toRaven = events.filter((e) => e.upstream === "raven");
  const readLeaks = events.filter(isReadLeak);
  const writes = events.filter((e) => explain(e).kind === "write");
  const namedNotes = new Set(readLeaks.flatMap((e) => e.requestMatches.map((m) => m.commitment)));
  const namedLabel =
    namedNotes.size === 0 ? "notes" : namedNotes.size === 1 ? "one of your notes" : `${namedNotes.size} of your notes`;
  // A request searched for fewer commitments than are watched now (an older log, or a body
  // evicted before the list grew) is not evidence about the notes added since.
  const shortChecked = events.filter(
    (e) => e.rescanDropped || (e.watchedAtScan !== undefined && e.watchedAtScan < watched),
  ).length;
  const verdict: "leak" | "clean" | "unchecked" =
    readLeaks.length > 0 ? "leak" : watched === 0 ? "unchecked" : "clean";
  const up = events.reduce((s, e) => s + e.requestBytes, 0);
  const down = events.reduce((s, e) => s + e.responseBytes, 0);
  const dot = props.tone === "public" ? "bg-public" : "bg-private";

  return (
    <div className="bg-bg flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fg-faint">
        <span className={`inline-block w-1.5 h-1.5 ${dot}`} />
        <span className="text-[0.62rem] uppercase tracking-[0.2em] text-fg-secondary font-mono font-medium">
          {props.label}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="p-6 text-[0.85rem] text-fg-muted">No requests recorded for this run yet.</p>
      ) : (
        <>
          <div
            className={cn(
              "px-4 py-4 border-b border-fg-faint",
              verdict === "leak" ? "bg-public-dim" : verdict === "clean" ? "bg-private-dim" : "bg-bg-secondary",
            )}
          >
            <p className="font-serif text-[1.6rem] leading-tight">
              {verdict === "leak"
                ? `${readLeaks.length} read${readLeaks.length === 1 ? "" : "s"} named ${namedLabel}`
                : verdict === "clean"
                  ? "No read named a note"
                  : "Nothing to check: watching 0 commitments"}
            </p>
            <p className="mt-1 text-[0.8rem] text-fg-secondary">
              {verdict === "leak"
                ? "The aggregator receives these commitments in the clear, tied to the wallet's IP and timing."
                : verdict === "clean"
                  ? `Of ${events.length} request${events.length === 1 ? "" : "s"}, none carries any of the ${watched} watched commitment${watched === 1 ? "" : "s"} (${originSummary(props.commitments, props.origins)}) in any encoding checked. Only notes on the list can be detected: the notes this run spends must be on it.`
                  : "No commitment is on the watch list, so no request was searched. Load the wallet's commitments first."}
              {writes.length > 0
                ? ` ${writes.length} proof submission${writes.length === 1 ? "" : "s"} went to the aggregator, as in both runs.`
                : ""}
            </p>
            {verdict !== "unchecked" && shortChecked > 0 ? (
              <p className="mt-1 text-[0.72rem] font-mono text-warning">
                {shortChecked} request{shortChecked === 1 ? " was" : "s were"} checked against a shorter list than the one shown.
              </p>
            ) : null}
          </div>
          <dl className="grid grid-cols-4 gap-px bg-fg-faint border-b border-fg-faint">
            <Stat label="to aggregator" value={String(toAgg.length)} />
            <Stat label="to Raven" value={String(toRaven.length)} />
            <Stat label="sent" value={formatBytes(up)} />
            <Stat label="received" value={formatBytes(down)} />
          </dl>
          <EventList events={events} t0={props.t0} commitments={props.commitments} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="bg-bg px-3 py-2.5">
      <dt className="text-[0.58rem] uppercase tracking-[0.18em] text-fg-muted font-mono">{label}</dt>
      <dd className="font-mono-num text-[0.95rem] text-fg">{value}</dd>
    </div>
  );
}

function EventList(props: { events: ObserverEvent[]; t0: number; commitments: string[] }): ReactElement {
  const listRef = useRef<HTMLOListElement>(null);
  const count = props.events.length;
  // Scroll the list, not the window, so two growing panes never fight over the page.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <ol ref={listRef} className="max-h-[68vh] overflow-y-auto divide-y divide-fg-faint">
      {props.events.map((e) => (
        <EventRow key={e.id} event={e} t0={props.t0} />
      ))}
    </ol>
  );
}

function EventRow({ event: e, t0 }: { event: ObserverEvent; t0: number }): ReactElement {
  const [open, setOpen] = useState(false);
  const info = explain(e);
  const leak = isReadLeak(e);
  const dest =
    e.upstream === "aggregator"
      ? "text-public border-public/50"
      : "text-private border-private/50";

  return (
    <li className={cn("text-[0.8rem]", leak && "bg-public-dim border-l-2 border-public")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2.5 flex flex-col gap-1 hover:bg-bg-hover"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          <span className="font-mono-num text-[0.68rem] text-fg-muted w-14 shrink-0">
            +{((e.tMs - t0) / 1000).toFixed(2)}s
          </span>
          <span className={cn("font-mono text-[0.58rem] uppercase tracking-[0.14em] border px-1.5 py-0.5 shrink-0", dest)}>
            {e.upstream === "aggregator" ? "aggregator" : "raven"}
          </span>
          <span className="font-mono text-[0.72rem] text-fg min-w-0 break-all">
            {e.method} {e.rpcMethod ?? e.routeTemplate}
          </span>
          <span className="ml-auto font-mono-num text-[0.66rem] text-fg-muted shrink-0">
            {formatBytes(e.requestBytes)} up · {formatBytes(e.responseBytes)} down
          </span>
        </div>
        <div className="pl-[4.9rem] flex flex-wrap items-baseline gap-x-2">
          <span className="text-fg-secondary">{info.title}.</span>
          <span className="text-fg-muted">{info.learns}</span>
        </div>
        {leak && e.requestMatches.length === 0 ? (
          <div className="pl-[4.9rem] font-mono text-[0.62rem] uppercase tracking-[0.14em] text-public">
            names notes that are not on the watch list
          </div>
        ) : null}
        {e.requestMatches.length > 0 ? (
          <div className="pl-[4.9rem] flex flex-wrap gap-1.5">
            <span className={cn("font-mono text-[0.62rem] uppercase tracking-[0.14em]", leak ? "text-public" : "text-warning")}>
              {leak ? "names your notes:" : "carries (proof write):"}
            </span>
            {e.requestMatches.map((m) => (
              <code key={m.commitment} className={cn("font-mono text-[0.66rem] px-1.5", leak ? "bg-public/20 text-fg" : "bg-warning/15 text-fg")}>
                {shortCommitment(m.commitment)} ({m.encodings.join(", ")})
              </code>
            ))}
          </div>
        ) : null}
      </button>
      {open ? <EventDetail event={e} /> : null}
    </li>
  );
}

function EventDetail({ event: e }: { event: ObserverEvent }): ReactElement {
  const matched = e.requestMatches.map((m) => m.commitment);
  return (
    <div className="px-4 pb-4 pl-[5.9rem] flex flex-col gap-3">
      <KeyVals
        rows={[
          ["destination", `${e.destination}${e.rpcMethod ? e.route : e.routeTemplate}`],
          ["status", e.error ? `error: ${e.error}` : String(e.status ?? "")],
          ["time", `${e.t}${e.durationMs !== undefined ? ` · ${formatLatency(e.durationMs)}` : ""}`],
          ...Object.entries(e.requestHeaders ?? {}).map(([k, v]) => [`req ${k}`, v] as [string, string]),
          ...Object.entries(e.responseHeaders ?? {}).map(([k, v]) => [`res ${k}`, v] as [string, string]),
        ]}
      />
      <Preview label={`Request body · ${formatBytes(e.requestBytes)}`} preview={e.requestPreview} marks={matched} />
      <Preview label={`Response body · ${formatBytes(e.responseBytes)}`} preview={e.responsePreview} marks={[]} />
    </div>
  );
}

function KeyVals({ rows }: { rows: [string, string][] }): ReactElement {
  return (
    <dl className="font-mono text-[0.68rem] space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-fg-muted shrink-0 w-36">{k}</dt>
          <dd className="text-fg-secondary break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Preview(props: {
  label: string;
  preview: ObserverEvent["requestPreview"];
  marks: string[];
}): ReactElement | null {
  const p = props.preview;
  if (!p || p.kind === "empty") return null;
  return (
    <div className="border border-fg-faint bg-bg-input">
      <div className="px-3 py-1.5 border-b border-fg-faint text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono">
        {props.label}
        {p.kind === "binary" ? ` · binary, first ${p.text.length / 2} bytes as hex` : ""}
        {p.truncated ? " · truncated" : ""}
      </div>
      <pre className="px-3 py-2 font-mono text-[0.66rem] text-fg-secondary whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-auto">
        {highlight(p.text, props.marks)}
      </pre>
    </div>
  );
}

function highlight(text: string, commitments: string[]): ReactNode {
  const needles = commitments.map((c) => c.replace(/^0+/, "")).filter((c) => c.length >= 32);
  if (needles.length === 0) return text;
  const pattern = new RegExp(`(${needles.join("|")})`, "gi");
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-public/35 text-fg px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function Explainer(): ReactElement {
  return (
    <div className="mt-16 mb-8">
      <div className="pb-4 border-b border-fg-faint">
        <span className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
          What reaches each server
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-fg-faint border-x border-b border-fg-faint">
        <ExplainCard tone="public" title="Stock: the aggregator">
          <li>
            The blinded commitment of each note the wallet has not yet seen as Valid on every list: every note it
            holds on a fresh sync, then each new note until it turns Valid.
          </li>
          <li>The blinded commitments each transfer sends, until they turn Valid.</li>
          <li>
            Which notes the wallet spent, before the POI proof exists (through a broadcaster: which notes it is about
            to spend).
          </li>
          <li>All of it tied to the wallet's IP address and timing, so notes link to each other and to a person.</li>
        </ExplainCard>
        <ExplainCard tone="private" title="With Raven: the Raven node">
          <li>
            That a wallet downloaded the list index, and from which position: after the first sync the download
            resumes from the wallet's last sync point. A note's status is decided on the device.
          </li>
          <li>
            For each path the wallet needs, an encrypted PIR query. The server answers it without learning which row,
            and so which note, it returned.
          </li>
          <li>Never a commitment. Sizes, timing and IP reach it as they reach any server.</li>
        </ExplainCard>
        <ExplainCard tone="private" title="With Raven: the aggregator">
          <li>The proof submission, exactly as today. Raven removes the reads, not the write.</li>
          <li>Transaction-tree checks, which name a tree position and a root, not a note.</li>
          <li>A request for the roots each fetched path is checked against. Names no note.</li>
        </ExplainCard>
        <ExplainCard tone="private" title="What the check covers">
          <li>Each request body and URL is searched for every watched commitment as hex (with or without 0x, any case), decimal, and raw 32-byte big- and little-endian bytes.</li>
          <li>Requests are also searched for a 6-byte prefix of each commitment, the width of the list index.</li>
          <li>Only commitments on the watch list can be found. When the list grows, every request already recorded is searched again.</li>
          <li>The proxy forwards bytes unchanged, so what it records is what the server received.</li>
        </ExplainCard>
      </div>
    </div>
  );
}

function ExplainCard(props: { tone: "public" | "private"; title: string; children: ReactNode }): ReactElement {
  return (
    <div className="bg-bg p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-block w-1.5 h-1.5 ${props.tone === "public" ? "bg-public" : "bg-private"}`} />
        <h3 className="font-serif text-[1.35rem] leading-tight font-normal">{props.title}</h3>
      </div>
      <ul className="list-disc pl-5 space-y-1.5 text-[0.86rem] text-fg-secondary leading-relaxed">{props.children}</ul>
    </div>
  );
}

function Button(props: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-2 text-[0.7rem] font-mono uppercase tracking-[0.12em] border transition-colors",
        props.primary
          ? "bg-fg text-bg border-fg hover:bg-transparent hover:text-fg"
          : props.active
            ? "border-accent text-accent"
            : "border-fg-faint text-fg-secondary hover:border-fg hover:text-fg",
      )}
    >
      {props.children}
    </button>
  );
}

function StatePill({ state }: { state: string }): ReactElement {
  const color =
    state === "open" ? "bg-success" : state === "error" ? "bg-error" : state === "connecting" ? "bg-warning" : "bg-fg-faint";
  const label = state === "open" ? "streaming" : state === "idle" ? "not connected" : state;
  return (
    <span className="inline-flex items-center gap-2 px-3 py-2 border border-fg-faint font-mono text-[0.66rem] uppercase tracking-[0.12em] text-fg-secondary">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

interface ReplayControls {
  log: ObserverLog | null;
  visible: ObserverEvent[];
  playing: boolean;
  done: boolean;
  speed: number;
  error: string | null;
  loadFile: (file: File) => void;
  loadUrl: (url: string) => void;
  play: () => void;
  pause: () => void;
  showAll: () => void;
  setSpeed: (s: number) => void;
}

function useReplay(): ReplayControls {
  const [log, setLog] = useState<ObserverLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const offsets = useMemo(() => (log ? replayOffsets(log.events) : []), [log]);
  const end = offsets.length > 0 ? offsets[offsets.length - 1] : 0;

  useEffect(() => {
    if (!playing) return;
    const tick = 50;
    const id = setInterval(() => {
      setClock((c) => {
        const next = c + tick * speed;
        if (next >= end) setPlaying(false);
        return Math.min(next, end);
      });
    }, tick);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  const visible = useMemo(() => {
    if (!log) return [];
    const n = offsets.filter((o) => o <= clock).length;
    return log.events.slice(0, n);
  }, [log, offsets, clock]);

  const accept = (text: string) => {
    try {
      const parsed = parseObserverLog(JSON.parse(text));
      setLog(parsed);
      setError(null);
      setClock(-1);
      setPlaying(true);
    } catch (err) {
      setError(`cannot load log: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    log,
    visible,
    playing,
    done: log !== null && clock >= end,
    speed,
    error,
    loadFile: (file) => {
      file.text().then(accept, (err: unknown) => setError(String(err)));
    },
    loadUrl: (url) => {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(accept)
        .catch((err: unknown) => setError(`cannot load ${url}: ${err instanceof Error ? err.message : String(err)}`));
    },
    play: () => {
      if (clock >= end) setClock(-1);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    showAll: () => {
      setPlaying(false);
      setClock(end);
    },
    setSpeed,
  };
}
