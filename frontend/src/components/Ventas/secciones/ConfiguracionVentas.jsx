import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faClipboardList, faCommentDots, faPen, faPowerOff, faArchive, faCopy } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import ConfiguracionVentaModal from "../modales/ConfiguracionVentaModal";
import { ActionButton } from "../VentasUI";
import { campaniaOpcion, money, ordenarCampanias, upper, yes, today } from "../ventasUtils";
import { precioUnitarioVenta } from "../ventaMensajes";

/** Un solo espacio de trabajo; el historial se consulta en Registradas/Planillas. */
export default function ConfiguracionVentas({ writable, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStateId, setChangingStateId] = useState(null);
  const [modal, setModal] = useState({ open: false, row: null });
  const [stateConfirm, setStateConfirm] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [campaignsData, catalogs] = await Promise.all([ventasApi.campanias(), ventasApi.catalogos()]);
      setRows(campaignsData.items || []);
      setProducts(catalogs.productos || []);
    } catch (error) { showFeedback("error", error.message); }
    finally { if (!silent) setLoading(false); }
  }, [showFeedback]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 30000);

  const openRows = useMemo(() => ordenarCampanias(rows.filter((row) => row.estado_cierre !== "cerrada")), [rows]);
  const save = async (payload) => {
    setSaving(true);
    try {
      const result = await ventasApi.guardarCampania(payload);
      setModal({ open: false, row: null });
      showFeedback("success", result.mensaje);
      await load({ silent: true });
    } catch (error) { showFeedback("error", error.message); }
    finally { setSaving(false); }
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--campaigns"
      title="Configuración de ventas"
      description="Administrá las ventas vigentes y programadas. Las cerradas quedan disponibles en Ventas registradas y Planillas."
      canCreate={writable}
      primaryActionLabel="Nueva venta"
      onPrimaryAction={() => setModal({ open: true, row: null })}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--campaigns"
        columns={[
          "Venta", "Producto principal", "Objetivo por persona",
          { label: "Fechas", align: "center", className: "ventas-validity-head" },
          { label: "WhatsApp", align: "center" },
          { label: "Registros", align: "center" },
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel="Ventas vigentes, programadas y pausadas"
        empty={!openRows.length}
      >
        {!loading && !openRows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faClipboardList} />
            <strong>No hay ventas pendientes de cierre</strong>
            <span>Creá una nueva venta o copiá la configuración de una venta anterior.</span>
          </div>
        ) : null}
        {openRows.map((row) => (
          <div className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--campaigns ventas-campaign-row ${changingStateId === row.id_campania ? "is-changing" : ""}`.trim()} role="row" key={row.id_campania}>
            <div className="mov-gridCell entity-main-cell">
              <strong>{upper(row.nombre, 150)}</strong>
              <small>{row.etapa === "finalizada" ? "FINALIZADA · CIERRE PENDIENTE" : !yes(row.activo) ? "PAUSADA" : row.etapa === "programada" ? "PROGRAMADA" : "EN CURSO"}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong>{upper(row.producto_principal_nombre || "SIN PRODUCTO", 150)}</strong>
              {row.precio_anticipada != null ? <small>{Number(precioUnitarioVenta(row)) === Number(row.precio_puerta) ? `PRECIO ÚNICO ${money(precioUnitarioVenta(row))}` : `PRINCIPAL ${money(precioUnitarioVenta(row))} · ALTERNATIVO ${money(row.precio_puerta)}`}</small> : null}
            </div>
            <div className="mov-gridCell entity-main-cell ventas-objective-cell">
              {Number(row.cantidad_minima_persona || 0) ? <>
                <strong>MÍN. {Number(row.cantidad_minima_persona)} UNIDADES</strong>
                <small>{money(row.ganancia_unidad_faltante)} / FALTANTE · {money(row.ganancia_total_sin_ventas)} SIN VENTAS</small>
              </> : <strong>SIN OBJETIVO</strong>}
            </div>
            <div className="mov-gridCell is-center entity-main-cell ventas-validity-cell">
              <strong>{row.fecha_inicio || "SIN FECHA"} AL {row.fecha_fin || "SIN FECHA"}</strong>
              <small>ENTREGA: {row.fecha_entrega || "SIN DEFINIR"} · {(() => { try { const h = JSON.parse(row.horarios_entrega || "[]"); return h.length ? h.map((r) => `${r.desde}-${r.hasta}`).join(" / ") : "SIN HORARIOS"; } catch { return "SIN HORARIOS"; } })()}</small>
            </div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${yes(row.disponible_bot) ? "whatsapp" : "neutral"}`}>
                <FontAwesomeIcon icon={faCommentDots} /> {yes(row.disponible_bot) ? "VISIBLE" : "NO DISPONIBLE"}
              </span>
            </div>
            <div className="mov-gridCell is-center is-strong">{Number(row.cantidad_ordenes || 0)}</div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {writable && <>
                  <ActionButton icon={faPen} title="Editar venta" onClick={() => setModal({ open: true, row })} />
                  <ActionButton icon={faCopy} title="Repetir esta venta con otras fechas" onClick={() => setModal({ open: true, row: { ...row, id_campania: "", fecha_inicio: "", fecha_fin: "", fecha_entrega: "", horarios_entrega: [], activo: 1, visible_menu: 1 } })} />
                  <ActionButton icon={faArchive} title="Cerrar y enviar al historial" disabled={Boolean(row.fecha_fin && row.fecha_fin >= today())} onClick={() => setCloseConfirm(row)} />
                  <ActionButton icon={yes(row.activo) ? faPowerOff : faCheckCircle} title={yes(row.activo) ? "Pausar" : "Reactivar"} tone={yes(row.activo) ? "danger" : ""} disabled={changingStateId !== null} onClick={() => setStateConfirm(row)} />
                </>}
              </div>
            </div>
          </div>
        ))}
      </GlobalDivTable>
      <GlobalPagination currentPage={1} totalPages={openRows.length ? 1 : 0} totalRecords={openRows.length} from={openRows.length ? 1 : 0} to={openRows.length} loading={loading} loadingLabel="" itemLabel="ventas" ariaLabel="Configuración de ventas" className="ventas-tableFooter" showControls={false} showWhenEmpty />

      <ConfiguracionVentaModal
        open={modal.open} initial={modal.row} products={products} campaigns={rows}
        saving={saving} onClose={() => setModal({ open: false, row: null })} onSave={save} onFeedback={showFeedback}
      />
      <ModalEliminarGlobal
        open={Boolean(stateConfirm)} row={stateConfirm} operacion="advertencia" showLoadingEffect={false}
        tone={yes(stateConfirm?.activo) ? "warning" : "success"}
        icon={yes(stateConfirm?.activo) ? faPowerOff : faCheckCircle}
        title={yes(stateConfirm?.activo) ? "Pausar venta" : "Reactivar venta"}
        message={yes(stateConfirm?.activo) ? "¿Querés pausar temporalmente esta venta?" : "¿Querés volver a habilitar esta venta?"}
        warning="No se modifica ni se elimina ningún registro existente."
        confirmLabel={yes(stateConfirm?.activo) ? "Pausar" : "Reactivar"}
        details={stateConfirm ? [{ label: "Venta", value: campaniaOpcion(stateConfirm) }] : []}
        onClose={() => setStateConfirm(null)}
        onConfirm={async () => {
          const target = stateConfirm;
          setChangingStateId(target.id_campania);
          try {
            const result = await ventasApi.estadoCampania({ id_campania: target.id_campania, activo: !yes(target.activo) });
            setStateConfirm(null);
            await load({ silent: true });
            return { mensaje: result.mensaje };
          } finally { setChangingStateId(null); }
        }}
      />
      <ModalEliminarGlobal
        open={Boolean(closeConfirm)} row={closeConfirm} operacion="advertencia" showLoadingEffect={false}
        tone="warning" icon={faArchive}
        title="Cerrar venta y conservar historial"
        message="El cierre es definitivo: antes de confirmar, registrá las liquidaciones finales de ganancias que ya se hayan cobrado. Al cerrar no se podrán cargar nuevos cobros de esta campaña; los registros y las planillas quedan en el historial."
        warning={`Cobros pendientes: ${closeConfirm?.cobros_pendientes || 0}. Retiros pendientes: ${closeConfirm?.retiros_pendientes || 0}. Revisalos antes de confirmar.`}
        confirmLabel="Cerrar definitivamente"
        details={closeConfirm ? [
          { label: "Venta", value: campaniaOpcion(closeConfirm) },
          { label: "Vigencia", value: `${closeConfirm.fecha_inicio || "—"} al ${closeConfirm.fecha_fin || "—"}` },
          { label: "Entrega", value: closeConfirm.fecha_entrega || "SIN DEFINIR" },
          { label: "Órdenes", value: closeConfirm.cantidad_ordenes || 0 },
        ] : []}
        onClose={() => setCloseConfirm(null)}
        onConfirm={async () => {
          const id = closeConfirm.id_campania;
          const result = await ventasApi.cerrarCampania({ id_campania: id });
          setCloseConfirm(null);
          await load({ silent: true });
          return { mensaje: result.mensaje };
        }}
      />
    </ModulePage>
  );
}
