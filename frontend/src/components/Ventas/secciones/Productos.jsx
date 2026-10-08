import React, { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxesStacked, faPen, faRotateLeft, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import ProductoModal from "../modales/ProductoModal";
import { ActionButton } from "../VentasUI";
import { money, upper } from "../ventasUtils";

export default function Productos({ writable, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ pagina: 1, total_paginas: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("activos");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStateId, setChangingStateId] = useState(null);
  const [modal, setModal] = useState({ open: false, row: null });
  const [stateConfirm, setStateConfirm] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.productos({
        pagina: page,
        por_pagina: 20,
        buscar: search,
        activo: view === "activos" ? "1" : "0",
      });
      setRows(data.items || []);
      setPagination(data.paginacion || {});
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [page, search, view, showFeedback]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 30000);

  const changeView = (nextView) => {
    setView(nextView);
    setPage(1);
  };

  const save = async (payload) => {
    setSaving(true);
    try {
      const result = await ventasApi.guardarProducto(payload);
      setModal({ open: false, row: null });
      showFeedback("success", result.mensaje);
      if (!payload.id_producto) setView("activos");
      setPage(1);
      await load();
    } catch (err) { showFeedback("error", err.message); }
    finally { setSaving(false); }
  };

  const viewTabs = {
    key: "vista",
    type: "tabs",
    label: "Productos",
    value: view,
    onChange: changeView,
    options: [
      { value: "activos", label: "Activos" },
      { value: "bajas", label: "Dados de baja" },
    ],
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--products"
      title="Productos de ventas"
      filters={[
        viewTabs,
        {
          key: "buscar",
          type: "search",
          label: "Buscar",
          placeholder: "Nombre o descripción del producto...",
          value: search,
          onChange: (value) => { setPage(1); setSearch(value); },
        },
      ]}
      canCreate={view === "activos" && writable}
      primaryActionLabel="Nuevo producto"
      onPrimaryAction={() => setModal({ open: true, row: null })}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--products"
        columns={[
          "Producto",
          { label: "Anticipada", align: "right" },
          { label: "Puerta", align: "right" },
          { label: "Stock", align: "center" },
          "Objetivo vigente",
          "Uso",
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel={view === "activos" ? "Productos activos" : "Productos dados de baja"}
        empty={!rows.length}
      >
        {!loading && !rows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faBoxesStacked} />
            <strong>{view === "activos" ? "Sin productos activos" : "Sin productos dados de baja"}</strong>
            <span>{view === "activos" ? "Creá un producto nuevo o cambiá los filtros." : "No hay productos dados de baja para mostrar."}</span>
          </div>
        ) : null}

        {rows.map((row) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--products ${changingStateId === row.id_producto ? "is-changing" : ""}`.trim()}
            role="row"
            key={row.id_producto}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{upper(row.nombre, 150)}</strong>
              <small>{row.descripcion ? upper(row.descripcion, 3000) : "SIN DESCRIPCIÓN"}</small>
            </div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.precio_anticipada)}</div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.precio_puerta)}</div>
            <div className="mov-gridCell is-center">
              {row.stock == null ? (
                <span className="ventas-pill neutral">SIN CONTROL</span>
              ) : (
                <span className={`ventas-pill ${Number(row.stock) === 0 ? "danger" : "success"}`}>{row.stock}</span>
              )}
            </div>
            <div className="mov-gridCell entity-main-cell ventas-objective-cell">
              {row.configuracion_activa_nombre && Number(row.objetivo_cantidad_minima || 0) > 0 ? (
                <>
                  <strong>MÍN. {Number(row.objetivo_cantidad_minima)} UNIDADES</strong>
                  <small>{money(row.objetivo_ganancia_unidad)} / FALTANTE · {money(row.objetivo_ganancia_total)} SIN VENTAS</small>
                </>
              ) : row.configuracion_activa_nombre ? (
                <>
                  <strong>SIN OBJETIVO</strong>
                  <small>{upper(row.configuracion_activa_nombre, 150)}</small>
                </>
              ) : (
                <span className="ventas-pill neutral">SIN CONFIGURACIÓN ACTIVA</span>
              )}
            </div>
            <div className="mov-gridCell">{Number(row.cantidad_usos || 0)} ventas · {Number(row.cantidad_campanias || 0)} campañas</div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {writable ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, row })} />
                    <ActionButton
                      icon={view === "activos" ? faTrashCan : faRotateLeft}
                      title={view === "activos" ? "Dar de baja" : "Activar"}
                      tone={view === "activos" ? "danger" : ""}
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
        currentPage={Number(pagination.pagina || page)}
        totalPages={Number(pagination.total_paginas || 1)}
        totalRecords={Number(pagination.total || 0)}
        from={Number(pagination.desde || ((Number(pagination.pagina || page) - 1) * 20 + (rows.length ? 1 : 0)))}
        to={Number(pagination.hasta || Math.min(Number(pagination.total || 0), Number(pagination.pagina || page) * 20))}
        loading={loading}
        loadingLabel=""
        itemLabel="productos"
        ariaLabel="Paginación de productos"
        onPageChange={setPage}
        compactPageItems
        className="ventas-tableFooter"
      />

      <ProductoModal open={modal.open} initial={modal.row} saving={saving} onClose={() => setModal({ open: false, row: null })} onSave={save} />

      <ModalEliminarGlobal
        open={Boolean(stateConfirm)}
        row={stateConfirm}
        operacion="advertencia"
        showLoadingEffect={false}
        tone={view === "activos" ? "warning" : "success"}
        icon={view === "activos" ? faTrashCan : faRotateLeft}
        title={view === "activos" ? "Dar de baja producto" : "Activar producto"}
        message={view === "activos"
          ? "¿Confirmás que querés dar de baja este producto?"
          : "¿Confirmás que querés volver a activar este producto?"}
        warning={view === "activos"
          ? "Si este producto pertenece a la configuración activa de ventas, esa configuración también se dará de baja automáticamente."
          : "Reactivar el producto no reactiva ninguna configuración de venta: esa activación se realiza por separado."}
        confirmLabel={view === "activos" ? "Dar de baja" : "Activar producto"}
        loadingLabel={view === "activos" ? "Dando de baja..." : "Activando..."}
        details={stateConfirm ? [
          { label: "Producto", value: stateConfirm.nombre },
          { label: "Ventas asociadas", value: stateConfirm.cantidad_usos || 0 },
          { label: "Configuraciones", value: stateConfirm.cantidad_campanias || 0 },
        ] : []}
        onClose={() => setStateConfirm(null)}
        onConfirm={async () => {
          const target = stateConfirm;
          setChangingStateId(target.id_producto);
          try {
            const result = await ventasApi.estadoProducto({
              id_producto: target.id_producto,
              activo: view !== "activos",
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
