import { CONFIG } from "./config";

export interface HealthReady {
  status: string;
  instances: number;
  consumer: {
    indexer_lag_blocks: number;
    last_applied_block: number;
    last_known_chain_head: number;
  };
}

export interface InstanceStatus {
  id: string;
  epoch: number;
  role: string;
  drain_state: string;
  in_flight: number;
  active_k_concurrency: number;
}

export interface StatusBody {
  scheme: string;
  instances: InstanceStatus[];
  consumer: {
    last_applied_block: number;
    last_known_chain_head: number;
    indexer_lag_blocks: number;
    events_processed: number;
    commits_fired: number;
    reorgs_handled: number;
    consumer_errors: number;
  };
}

const headers = (): HeadersInit => ({
  Authorization: `Bearer ${CONFIG.ravenBearer}`,
});

export async function fetchHealthReady(): Promise<HealthReady> {
  const res = await fetch(`${CONFIG.ravenUrl}/v1/health/ready`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`/v1/health/ready: HTTP ${res.status}`);
  return res.json();
}

export async function fetchStatus(): Promise<StatusBody> {
  const res = await fetch(`${CONFIG.ravenUrl}/v1/status`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`/v1/status: HTTP ${res.status}`);
  return res.json();
}

export async function fetchMetricsText(): Promise<string> {
  const res = await fetch(`${CONFIG.ravenUrl}/metrics`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`/metrics: HTTP ${res.status}`);
  return res.text();
}

export interface ParsedMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export function parseMetricsText(text: string): ParsedMetric[] {
  const out: ParsedMetric[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let name = "";
    let labels: Record<string, string> = {};
    let valueStr = "";

    const braceStart = line.indexOf("{");
    if (braceStart === -1) {
      const sp = line.indexOf(" ");
      if (sp === -1) continue;
      name = line.slice(0, sp);
      valueStr = line.slice(sp + 1).trim();
    } else {
      name = line.slice(0, braceStart);
      const braceEnd = line.indexOf("}", braceStart);
      if (braceEnd === -1) continue;
      const labelText = line.slice(braceStart + 1, braceEnd);
      labels = parseLabels(labelText);
      valueStr = line.slice(braceEnd + 1).trim();
    }
    const value = Number(valueStr.split(" ")[0]);
    if (!Number.isFinite(value)) continue;
    out.push({ name, labels, value });
  }
  return out;
}

function parseLabels(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const eq = s.indexOf("=", i);
    if (eq === -1) break;
    const key = s.slice(i, eq).trim();
    if (s[eq + 1] !== '"') break;
    let j = eq + 2;
    let value = "";
    while (j < s.length && s[j] !== '"') {
      if (s[j] === "\\" && j + 1 < s.length) {
        value += s[j + 1];
        j += 2;
      } else {
        value += s[j];
        j += 1;
      }
    }
    out[key] = value;
    i = j + 1;
    while (i < s.length && (s[i] === "," || s[i] === " ")) i += 1;
  }
  return out;
}

export interface CachingHeaders {
  etag: string | null;
  cacheControl: string | null;
  vary: string | null;
  cfCacheStatus: string | null;
  size: number | null;
}

export async function probeCachingHeaders(
  instance = CONFIG.defaultInstance
): Promise<CachingHeaders> {
  const res = await fetch(
    `${CONFIG.ravenUrl}/v1/instance/${encodeURIComponent(instance)}/params`,
    {
      method: "HEAD",
      headers: headers(),
    }
  );
  if (!res.ok) throw new Error(`HEAD /params: HTTP ${res.status}`);
  return {
    etag: res.headers.get("etag"),
    cacheControl: res.headers.get("cache-control"),
    vary: res.headers.get("vary"),
    cfCacheStatus: res.headers.get("cf-cache-status"),
    size: Number(res.headers.get("content-length")) || null,
  };
}

export async function probeIfNoneMatch304(
  etag: string,
  instance = CONFIG.defaultInstance
): Promise<{ status: number; bodyBytes: number }> {
  const res = await fetch(
    `${CONFIG.ravenUrl}/v1/instance/${encodeURIComponent(instance)}/params`,
    {
      headers: {
        ...headers(),
        "If-None-Match": etag,
      },
    }
  );
  const buf = res.status === 304 ? new ArrayBuffer(0) : await res.arrayBuffer();
  return { status: res.status, bodyBytes: buf.byteLength };
}
