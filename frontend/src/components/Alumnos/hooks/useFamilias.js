import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { familiasApi } from "../api/alumnosApi";

export function useFamilias(filtros = {}) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const [response, setResponse] = useState({ items: [], resumen: {}, catalogos: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const cargar = useCallback(async ({ silent = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const result = await familiasApi.listar(JSON.parse(query));
      if (currentRequest !== requestId.current) return null;
      setResponse({
        items: result.items || [],
        resumen: result.resumen || {},
        catalogos: result.catalogos || {},
      });
      return result;
    } catch (err) {
      if (currentRequest !== requestId.current) return null;
      setError(err.message || "No se pudieron cargar las familias.");
      return null;
    } finally {
      if (!silent && currentRequest === requestId.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    cargar();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") cargar({ silent: true });
    };
    const timer = window.setInterval(refreshVisible, 60000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [cargar]);

  return { ...response, loading, error, cargar };
}
