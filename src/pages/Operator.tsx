import { useEffect, useMemo, useState } from "react";
import { useEventsStream } from "@/lib/use-events-stream";
import { CONFIG } from "@/lib/config";
import { formatNumber, formatUptime } from "@/lib/format";
import type { InstanceStatus } from "@/lib/raven-client";

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
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [streamOpenedAt, setStreamOpenedAt] = useState<number | null>(null);
  const [commitsHistory, setCommitsHistory] = useState<{ ts: number; total: number }[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state === "open" && streamOpenedAt === null) {
      setStreamOpenedAt(Date.now());
    }
  }, [state, streamOpenedAt]);

  useEffect(() => {
    if (!status?.consumer) return;
    const total = status.consumer.commits_fired;
    setCommitsHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.total === total) return prev;
      return [...prev, { ts: Date.now(), total }].slice(-HISTORY_LIMIT);
    });
  }, [status?.consumer]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const ctl = new AbortController();
        const to = window.setTimeout(() => ctl.abort(), 8_000);
        const res = await fetch(`${CONFIG.ravenUrl}/metrics`, {
          headers: { Authorization: `Bearer ${CONFIG.ravenBearer}` },
          signal: ctl.signal,
        });
        window.clearTimeout(to);
        if (!res.ok) {
          if (!cancelled) setMetricsError(`/metrics ${res.status}`);
          return;
        }
        const text = await res.text();
        const parsed = parseMetrics(text);
        if (cancelled) return;
        setMetrics(parsed);
        setMetricsError(null);
      } catch (err) {
        if (!cancelled) setMetricsError(err instanceof Error ? err.message : String(err));
      }
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const consumerHealth = useMemo<"healthy" | "degraded" | "draining" | "unknown">(() => {
    if (!status?.consumer) return "unknown";
    if (status.consumer.consumer_errors > 0) return "degraded";
    if (status.instances.some((i) => i.drain_state !== "active")) return "draining";
    return "healthy";
  }, [status]);

  const heartbeatLabel =
    state === "open"
      ? consumerHealth === "healthy"
        ? "healthy"
        : consumerHealth === "degraded"
          ? "degraded"
          : consumerHealth === "draining"
            ? "draining"
            : "syncing"
      : state === "connecting"
        ? "connecting"
        : "offline";

  const heartbeatColor =
    consumerHealth === "healthy" && state === "open"
      ? "var(--color-success)"
      : "var(--color-warning)";

  const instances = status?.instances ?? [];
  const liveInstances = instances.filter((i) => i.role === "live");
  const staticInstances = instances.filter(
    (i) => i.role === "static" && !i.id.startsWith("ppoi-")
  );
  const ppoiInstances = instances.filter((i) => i.id.startsWith("ppoi-"));

  const liveBlock = (() => {
    if (liveInstances.length === 0) return null;
    const id = liveInstances[0].id;
    const m = metrics?.perInstance[id];
    if (m?.lastApplied === undefined) return null;
    return { id, lastApplied: m.lastApplied, lag: m.lag };
  })();

  const recentCommits =
    commitsHistory.length >= 2
      ? commitsHistory[commitsHistory.length - 1].total - commitsHistory[0].total
      : null;

  const streamDurationSec =
    streamOpenedAt !== null ? Math.max(0, Math.floor((now - streamOpenedAt) / 1000)) : null;
  const lastEventAgo =
    lastEventAt !== null ? Math.max(0, Math.floor((now - lastEventAt) / 1000)) : null;

  return (
    <section className="bg-bg">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20">
        {/* Status hero */}
        <div className="grid md:grid-cols-[1fr_auto] gap-10 md:gap-16 items-end pb-8 border-b border-fg-faint">
          <div>
            <p className="text-[0.625rem] uppercase tracking-[0.24em] text-fg-muted font-mono">
              Live operator state · push-driven
            </p>
            <div className="flex items-center gap-4 sm:gap-5 mt-3 flex-wrap">
              <h1 className="font-serif text-5xl sm:text-6xl lg:text-[64px] leading-none tracking-tight font-normal">
                raven.hisoka.io
              </h1>
              <span className="inline-flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${heartbeatLabel === "healthy" ? "animate-hb" : ""}`}
                  style={{ background: heartbeatColor }}
                />
                <span
                  className="font-mono text-[0.7rem] uppercase tracking-[0.14em]"
                  style={{ color: heartbeatColor }}
                >
                  {heartbeatLabel}
                </span>
              </span>
            </div>
            <p className="mt-4 text-fg-secondary max-w-[60ch] leading-relaxed">
              {instances.length > 0
                ? `${instances.length} ${instances.length === 1 ? "instance is" : "instances are"} ${
                    instances.every((i) => i.drain_state === "active")
                      ? "active and synced. "
                      : "running. "
                  }`
                : "Connecting to operator. "}
              Status streams in real-time from{" "}
              <code className="font-mono text-[0.85rem] bg-bg-secondary border border-fg-faint px-1.5 py-0.5">
                /v1/events
              </code>
              ; per-instance metrics refresh every 30 seconds from{" "}
              <code className="font-mono text-[0.85rem] bg-bg-secondary border border-fg-faint px-1.5 py-0.5">
                /metrics
              </code>
              .
            </p>
          </div>

          <div className="flex flex-col gap-1.5 md:items-end font-mono text-[0.625rem] uppercase tracking-[0.14em] text-fg-muted">
            <span>
              Stream open{" "}
              <b className="text-fg pl-2 font-medium">
                {streamDurationSec !== null ? formatUptime(streamDurationSec) : "-"}
              </b>
            </span>
            <span>
              Last event{" "}
              <b className="text-fg pl-2 font-medium">
                {lastEventAgo !== null ? `${lastEventAgo}s ago` : "-"}
              </b>
            </span>
            <span>
              Last block{" "}
              <b className="text-fg pl-2 font-medium">
                {status?.consumer ? formatNumber(status.consumer.last_applied_block) : "-"}
              </b>
            </span>
            {metricsError && (
              <span className="text-warning normal-case tracking-normal">
                metrics: {metricsError}
              </span>
            )}
          </div>
        </div>

        {(state === "error" || state === "closed") && !status && (
          <div className="border border-warning/40 bg-warning/5 p-4 mt-8 text-[0.85rem] text-fg-secondary">
            <strong className="text-warning">stream {state}</strong>
            {errorMessage ? <> · {errorMessage}</> : null}
            <span className="text-fg-muted ml-2">retrying automatically</span>
          </div>
        )}

        {/* KPI strip */}
        {status && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-fg-faint border border-fg-faint mt-8">
            <Kpi
              featured
              label="Instances"
              value={`${instances.length} / ${instances.length}`}
              detail={`${liveInstances.length} live · ${staticInstances.length} static · ${
                instances.every((i) => i.drain_state === "active") ? "all active" : "draining"
              }`}
            />
            <Kpi
              label="Consumer"
              value={
                consumerHealth === "healthy"
                  ? "Healthy"
                  : consumerHealth === "degraded"
                    ? "Degraded"
                    : consumerHealth === "draining"
                      ? "Draining"
                      : "Unknown"
              }
              valueClass={
                consumerHealth === "healthy" ? "text-success" : "text-warning"
              }
              detail={
                status.consumer
                  ? `${formatNumber(status.consumer.consumer_errors)} errors · ${formatNumber(status.consumer.reorgs_handled)} reorgs`
                  : "no consumer"
              }
            />
            <Kpi
              label={
                recentCommits !== null
                  ? `Commits (last ${commitsHistory.length} samples)`
                  : "Commits fired"
              }
              value={
                recentCommits !== null
                  ? formatNumber(recentCommits)
                  : status.consumer
                    ? formatNumber(status.consumer.commits_fired)
                    : "-"
              }
              spark={
                commitsHistory.length > 1 ? commitsHistory.map((p) => p.total) : undefined
              }
            />
            <Kpi
              label="Live block"
              value={
                liveBlock
                  ? formatNumber(liveBlock.lastApplied)
                  : status.consumer
                    ? formatNumber(status.consumer.last_applied_block)
                    : "-"
              }
              detail={
                liveBlock
                  ? `${liveBlock.id} · ${
                      liveBlock.lag !== undefined
                        ? `${formatNumber(liveBlock.lag)} blk lag`
                        : "lag unknown"
                    }`
                  : "from consumer aggregate"
              }
            />
          </div>
        )}

        {/* Live commit-tree */}
        {liveInstances.length > 0 && (
          <Group
            title="Live commit-tree"
            subtitle={`${liveInstances.length} instance${liveInstances.length === 1 ? "" : "s"} · accepting writes`}
          >
            <div className="grid grid-cols-1 gap-px bg-fg-faint">
              {liveInstances.map((inst) => (
                <LiveCard
                  key={inst.id}
                  inst={inst}
                  metrics={metrics?.perInstance[inst.id]}
                />
              ))}
            </div>
          </Group>
        )}

        {/* Static commit-trees */}
        {staticInstances.length > 0 && (
          <Group
            title="Static commit-trees"
            subtitle={`${staticInstances.length} instance${staticInstances.length === 1 ? "" : "s"} · sealed`}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-fg-faint">
              {staticInstances.map((inst) => (
                <StaticCard key={inst.id} inst={inst} kind="static" />
              ))}
            </div>
          </Group>
        )}

        {/* PPOI mirrors */}
        {ppoiInstances.length > 0 && (
          <Group
            title="PPOI mirrors"
            subtitle={`${ppoiInstances.length} instance${ppoiInstances.length === 1 ? "" : "s"} · OFAC list`}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint">
              {ppoiInstances.map((inst) => (
                <StaticCard key={inst.id} inst={inst} kind="mirror" />
              ))}
            </div>
          </Group>
        )}

        <div className="mt-14 p-5 bg-bg-secondary border border-fg-faint font-mono text-[0.75rem] leading-relaxed text-fg-muted">
          Per-instance <code className="text-fg">last_applied_block</code> and{" "}
          <code className="text-fg">lag</code> come from{" "}
          <code className="text-fg">/metrics</code>, not the global aggregate on{" "}
          <code className="text-fg">/v1/health/ready</code> (which can be stale because it
          reads the static-tree anchor).
        </div>
      </div>
    </section>
  );
}

function Group({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between pb-3.5 border-b border-fg-faint">
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-fg-muted">
          {subtitle}
        </span>
      </div>
      <div className="mt-px">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  detail,
  spark,
  featured,
  valueClass,
}: {
  label: string;
  value: string;
  detail?: string;
  spark?: number[];
  featured?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className="bg-bg p-5 sm:p-6"
      style={
        featured
          ? {
              background:
                "linear-gradient(180deg, rgba(61,139,64,0.06) 0%, var(--color-bg) 100%)",
            }
          : undefined
      }
    >
      <div className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-fg-muted">
        {label}
      </div>
      <div
        className={`font-serif text-[34px] sm:text-[38px] leading-tight mt-2 ${valueClass ?? "text-fg"}`}
      >
        {value}
      </div>
      {detail && (
        <div className="font-mono text-[0.65rem] text-fg-muted mt-1">{detail}</div>
      )}
      {spark && spark.length > 1 && <Sparkline series={spark} />}
    </div>
  );
}

function LiveCard({
  inst,
  metrics,
}: {
  inst: InstanceStatus;
  metrics?: { lastApplied?: number; lag?: number };
}) {
  return (
    <div className="bg-bg p-5 sm:p-6 flex flex-col gap-3 border border-success/25">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[13px] text-fg">{inst.id}</span>
        <RolePill kind="live" />
      </div>
      <div className="grid grid-cols-3 gap-x-[18px] gap-y-[14px]">
        <Stat label="Epoch" value={String(inst.epoch)} />
        <Stat label="In-flight" value={String(inst.in_flight)} />
        <Stat label="K (semaphore)" value={String(inst.active_k_concurrency)} />
        <Stat
          label="Drain"
          value={inst.drain_state}
          tone={inst.drain_state === "active" ? "green" : "warn"}
        />
        <Stat
          label="Last applied"
          value={
            metrics?.lastApplied !== undefined
              ? `#${formatNumber(metrics.lastApplied)}`
              : "-"
          }
          tone="muted"
        />
        <Stat
          label="Lag"
          value={
            metrics?.lag === undefined
              ? "-"
              : metrics.lag === 0
                ? "synced"
                : `${formatNumber(metrics.lag)} blk`
          }
          tone={metrics?.lag === 0 ? "green" : "accent"}
        />
      </div>
      <div className="pulse-bar mt-2" />
    </div>
  );
}

function StaticCard({
  inst,
  kind,
}: {
  inst: InstanceStatus;
  kind: "static" | "mirror";
}) {
  const isPpoi = inst.id.startsWith("ppoi-");
  const footerLeft = isPpoi
    ? "ppoi mirror · 65,536 rows"
    : `${formatNumber(131072)} leaves`;
  return (
    <div className="bg-bg p-5 sm:p-6 flex flex-col gap-3 min-h-[160px]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[13px] text-fg">{inst.id}</span>
        <RolePill kind={kind} />
      </div>
      <div className="grid grid-cols-3 gap-x-[18px] gap-y-[14px]">
        <Stat label="Epoch" value={String(inst.epoch)} />
        <Stat label="K" value={String(inst.active_k_concurrency)} />
        <Stat
          label="Drain"
          value={inst.drain_state}
          tone={inst.drain_state === "active" ? "green" : "warn"}
        />
      </div>
      <div className="mt-auto flex justify-between items-center pt-3 border-t border-fg-faint font-mono text-[0.625rem] text-fg-muted">
        <span className="text-fg-secondary">{footerLeft}</span>
        <span>n/a</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "muted" | "accent" | "warn";
}) {
  const toneClass =
    tone === "green"
      ? "text-success"
      : tone === "muted"
        ? "text-fg-secondary"
        : tone === "accent"
          ? "text-accent"
          : tone === "warn"
            ? "text-warning"
            : "text-fg";
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-fg-muted">
        {label}
      </div>
      <div
        className={`font-mono text-[18px] font-medium leading-[1.1] tabular-nums ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function RolePill({ kind }: { kind: "live" | "static" | "mirror" }) {
  const map: Record<typeof kind, string> = {
    live: "bg-success/12 text-success",
    static: "bg-accent/12 text-accent",
    mirror: "bg-fg/8 text-fg-secondary",
  };
  const label = kind === "live" ? "LIVE" : kind === "static" ? "STATIC" : "MIRROR";
  return (
    <span
      className={`font-mono text-[9.5px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full ${map[kind]}`}
    >
      {label}
    </span>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(1, max - min);
  const w = 200;
  const h = 28;
  const step = w / Math.max(1, series.length - 1);
  const points = series.map(
    (v, i) => `${i * step},${h - ((v - min) / range) * h}`
  );
  const linePath = `M${points.join(" L")}`;
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full h-7 mt-3 block"
    >
      <path d={fillPath} fill="var(--color-success)" opacity="0.08" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-success)"
        strokeWidth="1.2"
        opacity="0.9"
      />
    </svg>
  );
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
