import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  handler: T,
  delayMs: number
): T {
  const lastFiredAt = useRef<number>(0);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  return useCallback(
    ((...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastFiredAt.current < delayMs) return;
      lastFiredAt.current = now;
      return ref.current(...args);
    }) as T,
    [delayMs]
  );
}
