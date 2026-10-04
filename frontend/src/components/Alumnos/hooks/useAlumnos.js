import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alumnosApi } from "../api/alumnosApi";

const EMPTY_PAGINATION = {
  pagina: 1,
  por_pagina: 100,
  total: 0,
  total_paginas: 0,
  desde: 0,
  hasta: 0,
  tiene_anterior: false,
  tiene_siguiente: false,
};

export function useAlumnos(filtros = {}, source = "activos") {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const [response, setResponse] = useState({
    items: [],
    resumen: {},
    catalogos: {},
    paginacion: EMPTY_PAGINATION,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const cargar = useCallback(async ({ silent = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = JSON.parse(query);
      const result = source === "activos"
        ? await alumnosApi.listar(params)
        : await alumnosApi.listarEgresados(params);
      if (currentRequest !== requestId.current) return null;
      setResponse({
        items: result.items || [],
        resumen: result.resumen || {},
        catalogos: result.catalogos || {},
        paginacion: result.paginacion || EMPTY_PAGINATION,
      });
      return result;
    } catch (err) {
      if (currentRequest !== requestId.current) return null;
      setError(err.message || "No se pudieron cargar los alumnos.");
      return null;
    } finally {
      if (!silent && currentRequest === requestId.current) setLoading(false);
    }
  }, [query, source]);

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
