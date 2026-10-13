import { useEffect, useRef } from "react";

const MIN_INTERVAL_MS = 1000;

/**
 * Re-runs `revalidate` when the user returns to this page: the window regains
 * focus or the document becomes visible again. It is the one revalidation
 * point for state read from the server that another session can change while
 * this page sits open (a revoked role, a completed review). There is no
 * polling and no timer; an idle page is not refreshed. Bursts (focus and
 * visibilitychange together) collapse into one call.
 */
export default function useRevalidateOnReturn(revalidate, enabled = true) {
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    let lastRunAt = 0;
    const run = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRunAt < MIN_INTERVAL_MS) return;
      lastRunAt = now;
      revalidateRef.current?.();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);
}
