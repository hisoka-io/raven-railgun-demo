import { useCallback, useEffect, useRef, useState } from "react";
import { disconnectNoxClient, getNoxClient, isNoxConnected } from "@/lib/nox";

export type NoxStatus = "disconnected" | "connecting" | "connected" | "error";

export interface UseNoxClient {
  status: NoxStatus;
  error: string | null;
  connect: () => Promise<void>;
  reconnect: () => void;
}

export function useNoxClient(): UseNoxClient {
  const [status, setStatus] = useState<NoxStatus>(isNoxConnected() ? "connected" : "disconnected");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const connect = useCallback(async () => {
    if (isNoxConnected()) {
      setStatus("connected");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      await getNoxClient();
      if (mounted.current) setStatus("connected");
    } catch (err) {
      if (mounted.current) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reconnect = useCallback(() => {
    disconnectNoxClient();
    setError(null);
    void connect();
  }, [connect]);

  return { status, error, connect, reconnect };
}
