// src/components/BotPanel/modales/EditEtiquetaModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import ConfirmActionModal from "./ConfirmActionModal";
import "./EditEtiquetaModal.css";

const normalizarNombreEtiqueta = (valor = "") =>
  String(valor || "").toLocaleUpperCase("es-AR");

const EditEtiquetaModal = ({
  open,
  waId,
  currentEtiquetaId,
  currentEtiquetaNombre,
  etiquetas,
  loading,
  error,
  onClose,
  onSave,

  // Base url de puntos para crear/editar/eliminar etiquetas.
  puntosBaseUrl,
  onRefreshEtiquetas,
  onLabelsChanged,
}) => {
  const cancelRef = useRef(null);

  useModalEscapeStack(open, onClose);

  const [selectedId, setSelectedId] = useState("");

  const [nuevoNombre, setNuevoNombre] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editingNombre, setEditingNombre] = useState("");
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState("");

  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState("");
  const [pendingDeleteEtiqueta, setPendingDeleteEtiqueta] = useState(null);

  useEffect(() => {
    if (!open) return;

    setSelectedId(currentEtiquetaId ? String(currentEtiquetaId) : "");
    setNuevoNombre("");
    setCreateErr("");
    setEditingId(null);
    setEditingNombre("");
    setEditErr("");
    setDeletingId(null);
    setDeleteErr("");
    setPendingDeleteEtiqueta(null);

    setTimeout(() => cancelRef.current?.focus(), 30);
  }, [open, currentEtiquetaId]);

  const etiquetaOptions = useMemo(() => {
    const arr = Array.isArray(etiquetas) ? etiquetas : [];
    return [...arr].sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));
  }, [etiquetas]);

  if (!open) return null;

  const busy = loading || creating || editing || deletingId !== null;

  const postJSON = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  };

  const refreshLabels = async () => {
    if (onLabelsChanged) {
      await onLabelsChanged();
      return;
    }
    await onRefreshEtiquetas?.();
  };

  const doSave = () => {
    onSave?.(waId, selectedId === "" ? null : Number(selectedId));
  };

  const onKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const tag = String(e.target?.tagName || "").toLowerCase();
    if (tag === "input") return;
    e.preventDefault();
    doSave();
  };

  const createEtiqueta = async () => {
    const nombre = normalizarNombreEtiqueta(nuevoNombre).trim();
    if (!nombre) return;

    if (!puntosBaseUrl) {
      setCreateErr("Falta puntosBaseUrl (PANEL_PUNTOS) en el modal");
      return;
    }

    setCreating(true);
    setCreateErr("");

    try {
      const { res, data } = await postJSON(`${puntosBaseUrl}/etiquetas_create.php`, { nombre });

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      const newId = data?.id_etiqueta;
      if (!newId) throw new Error("No se recibió id_etiqueta");

      await refreshLabels();
      setSelectedId(String(newId));
      setNuevoNombre("");
    } catch (e) {
      setCreateErr(e?.message || "No se pudo crear la etiqueta");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (et) => {
    setEditingId(Number(et.id_etiqueta));
    setEditingNombre(normalizarNombreEtiqueta(et.nombre || ""));
    setEditErr("");
    setDeleteErr("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingNombre("");
    setEditErr("");
  };

  const updateEtiqueta = async (id) => {
    const nombre = normalizarNombreEtiqueta(editingNombre).trim();
    if (!nombre) {
      setEditErr("La etiqueta no puede quedar vacía");
      return;
    }

    if (!puntosBaseUrl) {
      setEditErr("Falta puntosBaseUrl (PANEL_PUNTOS) en el modal");
      return;
    }

    setEditing(true);
    setEditErr("");

    try {
      const { res, data } = await postJSON(`${puntosBaseUrl}/etiquetas_update.php`, {
        id_etiqueta: Number(id),
        nombre,
      });

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      await refreshLabels();
      setEditingId(null);
      setEditingNombre("");
    } catch (e) {
      setEditErr(e?.message || "No se pudo editar la etiqueta");
    } finally {
      setEditing(false);
    }
  };

  const pedirEliminarEtiqueta = (id, nombre = "") => {
    setDeleteErr("");
    setEditErr("");
    setPendingDeleteEtiqueta({
      id: Number(id),
      nombre: normalizarNombreEtiqueta(nombre || "").trim(),
    });
  };

  const cerrarConfirmacionEliminar = () => {
    if (deletingId !== null) return;
    setPendingDeleteEtiqueta(null);
  };

  const confirmarEliminarEtiqueta = async () => {
    const id = Number(pendingDeleteEtiqueta?.id || 0);

    if (!puntosBaseUrl) {
      setDeleteErr("Falta puntosBaseUrl (PANEL_PUNTOS) en el modal");
      setPendingDeleteEtiqueta(null);
      return;
    }

    if (id <= 0) {
      setDeleteErr("No se pudo identificar la etiqueta a eliminar");
      setPendingDeleteEtiqueta(null);
      return;
    }

    setDeletingId(id);
    setDeleteErr("");
    setEditErr("");

    try {
      const { res, data } = await postJSON(`${puntosBaseUrl}/etiquetas_delete.php`, {
        id_etiqueta: id,
      });

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      if (String(selectedId) === String(id)) setSelectedId("");
      if (Number(editingId || 0) === id) cancelEdit();
      setPendingDeleteEtiqueta(null);
      await refreshLabels();
    } catch (e) {
      setDeleteErr(e?.message || "No se pudo eliminar la etiqueta");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
    <div
      className="bp-tag-overlay"
      role="dialog"
      aria-modal="true"
      onKeyDown={onKeyDown}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target?.classList?.contains("bp-tag-overlay")) onClose?.();
      }}
    >
      <div className="bp-tag-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bp-tag-head">
          <div className="bp-tag-heading">
            <span className="bp-tag-eyebrow">Organización</span>
            <div className="bp-tag-title">Cambiar etiqueta</div>
            <p className="bp-tag-subtitle">Clasificá el contacto, creá etiquetas, editalas o eliminalas.</p>
          </div>

          <button
            type="button"
            className="bp-tag-close"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="bp-tag-body">
          <div className="bp-tag-contact">
            <div className="bp-tag-detail">
              <span>Contacto</span>
              <b>{waId}</b>
            </div>
            <div className="bp-tag-detail">
              <span>Etiqueta actual</span>
              <b>{currentEtiquetaNombre || "Sin etiqueta"}</b>
            </div>
          </div>

          <div className="bp-tag-form">
            <label className="bp-tag-label" htmlFor="bp-tag-select">Etiqueta asignada</label>

            <select
              id="bp-tag-select"
              className="bp-tag-input"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={busy}
            >
              <option value="">Sin etiqueta</option>

              {etiquetaOptions.map((et) => (
                <option key={et.id_etiqueta} value={String(et.id_etiqueta)}>
                  {et.nombre}
                </option>
              ))}
            </select>

            <div className="bp-tag-create">
              <div className="bp-tag-create-head">
                <div className="bp-tag-label bp-tag-label--create">Nueva etiqueta</div>
                <p>Agregala a la lista y quedará seleccionada automáticamente.</p>
              </div>

              <input
                className="bp-tag-input"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(normalizarNombreEtiqueta(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createEtiqueta();
                  }
                }}
                placeholder="Ej: Pagó / Urgente / Nuevo..."
                disabled={busy}
              />

              <div className="bp-tag-actions bp-tag-actions--create">
                <button
                  type="button"
                  className="bp-tag-btn"
                  onClick={createEtiqueta}
                  disabled={busy || !nuevoNombre.trim()}
                  title="Crear etiqueta"
                >
                  {creating ? "Agregando…" : "Agregar"}
                </button>
              </div>

              {createErr ? <div className="bp-tag-error">{createErr}</div> : null}
            </div>

            <div className="bp-tag-manage">
              <div className="bp-tag-create-head">
                <div className="bp-tag-label bp-tag-label--create">Etiquetas actuales</div>
                <p>Podés cambiarles el nombre o eliminarlas. Al eliminar una etiqueta, los chats quedan sin etiqueta.</p>
              </div>

              {etiquetaOptions.length === 0 ? (
                <div className="bp-tag-empty">Todavía no hay etiquetas creadas.</div>
              ) : (
                <div className="bp-tag-list">
                  {etiquetaOptions.map((et) => {
                    const id = Number(et.id_etiqueta || 0);
                    const isEditing = Number(editingId || 0) === id;
                    const isDeleting = Number(deletingId || 0) === id;

                    return (
                      <div className="bp-tag-row" key={id}>
                        {isEditing ? (
                          <div className="bp-tag-edit-row">
                            <input
                              className="bp-tag-input bp-tag-input--compact"
                              value={editingNombre}
                              onChange={(e) => setEditingNombre(normalizarNombreEtiqueta(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  updateEtiqueta(id);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                              autoFocus
                              disabled={busy && !editing}
                            />
                            <button
                              type="button"
                              className="bp-tag-mini-btn bp-tag-mini-btn--ok"
                              onClick={() => updateEtiqueta(id)}
                              disabled={busy || !editingNombre.trim()}
                            >
                              {editing ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              className="bp-tag-mini-btn"
                              onClick={cancelEdit}
                              disabled={busy}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="bp-tag-row-name">
                              <span className="bp-tag-dot" style={{ background: et.color || "#25d366" }} />
                              <b>{et.nombre}</b>
                            </div>
                            <div className="bp-tag-row-actions">
                              <button
                                type="button"
                                className="bp-tag-mini-btn"
                                onClick={() => startEdit(et)}
                                disabled={busy}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="bp-tag-mini-btn bp-tag-mini-btn--danger"
                                onClick={() => pedirEliminarEtiqueta(id, et.nombre)}
                                disabled={busy}
                              >
                                {isDeleting ? "Eliminando…" : "Eliminar"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {editErr ? <div className="bp-tag-error">{editErr}</div> : null}
              {deleteErr ? <div className="bp-tag-error">{deleteErr}</div> : null}
            </div>

            {error ? <div className="bp-tag-error">{error}</div> : null}

            <div className="bp-tag-actions">
              <button
                ref={cancelRef}
                type="button"
                className="bp-tag-btn bp-tag-btn--ghost"
                onClick={onClose}
                disabled={busy}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="bp-tag-btn bp-tag-btn--primary"
                onClick={doSave}
                disabled={busy}
              >
                {loading ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmActionModal
      open={!!pendingDeleteEtiqueta}
      title="Eliminar etiqueta"
      description={
        <>
          Vas a eliminar la etiqueta
          {pendingDeleteEtiqueta?.nombre ? <b> {pendingDeleteEtiqueta.nombre}</b> : null}.
          <br />
          Los contactos que la tengan quedarán como <b>sin etiqueta</b>.
        </>
      }
      confirmText="Eliminar"
      cancelText="Cancelar"
      danger
      loading={deletingId !== null}
      error={deleteErr}
      onClose={cerrarConfirmacionEliminar}
      onConfirm={confirmarEliminarEtiqueta}
    />
    </>
  );
};

export default EditEtiquetaModal;
