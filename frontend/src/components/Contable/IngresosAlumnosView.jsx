import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoneyBillTransfer } from "@fortawesome/free-solid-svg-icons";
import GlobalDivTable from "../Global/GlobalDivTable";
import GlobalPagination from "../Global/GlobalPagination";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
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
  const [headerActionsHost, setHeaderActionsHost] = useState(null);
  const items = data?.items || [];

  useEffect(() => {
    setHeaderActionsHost(
      document.querySelector(".contable-page .module-card__actions"),
    );
  }, []);
  const pagination = data?.paginacion || {};
  const filters = data?.filtros || {};
  const currentPage = Number(pagination.pagina || 1);
  const totalPages = Number(pagination.total_paginas || 0);
  const totalRecords = Number(pagination.total || 0);
  const dateLabel = filters?.etiqueta_fecha || "Mes de cobro seleccionado";

  const exportSections = useMemo(
    () => [
      {
        hoja: "Alumnos",
        titulo: "Ingresos de alumnos",
        columnas: [
          { label: "Alumno", key: "alumno" },
          { label: "Documento", key: "documento" },
          { label: "Fecha de cobro", key: "fecha" },
          { label: "Mes / concepto pagado", key: "periodo" },
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
    if (!filters?.anio_pago || !filters?.mes_pago) return exportSections;
    const records = [];
    const baseFilters = {
      anio: filters.anio_pago,
      mes: filters.mes_pago,
      periodo: filters.periodo || "",
      medio: filters.id_medio_pago || "",
      buscar: search,
    };
    const first = await contableApi.ingresosAlumnos({ ...baseFilters, pagina: 1 });
    records.push(...(first?.items || []));
    const pages = Number(first?.paginacion?.total_paginas || 1);
    for (let page = 2; page <= pages; page += 1) {
      const response = await contableApi.ingresosAlumnos({ ...baseFilters, pagina: page });
      records.push(...(response?.items || []));
    }
    return [{ ...exportSections[0], registros: records }];
  }, [exportSections, filters?.anio_pago, filters?.mes_pago, filters?.periodo, filters?.id_medio_pago, search]);

  return (
    <section className="ct-student-income contable-table">
      {headerActionsHost
        ? createPortal(
            <BotonExportarGlobal
              label="Exportar"
              className="contable-export-top ct-student-export-top"
              onClick={() => setExportOpen(true)}
              disabled={loading || totalRecords <= 0}
            />,
            headerActionsHost,
          )
        : null}

      <GlobalDivTable
        className="ct-student-table contable-table__data has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-student-grid"
        columns={[
          "Alumno",
          { label: "Fecha de cobro", align: "center" },
          { label: "Mes / concepto pagado", align: "center" },
          { label: "Categoría", align: "center" },
          { label: "Medio", align: "center" },
          { label: "Monto", align: "right" },
        ]}
        loading={loading}
        loadingLabel="Cargando cobros de alumnos..."
        skeletonActionColumn={false}
        ariaLabel="Ingresos de alumnos"
        empty={!items.length}
      >
        {!items.length && !loading ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faMoneyBillTransfer} />
            <strong>Sin cobros para mostrar</strong>
            <span>No hay cobros registrados en el mes de pago seleccionado.</span>
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
            <div className="mov-gridCell is-center ct-student-period">
              <span className="mov-categoryChip">{item.periodo}</span>
              {item.es_ingresante ? <small>INGRESANTE</small> : null}
            </div>
            <div className="mov-gridCell is-center">{item.categoria || "—"}</div>
            <div className="mov-gridCell is-center">{item.medio || "—"}</div>
            <AmountCell item={item} />
          </div>
        ))}
      </GlobalDivTable>

      <GlobalPagination
        className="ct-student-pagination"
        currentPage={currentPage}
        totalPages={totalPages}
        totalRecords={totalRecords}
        from={Number(pagination.desde || 0)}
        to={Number(pagination.hasta || 0)}
        loading={loading}
        itemLabel="pagos"
        ariaLabel="Paginación de pagos de alumnos"
        onPageChange={onPageChange}
        showSummary={totalRecords > 0}
      />

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar ingresos de alumnos"
        tituloArchivo={`Ingresos de alumnos · ${dateLabel}`}
        subtituloArchivoActual={dateLabel}
        nombreArchivo={`ingresos_alumnos_${filters?.anio_pago || ""}_${filters?.mes_pago || ""}`}
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
