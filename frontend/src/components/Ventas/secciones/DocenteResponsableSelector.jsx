import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faCheck } from "@fortawesome/free-solid-svg-icons";
import { upper } from "../ventasUtils";

const normalizar = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");

/** Selector buscable de un curso de una campaña concreta (no del padrón global). */
export default function DocenteResponsableSelector({ grupo, docentes, asignacion, writable, saving, onAssign, panelOpen = true }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const fieldRef = useRef(null);
  const listRef = useRef(null);
  const [listStyle, setListStyle] = useState(null);
  const inputId = `docente-input-${grupo.id_anio}-${grupo.id_division}`;
  const nombre = asignacion?.docente_nombre || "";
  const etiquetaCurso = `${grupo.nombre_anio || "—"} ${grupo.nombre_division || ""}`.trim();

  useEffect(() => { if (!panelOpen) { setOpen(false); setQuery(upper(nombre, 100)); } }, [panelOpen, nombre]);

  useEffect(() => { setQuery(upper(nombre, 100)); setOpen(false); }, [nombre, grupo.id_anio, grupo.id_division]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!fieldRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery(upper(nombre, 100));
        if (document.activeElement === inputRef.current) inputRef.current.blur();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
    };
  }, [open, nombre]);

  const resultados = useMemo(() => {
    const q = normalizar(query.trim());
    return (docentes || []).filter((d) => !q || normalizar(`${d.docente} ${d.dni || ""}`).includes(q)).slice(0, 12);
  }, [docentes, query]);
  useLayoutEffect(() => {
    if (!open || saving) return undefined;
    const updatePosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const grid = input.closest(".ventas-docentes-responsables__grid");
      const bounds = grid?.getBoundingClientRect();
      if (bounds && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) {
        setOpen(false);
        setQuery(upper(nombre, 100));
        return;
      }
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || window.innerWidth;
      const below = viewportTop + viewportHeight - rect.bottom - 12;
      const above = rect.top - viewportTop - 12;
      const upwards = below < 220 && above > below;
      const width = Math.min(rect.width, viewportWidth - 16);
      const theme = getComputedStyle(input);
      setListStyle({
        left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)),
        width,
        top: upwards ? undefined : rect.bottom + 4,
        bottom: upwards ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.max(0, Math.min(260, upwards ? above : below)),
        background: theme.backgroundColor,
        color: theme.color,
        "--mov-border": theme.borderTopColor,
        "--balto-action": theme.getPropertyValue("--balto-action"),
        "--mov-card": theme.backgroundColor,
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(inputRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [open, saving, nombre]);

  const onElegir = async (id, label) => {
    setOpen(false);
    setQuery(upper(label, 100));
    try { await onAssign(grupo, id); }
    catch { setQuery(upper(nombre, 100)); }
  };

  return (
    <div className="ventas-docente-responsable">
      <div className="ventas-docente-responsable__info">
        <strong>{etiquetaCurso}</strong>
        <small>{nombre ? `RESPONSABLE: ${upper(nombre, 100)}${asignacion?.docente_activo != null && Number(asignacion.docente_activo) !== 1 ? " (INACTIVO / HISTÓRICO)" : ""}` : "SIN DOCENTE ASIGNADO"}</small>
      </div>
      {writable ? (
        <div className="ventas-docente-responsable__control">
          <label ref={fieldRef} htmlFor={inputId} className={`module-filter ventas-docente-responsable__field${query ? " is-active" : ""}`}>
          <input
            id={inputId}
            className="module-filterControl module-filterControl--search"
            autoComplete="off"
            ref={inputRef}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`docentes-curso-${grupo.id_anio}-${grupo.id_division}`}
            aria-label={`Buscar docente responsable para ${etiquetaCurso}`}
            placeholder=" "
            value={query}
            disabled={saving}
            onFocus={() => { setOpen(true); setQuery(""); }}
            onClick={() => { if (!open) { setOpen(true); setQuery(""); } }}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setOpen(false); setQuery(upper(nombre, 100)); inputRef.current?.blur(); }
              if (event.key === "Enter" && open && resultados.length === 1) {
                event.preventDefault();
                onElegir(resultados[0].id_docente, resultados[0].docente);
              }
            }}
          />
          <span className="module-floatingLabel">Buscar docente por nombre o DNI</span>
          </label>
          {nombre && <button type="button" disabled={saving} className="ventas-docente-responsable__clear" onClick={() => onElegir(null, "")} aria-label={`Quitar docente responsable de ${etiquetaCurso}`}><FontAwesomeIcon icon={faXmark} aria-hidden="true" /></button>}
          {panelOpen && open && !saving && listStyle && createPortal(
            <div ref={listRef} style={listStyle} className="ventas-docente-responsable__results ventas-docente-responsable__results--portal" >
              <div className="ventas-docente-responsable__resultsScroll" style={{ maxHeight: Math.max(0, listStyle.maxHeight - 12) }} id={`docentes-curso-${grupo.id_anio}-${grupo.id_division}`} role="listbox" aria-label={`Docentes disponibles para ${etiquetaCurso}`}>
              {resultados.map((docente) => (
                <button type="button" role="option" aria-selected={String(asignacion?.id_docente || "") === String(docente.id_docente)} key={docente.id_docente} onClick={() => onElegir(docente.id_docente, docente.docente)}>
                  <span className="ventas-docente-responsable__optionText"><strong>{upper(docente.docente, 100)}</strong><small>{docente.dni ? `DNI ${docente.dni}` : "SIN DNI"}</small></span>
                  {String(asignacion?.id_docente || "") === String(docente.id_docente) && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}
                </button>
              ))}
              {!resultados.length && <span className="ventas-docente-responsable__empty">No hay docentes activos con esa búsqueda.</span>}
              </div>
            </div>, document.body
          )}
        </div>
      ) : null}
    </div>
  );
}
