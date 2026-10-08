import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faClipboardList, faCommentDots, faPen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import ConfiguracionVentaModal from "../modales/ConfiguracionVentaModal";
import { ActionButton } from "../VentasUI";
import { money, upper, yes } from "../ventasUtils";

export default function ConfiguracionVentas({ writable, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [view, setView] = useState("activas");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStateId, setChangingStateId] = useState(null);
  const [modal, setModal] = useState({ open: false, row: null });
  const [stateConfirm, setStateConfirm] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [campaignsData, catalogs] = await Promise.all([ventasApi.campanias(), ventasApi.catalogos()]);
      setRows(campaignsData.items || []);
      setProducts(catalogs.productos || []);
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [showFeedback]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 30000);

  const save = async (payload) => {
    setSaving(true);
    try {
      const isNew = !payload.id_campania;
      const result = await ventasApi.guardarCampania(payload);
      setModal({ open: false, row: null });
      showFeedback("success", result.mensaje);
      if (isNew) setView("activas");
      await load();
    } catch (err) { showFeedback("error", err.message); }
    finally { setSaving(false); }
  };

  const filteredRows = useMemo(
    () => rows.filter((row) => view === "activas" ? yes(row.activo) : !yes(row.activo)),
    [rows, view],
  );

  const viewTabs = {
    key: "vista",
    type: "tabs",
    label: "Configuración",
    value: view,
    onChange: setView,
    options: [
      { value: "activas", label: "Activas", count: rows.filter((row) => yes(row.activo)).length },
      { value: "bajas", label: "Dadas de baja", count: rows.filter((row) => !yes(row.activo)).length },
    ],
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--campaigns"
      title="Configuración de ventas"
      filters={[viewTabs]}
      canCreate={view === "activas" && writable}
      primaryActionLabel="Nueva configuración"
      onPrimaryAction={() => setModal({ open: true, row: null })}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--campaigns"
        columns={[
          "Venta / campaña",
          "Producto principal",
          "Objetivo por persona",
          { label: "Vigencia", align: "center" },
          { label: "WhatsApp", align: "center" },
          { label: "Ventas", align: "center" },
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel={view === "activas" ? "Configuraciones activas de ventas" : "Configuraciones de ventas dadas de baja"}
        empty={!filteredRows.length}
      >
        {!loading && !filteredRows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faClipboardList} />
            <strong>{view === "activas" ? "Sin configuración activa" : "Sin configuraciones dadas de baja"}</strong>
            <span>{view === "activas"
              ? "Solo puede haber una configuración activa al mismo tiempo."
              : "Las configuraciones nuevas o desactivadas aparecerán acá."}</span>
          </div>
        ) : null}

        {filteredRows.map((row) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--campaigns ventas-campaign-row ${changingStateId === row.id_campania ? "is-changing" : ""}`.trim()}
            role="row"
            key={row.id_campania}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{upper(row.nombre, 150)}</strong>
              <small>{row.pregunta_persona || "Sin mensaje de identificación"}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.producto_principal_nombre ? upper(row.producto_principal_nombre, 150) : "—"}</strong>
              {row.precio_anticipada != null ? <small>ANT. {money(row.precio_anticipada)} · PUERTA {money(row.precio_puerta)}</small> : null}
            </div>
            <div className="mov-gridCell entity-main-cell ventas-objective-cell">
              {Number(row.cantidad_minima_persona || 0) > 0 ? (
                <>
                  <strong>MÍN. {Number(row.cantidad_minima_persona)} UNIDADES</strong>
                  <small>
                    {money(row.ganancia_unidad_faltante)} / FALTANTE · {money(row.ganancia_total_sin_ventas)} SIN VENTAS
                  </small>
                </>
              ) : (
                <>
                  <strong>SIN OBJETIVO</strong>
                  <small>NO GENERA GANANCIA POR FALTANTES</small>
                </>
              )}
            </div>
            <div className="mov-gridCell is-center entity-main-cell">
              <strong>{row.fecha_inicio || "SIN INICIO"}</strong>
              <small>HASTA {row.fecha_fin || "SIN FIN"}</small>
            </div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${yes(row.disponible_bot) ? "whatsapp" : "neutral"}`}>
                <FontAwesomeIcon icon={faCommentDots} /> {
                  !yes(row.activo)
                    ? "NO DISPONIBLE"
                    : yes(row.disponible_bot)
                      ? "DISPONIBLE"
                      : yes(row.visible_menu)
                        ? "FUERA DE VIGENCIA"
                        : "OCULTA"
                }
              </span>
            </div>
            <div className="mov-gridCell is-center is-strong">{Number(row.cantidad_ordenes || 0)}</div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {writable ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, row })} />
                    <ActionButton
                      icon={view === "activas" ? faTrashCan : faCheckCircle}
                      title={view === "activas" ? "Dar de baja" : "Activar"}
                      tone={view === "activas" ? "danger" : ""}
                      disabled={changingStateId !== null}
                      onClick={() => setStateConfirm(row)}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </GlobalDivTable>

      <GlobalPagination
        currentPage={1}
        totalPages={filteredRows.length ? 1 : 0}
        totalRecords={filteredRows.length}
        from={filteredRows.length ? 1 : 0}
        to={filteredRows.length}
        loading={loading}
        loadingLabel=""
        itemLabel="configuraciones"
        ariaLabel="Configuración de ventas"
        className="ventas-tableFooter"
        showControls={false}
        showWhenEmpty
      />

      <ConfiguracionVentaModal open={modal.open} initial={modal.row} products={products} saving={saving} onClose={() => setModal({ open: false, row: null })} onSave={save} />

      <ModalEliminarGlobal
        open={Boolean(stateConfirm)}
        row={stateConfirm}
        operacion="advertencia"
        showLoadingEffect={false}
        tone={view === "activas" ? "warning" : "success"}
        icon={view === "activas" ? faTrashCan : faCheckCircle}
        title={view === "activas" ? "Dar de baja configuración" : "Activar configuración"}
        message={view === "activas"
          ? "¿Confirmás que querés dar de baja esta configuración de venta?"
          : "¿Confirmás que querés activar esta configuración de venta?"}
        warning={view === "activas"
          ? "Dejará de estar disponible para nuevas ventas y para el bot hasta que vuelva a activarse."
          : "Solo puede existir una configuración activa. Al confirmar, cualquier otra configuración activa se dará de baja automáticamente."}
        confirmLabel={view === "activas" ? "Dar de baja" : "Activar configuración"}
        loadingLabel={view === "activas" ? "Dando de baja..." : "Activando..."}
        details={stateConfirm ? [
          { label: "Configuración", value: stateConfirm.nombre },
          { label: "Producto principal", value: stateConfirm.producto_principal_nombre || "SIN PRODUCTO" },
          {
            label: "Objetivo por persona",
            value: Number(stateConfirm.cantidad_minima_persona || 0) > 0
              ? `MÍN. ${Number(stateConfirm.cantidad_minima_persona)} · ${money(stateConfirm.ganancia_unidad_faltante)} POR FALTANTE · ${money(stateConfirm.ganancia_total_sin_ventas)} SIN VENTAS`
              : "SIN OBJETIVO",
          },
          { label: "Ventas asociadas", value: stateConfirm.cantidad_ordenes || 0 },
        ] : []}
        onClose={() => setStateConfirm(null)}
        onConfirm={async () => {
          const target = stateConfirm;
          setChangingStateId(target.id_campania);
          try {
            const result = await ventasApi.estadoCampania({
              id_campania: target.id_campania,
              activo: view !== "activas",
            });
            setStateConfirm(null);
            await load();
            return { mensaje: result.mensaje };
          } finally {
            setChangingStateId(null);
          }
        }}
      />

      {feedback}
    </ModulePage>
  );
}
