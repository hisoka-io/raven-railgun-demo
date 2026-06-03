import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/lib/config";

export interface NoxNodes {
  entry: string;
  mix: string;
  exit: string;
  exitIps: string[];
}

interface RawNode {
  address?: string;
  ingress_url?: string;
  url?: string;
  layer?: number;
  role?: number;
}

function hostOf(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function label(node: RawNode): string {
  const host = hostOf(node.ingress_url ?? node.url ?? "");
  if (host.length > 0) return host;
  return node.address ? node.address.slice(0, 10) : "node";
}

export function useNoxNodes(): NoxNodes | null {
  const [nodes, setNodes] = useState<NoxNodes | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    fetch(CONFIG.noxSeedUrl, { headers: { accept: "application/json" } })
      .then((resp) => resp.json())
      .then((raw: { nodes?: RawNode[] }) => {
        if (!active) return;
        const list = Array.isArray(raw.nodes) ? raw.nodes : [];
        const exits = list.filter((n) => n.role === 2 || n.role === 3);
        const entries = list.filter((n) => (n.layer ?? 0) === 0 && n.role === 1);
        const mixes = list.filter((n) => (n.layer ?? 0) === 1);
        const exitIps = [...new Set(exits.map((n) => hostOf(n.ingress_url ?? n.url ?? "")).filter((h) => h.length > 0))];
        if (exitIps.length === 0) return;
        setNodes({
          entry: entries[0] ? label(entries[0]) : "entry",
          mix: mixes[0] ? label(mixes[0]) : "mix",
          exit: exitIps[0],
          exitIps,
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return nodes;
}
