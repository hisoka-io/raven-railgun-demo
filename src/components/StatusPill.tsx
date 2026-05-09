import { useEventsStream } from "@/lib/use-events-stream";

export function StatusPill() {
  const { status, state, errorMessage } = useEventsStream();
  const consumer = status?.consumer ?? null;
  const instances = status?.instances ?? [];
  const drainingInstance = instances.find((inst) => inst.drain_state !== "active");
  const consumerErrors = consumer?.consumer_errors ?? 0;

  const ready =
    state === "open" && consumerErrors === 0 && drainingInstance === undefined;

  const color =
    state === "error" || state === "closed"
      ? "bg-error"
      : ready
      ? "bg-success"
      : "bg-warning";
  const label =
    state === "error" || state === "closed"
      ? errorMessage ? "offline" : "reconnecting"
      : !consumer
      ? "connecting"
      : ready
      ? "live"
      : drainingInstance
      ? `draining ${drainingInstance.id}`
      : consumerErrors > 0
      ? `degraded · ${consumerErrors} err`
      : "live";

  const instanceCount = instances.length;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border border-fg-faint text-mono-xs text-fg-secondary">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} animate-pulse-soft`} />
      <span className="uppercase tracking-wider text-[0.55rem] text-fg-muted">{label}</span>
      <span className="text-fg-faint">·</span>
      <span>raven.hisoka.io</span>
      {instanceCount > 0 && (
        <>
          <span className="text-fg-faint">·</span>
          <span>{instanceCount} instances</span>
        </>
      )}
    </div>
  );
}
