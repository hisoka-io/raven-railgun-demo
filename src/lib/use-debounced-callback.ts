import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  handler: T,
  delayMs: number
): T {
  const ref = useRef(handler);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
  return useCallback(
    ((...args: Parameters<T>) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        ref.current(...args);
      }, delayMs);
    }) as T,
    [delayMs]
  );
}
