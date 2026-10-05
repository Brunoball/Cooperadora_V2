import React, { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoneyBillTransfer, faPeopleGroup } from "@fortawesome/free-solid-svg-icons";
import GlobalDivTable from "../Global/GlobalDivTable";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import SummaryCards from "../Global/SummaryCards";
import { contableApi } from "./api/contableApi";
import logoIpetPdf from "../../imagenes/logo_ipet50.png";
import "./IngresosAlumnosView.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateText = (value) => {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

function amountTone(value) {
  const type = String(value || "").toUpperCase();
  if (type === "DESCUENTO_FAMILIAR") return "is-family";
  if (type === "MONTO_PERSONALIZADO") return "is-custom";
  return "is-period";
}

function paginationItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const items = [1];
  if (currentPage > 4) items.push("ellipsis-left");
  const from = Math.max(2, currentPage - 1);
  const to = Math.min(totalPages - 1, currentPage + 1);
  for (let page = from; page <= to; page += 1) items.push(page);
  if (currentPage < totalPages - 3) items.push("ellipsis-right");
  items.push(totalPages);
  return items;
}

function AmountCell({ item }) {
  const label = String(item?.etiqueta_monto || "").trim();
  return (
    <div className="mov-gridCell is-right ct-student-money">
      <strong>{money(item?.monto)}</strong>
      {label ? (
        <small className={`ct-student-amount-tag ${amountTone(item?.ajuste_monto)}`}>
          {label}
        </small>
      ) : null}
    </div>
  );
}

export default function IngresosAlumnosView({
  data,
  loading,
  search,
  onPageChange,
  onFeedback,
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const items = data?.items || [];
  const summary = data?.resumen || {};
  const pagination = data?.paginacion || {};
  const period = data?.periodo || {};
  const currentPage = Number(pagination.pagina || 1);
  const totalPages = Number(pagination.total_paginas || 0);
  const totalRecords = Number(pagination.total || 0);

  const exportSections = useMemo(
    () => [
      {
        hoja: "Alumnos",
        titulo: "Ingresos de alumnos",
        columnas: [
          { label: "Alumno", key: "alumno" },
          { label: "Documento", key: "documento" },
          { label: "Fecha", key: "fecha" },
          { label: "Período", key: "periodo" },
          { label: "Categoría", key: "categoria" },
          { label: "Medio", key: "medio" },
          { label: "Monto", key: "monto" },
          { label: "Detalle del monto", key: "etiqueta_monto" },
        ],
        registros: items,
      },
    ],
    [items],
  );

  const obtainAllSections = useCallback(async () => {
    if (!period?.anio || !period?.id_periodo) return exportSections;
    const records = [];
    const first = await contableApi.ingresosAlumnos({
      anio: period.anio,
      periodo: period.id_periodo,
      buscar: search,
      pagina: 1,
    });
    records.push(...(first?.items || []));
    const pages = Number(first?.paginacion?.total_paginas || 1);
    for (let page = 2; page <= pages; page += 1) {
      const response = await contableApi.ingresosAlumnos({
        anio: period.anio,
        periodo: period.id_periodo,
        buscar: search,
        pagina: page,
      });
      records.push(...(response?.items || []));
    }
    return [{ ...exportSections[0], registros: records }];
  }, [exportSections, period?.anio, period?.id_periodo, search]);

  return (
    <section className="ct-student-income">
      <SummaryCards
        title=""
        ariaLabel="Resumen de ingresos de alumnos"
        variant="dashboard"
        className="ct-student-summary"
        items={[
          {
            key: "students",
            icon: faPeopleGroup,
            label: "Alumnos",
            detail: `${Number(summary.pagos || 0).toLocaleString("es-AR")} pagos registrados`,
            value: Number(summary.alumnos || 0).toLocaleString("es-AR"),
          },
          {
            key: "amount",
            icon: faMoneyBillTransfer,
            label: "Total cobrado",
            detail: period?.etiqueta || "Período seleccionado",
            tone: "success",
            value: money(summary.importe),
          },
        ]}
      />

      <GlobalDivTable
        className="ct-student-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-student-grid"
        columns={[
          "Alumno",
          { label: "Fecha", align: "center" },
          { label: "Período", align: "center" },
          { label: "Categoría", align: "center" },
          { label: "Medio", align: "center" },
          { label: "Monto", align: "right" },
        ]}
        loading={loading}
        loadingLabel="Cargando pagos de alumnos..."
        skeletonActionColumn={false}
        ariaLabel="Ingresos de alumnos"
        empty={!items.length}
      >
        {!items.length && !loading ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faMoneyBillTransfer} />
            <strong>Sin pagos para mostrar</strong>
            <span>No hay cobros de alumnos para el período seleccionado.</span>
          </div>
        ) : null}

        {items.map((item) => (
          <div
            className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-student-grid"
            role="row"
            key={item.id_pago}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{item.alumno}</strong>
              <small>DNI {item.documento || "—"}</small>
            </div>
            <div className="mov-gridCell is-center">{dateText(item.fecha)}</div>
            <div className="mov-gridCell is-center"><span className="mov-categoryChip">{item.periodo}</span></div>
            <div className="mov-gridCell is-center">{item.categoria || "—"}</div>
            <div className="mov-gridCell is-center">{item.medio || "—"}</div>
            <AmountCell item={item} />
          </div>
        ))}
      </GlobalDivTable>

      <footer className="global-pagination ct-student-pagination" aria-label="Paginación de pagos de alumnos">
        {totalRecords ? (
          <div className="ct-student-pagination__navigation">
            <p className="global-pagination__summary">
              Mostrando <b>{Number(pagination.desde || 0)}</b>–<b>{Number(pagination.hasta || 0)}</b> de <b>{totalRecords}</b> pagos
            </p>
            <div className="global-pagination__controls">
              <button type="button" disabled={loading || currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>Anterior</button>
              {paginationItems(currentPage, totalPages).map((item) =>
                typeof item === "number" ? (
                  <button
                    type="button"
                    key={item}
                    className={item === currentPage ? "is-active" : ""}
                    aria-current={item === currentPage ? "page" : undefined}
                    disabled={loading}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="global-pagination__ellipsis" key={item}>…</span>
                ),
              )}
              <button type="button" disabled={loading || currentPage >= totalPages} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}>Siguiente</button>
            </div>
          </div>
        ) : <span />}
        <div className="global-tableActions">
          <BotonExportarGlobal
            label="Exportar"
            className="mov-btn--compact"
            onClick={() => setExportOpen(true)}
            disabled={loading || totalRecords <= 0}
          />
        </div>
      </footer>

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar ingresos de alumnos"
        tituloArchivo={`Ingresos de alumnos · ${period?.etiqueta || ""}`}
        subtituloArchivoActual={period?.etiqueta || ""}
        nombreArchivo={`ingresos_alumnos_${period?.anio || ""}_${period?.id_periodo || ""}`}
        logoPdfUrl={logoIpetPdf}
        seccionesActuales={exportSections}
        obtenerSeccionesTodos={obtainAllSections}
        cantidadActual={items.length}
        cantidadTodos={totalRecords}
        mostrarAlcanceTodos={totalRecords > items.length}
        alcanceActualLabel="Exportar esta página"
        alcanceTodosLabel="Exportar todos"
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => onFeedback?.({ type: "success", message })}
        onError={(message) => onFeedback?.({ type: "error", message })}
      />
    </section>
  );
}
