import React, { useEffect, useMemo, useRef, useState } from "react";
import { upper } from "../ventasUtils";

const normalizar = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");

/** Selector buscable de un curso de una campaña concreta (no del padrón global). */
export default function DocenteResponsableSelector({ grupo, docentes, asignacion, writable, saving, onAssign }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const hostRef = useRef(null);
  const nombre = asignacion?.docente_nombre || "";
  const etiquetaCurso = `${grupo.nombre_anio || "—"} ${grupo.nombre_division || ""}`.trim();

  useEffect(() => { setQuery(upper(nombre, 100)); setOpen(false); }, [nombre, grupo.id_anio, grupo.id_division]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!hostRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery(upper(nombre, 100));
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, nombre]);

  const resultados = useMemo(() => {
    const q = normalizar(query.trim());
    return (docentes || []).filter((d) => !q || normalizar(`${d.docente} ${d.dni || ""}`).includes(q)).slice(0, 12);
  }, [docentes, query]);
  const onElegir = async (id, label) => {
    setOpen(false);
    setQuery(upper(label, 100));
    try { await onAssign(grupo, id); }
    catch { setQuery(upper(nombre, 100)); }
  };

  return (
    <div className="ventas-docente-responsable" ref={hostRef}>
      <div className="ventas-docente-responsable__info">
        <strong>{etiquetaCurso}</strong>
        <small>{nombre ? `RESPONSABLE: ${upper(nombre, 100)}${asignacion?.docente_activo != null && Number(asignacion.docente_activo) !== 1 ? " (INACTIVO / HISTÓRICO)" : ""}` : "SIN DOCENTE ASIGNADO"}</small>
      </div>
      {writable ? (
        <div className="ventas-docente-responsable__control">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`docentes-curso-${grupo.id_anio}-${grupo.id_division}`}
            aria-label={`Buscar docente responsable para ${etiquetaCurso}`}
            placeholder="BUSCAR DOCENTE POR NOMBRE O DNI"
            value={query}
            disabled={saving}
            onFocus={() => { setOpen(true); setQuery(""); }}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setOpen(false); setQuery(upper(nombre, 100)); inputRef.current?.blur(); }
              if (event.key === "Enter" && open && resultados.length === 1) {
                event.preventDefault();
                onElegir(resultados[0].id_docente, resultados[0].docente);
              }
            }}
          />
          {nombre && <button type="button" disabled={saving} className="ventas-docente-responsable__clear" onClick={() => onElegir(null, "")} aria-label={`Quitar docente responsable de ${etiquetaCurso}`}>Quitar</button>}
          {open && !saving && (
            <div className="ventas-docente-responsable__results" id={`docentes-curso-${grupo.id_anio}-${grupo.id_division}`} role="listbox" aria-label={`Docentes disponibles para ${etiquetaCurso}`}>
              {resultados.map((docente) => (
                <button type="button" role="option" aria-selected={String(asignacion?.id_docente || "") === String(docente.id_docente)} key={docente.id_docente} onClick={() => onElegir(docente.id_docente, docente.docente)}>
                  <strong>{upper(docente.docente, 100)}</strong><small>{docente.dni ? `DNI ${docente.dni}` : "SIN DNI"}</small>
                </button>
              ))}
              {!resultados.length && <span>No hay docentes activos con esa búsqueda.</span>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
