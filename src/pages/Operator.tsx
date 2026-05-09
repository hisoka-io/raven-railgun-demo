import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useEventsStream } from "@/lib/use-events-stream";
import { CONFIG } from "@/lib/config";
import { formatBytes, formatNumber, formatUptime } from "@/lib/format";

interface MetricsBundle {
  perInstance: Record<
    string,
    {
      lastApplied?: number;
      chainHead?: number;
      lag?: number;
    }
  >;
  uptimeSeconds?: number;
  rssBytes?: number;
  totalQueries?: number;
}

const HISTORY_LIMIT = 60;

export function Operator() {
  const { status, state, lastEventAt, errorMessage } = useEventsStream();
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [rssHistory, setRssHistory] = useState<{ ts: number; rssBytes: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const now = Date.now();
        const res = await fetch(`${CONFIG.ravenUrl}/metrics`, {
          headers: { Authorization: `Bearer ${CONFIG.ravenBearer}` },
        });
        if (!res.ok) return;
        const text = await res.text();
        const parsed = parseMetrics(text);
        if (cancelled) return;
        setMetrics(parsed);
        if (parsed.rssBytes !== undefined) {
          setRssHistory((prev) =>
            [...prev.slice(-(HISTORY_LIMIT - 1)), { ts: now, rssBytes: parsed.rssBytes! }]
          );
        }
      } catch {
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16">
        <div className="max-w-3xl mb-8">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-2">
            live operator state · push-driven
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl mb-3">raven.hisoka.io</h1>
          <p className="text-fg-secondary text-[0.95rem] leading-relaxed">
            Push-driven status from{" "}
            <code className="font-mono text-[0.85rem]">/v1/events</code> (one HTTP/2 stream
            per browser tab; the SSE handler is auth-bypassed alongside health probes). Plus
            per-instance metrics polled every 30 seconds from{" "}
            <code className="font-mono text-[0.85rem]">/metrics</code>.
          </p>
        </div>

        <div className="text-[0.65rem] uppercase tracking-[0.14em] text-fg-muted font-mono mb-3 flex flex-wrap gap-x-3 gap-y-1">
          <span>stream {state}</span>
          {lastEventAt && <Ago ts={lastEventAt} />}
          {metrics?.uptimeSeconds !== undefined && (
            <span>uptime {formatUptime(metrics.uptimeSeconds)}</span>
          )}
          {metrics?.rssBytes !== undefined && (
            <span>rss {formatBytes(metrics.rssBytes)}</span>
          )}
        </div>

        {(state === "error" || state === "closed") && !status && (
          <div className="border border-warning/40 bg-warning/5 p-4 text-[0.85rem] text-fg-secondary mb-6">
            <strong className="text-warning">stream {state}</strong>
            {errorMessage ? <> · {errorMessage}</> : null}
            <span className="text-fg-muted ml-2">retrying automatically</span>
          </div>
        )}

        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-fg-faint mb-6">
            <Tile
              label="instances"
              value={String(status.instances.length)}
              detail={`${status.instances.filter((i) => i.role === "live").length} live · ${status.instances.filter((i) => i.role === "static").length} static`}
            />
            <Tile
              label="consumer"
              value={
                status.consumer
                  ? status.consumer.consumer_errors > 0
                    ? "degraded"
                    : status.instances.some((i) => i.drain_state !== "active")
                    ? "draining"
                    : "healthy"
                  : "n/a"
              }
              detail={
                status.consumer
                  ? `errors ${status.consumer.consumer_errors} · reorgs ${status.consumer.reorgs_handled}`
                  : "no consumer"
              }
              accent={
                !status.consumer ||
                status.consumer.consumer_errors > 0 ||
                status.instances.some((i) => i.drain_state !== "active")
                  ? "warning"
                  : "success"
              }
            />
            <Tile
              label="commits fired"
              value={
                status.consumer ? formatNumber(status.consumer.commits_fired) : "n/a"
              }
              detail={
                status.consumer
                  ? `events ${formatNumber(status.consumer.events_processed)} · last block ${formatNumber(status.consumer.last_applied_block)}`
                  : ""
              }
            />
          </div>
        )}

        {status && (
          <div className="border border-fg-faint mb-6">
            <div className="grid grid-cols-12 px-4 py-3 border-b border-fg-faint text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono">
              <span className="col-span-3">instance</span>
              <span className="col-span-1">role</span>
              <span className="col-span-1">epoch</span>
              <span className="col-span-1 text-right">in-flight</span>
              <span className="col-span-1 text-right hidden sm:inline">k</span>
              <span className="col-span-1 text-right">drain</span>
              <span className="col-span-2 text-right">last applied</span>
              <span className="col-span-2 text-right">lag</span>
            </div>
            {status.instances.map((inst) => {
              const m = metrics?.perInstance[inst.id];
              return (
                <motion.div
                  key={inst.id}
                  layout
                  className="grid grid-cols-12 px-4 py-2 border-b border-fg-faint last:border-b-0 text-mono-xs items-center"
                >
                  <span className="col-span-3 text-fg break-all">{inst.id}</span>
                  <span className="col-span-1 text-fg-secondary">{inst.role}</span>
                  <motion.span
                    key={`${inst.id}-${inst.epoch}`}
                    initial={{ color: "var(--color-accent)" }}
                    animate={{ color: "var(--color-fg-secondary)" }}
                    transition={{ duration: 0.6 }}
                    className="col-span-1"
                  >
                    {inst.epoch}
                  </motion.span>
                  <span className="col-span-1 text-right text-fg-secondary">
                    {inst.in_flight}
                  </span>
                  <span className="col-span-1 text-right text-fg-muted hidden sm:inline">
                    {inst.active_k_concurrency}
                  </span>
                  <span
                    className={`col-span-1 text-right ${inst.drain_state === "active" ? "text-success" : "text-warning"}`}
                  >
                    {inst.drain_state}
                  </span>
                  <span className="col-span-2 text-right text-fg-secondary">
                    {(() => {
                      const isPpoi = inst.id.startsWith("ppoi-");
                      if (isPpoi) return "ppoi mirror";
                      if (inst.role === "static") return "static";
                      if (m?.lastApplied) return `#${formatNumber(m.lastApplied)}`;
                      return "-";
                    })()}
                  </span>
                  <span className="col-span-2 text-right text-fg-muted">
                    {(() => {
                      const isPpoi = inst.id.startsWith("ppoi-");
                      if (isPpoi) return "n/a";
                      if (inst.role === "static") return "n/a";
                      if (m?.lag === undefined) return "loading";
                      if (m.lag === 0) return "synced";
                      return `${formatNumber(m.lag)} blk`;
                    })()}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}

        {rssHistory.length > 1 && (
          <div className="border border-fg-faint p-5">
            <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono mb-3">
              process resident memory · last {rssHistory.length} samples
            </div>
            <Spark series={rssHistory.map((p) => p.rssBytes)} />
            <div className="flex justify-between text-mono-xs text-fg-muted mt-2">
              <span>min {formatBytes(Math.min(...rssHistory.map((p) => p.rssBytes)))}</span>
              <span>max {formatBytes(Math.max(...rssHistory.map((p) => p.rssBytes)))}</span>
            </div>
          </div>
        )}

        <p className="mt-8 text-[0.7rem] text-fg-muted leading-relaxed max-w-3xl">
          Per-instance{" "}
          <code className="font-mono text-[0.78rem]">last_applied_block</code> and{" "}
          <code className="font-mono text-[0.78rem]">lag</code> come from{" "}
          <code className="font-mono text-[0.78rem]">/metrics</code>, not the global aggregate
          on{" "}
          <code className="font-mono text-[0.78rem]">/v1/health/ready</code> (which can be
          stale because it reads the static-tree anchor).
        </p>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: "success" | "warning";
}) {
  const accentClass =
    accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : "text-fg";
  return (
    <div className="bg-bg-secondary px-5 py-5">
      <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono mb-2">
        {label}
      </div>
      <div className={`font-serif text-3xl ${accentClass}`}>{value}</div>
      {detail && <div className="text-[0.7rem] text-fg-muted mt-1">{detail}</div>}
    </div>
  );
}

function Spark({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(1, max - min);
  const w = 600;
  const h = 60;
  const step = w / Math.max(1, series.length - 1);
  const points = series.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
    </svg>
  );
}

function Ago({ ts }: { ts: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  return <span>last event {diff}s ago</span>;
}

const RE_INSTANCE_LAST = /^raven_railgun_indexer_last_applied_block\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_INSTANCE_HEAD = /^raven_railgun_indexer_chain_head_block_per_instance\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_INSTANCE_LAG = /^raven_railgun_indexer_lag_blocks_per_instance\{instance="([^"]+)"\}\s+(\d+(?:\.\d+)?)/;
const RE_UPTIME = /^raven_railgun_uptime_seconds\s+(\d+(?:\.\d+)?)/;
const RE_RSS = /^process_resident_memory_bytes\s+(\d+(?:\.\d+)?)/;
const RE_RSS_RAVEN = /^raven_process_resident_memory_bytes\s+(\d+(?:\.\d+)?)/;
const RE_QUERIES = /^raven_railgun_pir_queries_total\{[^}]*\}\s+(\d+(?:\.\d+)?)/;

function parseMetrics(text: string): MetricsBundle {
  const out: MetricsBundle = { perInstance: {} };
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(RE_INSTANCE_LAST))) {
      const id = m[1];
      out.perInstance[id] = { ...(out.perInstance[id] ?? {}), lastApplied: Number(m[2]) };
    } else if ((m = line.match(RE_INSTANCE_HEAD))) {
      const id = m[1];
      out.perInstance[id] = { ...(out.perInstance[id] ?? {}), chainHead: Number(m[2]) };
    } else if ((m = line.match(RE_INSTANCE_LAG))) {
      const id = m[1];
      out.perInstance[id] = { ...(out.perInstance[id] ?? {}), lag: Number(m[2]) };
    } else if ((m = line.match(RE_UPTIME))) {
      out.uptimeSeconds = Number(m[1]);
    } else if ((m = line.match(RE_RSS_RAVEN))) {
      out.rssBytes = Number(m[1]);
    } else if (out.rssBytes === undefined && (m = line.match(RE_RSS))) {
      out.rssBytes = Number(m[1]);
    } else if ((m = line.match(RE_QUERIES))) {
      out.totalQueries = (out.totalQueries ?? 0) + Number(m[1]);
    }
  }
  return out;
}
