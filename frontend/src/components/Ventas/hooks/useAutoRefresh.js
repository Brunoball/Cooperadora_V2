import { useEffect, useRef } from "react";

export function useAutoRefresh(refresh, intervalMs = 30000) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") refreshRef.current?.();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    const timer = window.setInterval(run, intervalMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
