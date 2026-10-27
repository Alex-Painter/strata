import { useCallback, useEffect, useRef } from "react";

/**
 * Signals for a component's requests that keep asking the server (see
 * `PollOptions`). Starting a new one, calling `stop`, or unmounting aborts the
 * one before, so an abandoned request can't report progress or navigate later.
 */
export function useLatestRequest(): { next: () => AbortSignal; stop: () => void } {
  const current = useRef<AbortController | null>(null);
  const stop = useCallback(() => current.current?.abort(), []);
  const next = useCallback(() => {
    current.current?.abort();
    current.current = new AbortController();
    return current.current.signal;
  }, []);
  useEffect(() => stop, [stop]);
  return { next, stop };
}
