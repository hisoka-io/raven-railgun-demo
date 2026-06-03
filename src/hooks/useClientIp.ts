import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/lib/config";

export interface ClientIpDetail {
  label: string;
  value: string;
}

export interface ClientIpInfo {
  ip: string;
  details: ClientIpDetail[];
}

const DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "hostname", label: "hostname" },
  { key: "city", label: "city" },
  { key: "region", label: "region" },
  { key: "country", label: "country" },
  { key: "org", label: "org / ISP" },
  { key: "postal", label: "postal" },
  { key: "loc", label: "lat,long" },
  { key: "timezone", label: "timezone" },
];

export function useClientIp(): { data: ClientIpInfo | null; error: string | null } {
  const [data, setData] = useState<ClientIpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    fetch(CONFIG.ipEchoUrl, { headers: { accept: "application/json" } })
      .then((resp) => resp.json())
      .then((raw: Record<string, string>) => {
        if (!active) return;
        const ip = typeof raw.ip === "string" ? raw.ip : "";
        if (!ip) {
          setError("ip echo returned no ip field");
          return;
        }
        const details = DETAIL_FIELDS.filter(
          (f) => typeof raw[f.key] === "string" && raw[f.key].length > 0,
        ).map((f) => ({ label: f.label, value: raw[f.key] }));
        setData({ ip, details });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      active = false;
    };
  }, []);

  return { data, error };
}
