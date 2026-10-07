import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faCheck, faPen, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import { ingresantesApi } from "../api/alumnosApi";
import "./Ingresantes.css";

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function suggestedCycle() {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function emptyForm(defaultAmount = 0) {
  return {
    id_ingresante: "",
    apellido: "",
    nombre: "",
    num_documento: "",
    id_anio_destino: "1",
    ciclo_lectivo: String(suggestedCycle()),
    fecha_inscripcion: localToday(),
    matricula_pagada: true,
    monto_matricula: defaultAmount ? String(defaultAmount) : "",
    id_medio_pago: "",
    fecha_pago_matricula: localToday(),
    observaciones: "",
  };
}

function formFromItem(item) {
  return {
    id_ingresante: String(item.id_ingresante || ""),
    apellido: item.apellido || "",
    nombre: item.nombre || "",
    num_documento: item.num_documento || "",
    id_anio_destino: String(item.id_anio_destino || "1"),
    ciclo_lectivo: String(item.ciclo_lectivo || suggestedCycle()),
    fecha_inscripcion: item.fecha_inscripcion || localToday(),
    matricula_pagada: Boolean(item.matricula_pagada),
    monto_matricula: item.monto_matricula != null ? String(item.monto_matricula) : "",
    id_medio_pago: item.id_medio_pago ? String(item.id_medio_pago) : "",
    fecha_pago_matricula: item.fecha_pago_matricula || item.fecha_inscripcion || localToday(),
    observaciones: item.observaciones || "",
  };
}

const EMPTY_PAGINATION = { pagina: 1, total: 0, total_paginas: 0, desde: 0, hasta: 0 };

export default function Ingresantes() {
  const writable = canWrite();
  const [items, setItems] = useState([]);
  const [resumen, setResumen] = useState({});
  const [catalogos, setCatalogos] = useState({});
  const [paginacion, setPaginacion] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [search, setSearch] = useState("");
  const [cycle, setCycle] = useState(String(suggestedCycle()));
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("PENDIENTE");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [paymentLocked, setPaymentLocked] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const filters = useMemo(() => ({
    buscar: search,
    ciclo_lectivo: cycle,
    id_anio_destino: year,
    estado: status,
    pagina: page,
    por_pagina: 50,
  }), [search, cycle, year, status, page]);

  const cargar = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await ingresantesApi.listar(filters);
      setItems(response.items || []);
      setResumen(response.resumen || {});
      setCatalogos(response.catalogos || {});
      setPaginacion(response.paginacion || EMPTY_PAGINATION);
    } catch (requestError) {
      setError(requestError.message || "No se pudieron cargar los ingresantes.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { cargar(); }, [cargar]);

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
    setSelectedIds([]);
  };

  const openCreate = () => {
    const next = emptyForm(catalogos.monto_matricula_actual || 0);
    next.ciclo_lectivo = cycle || String(suggestedCycle());
    setForm(next);
    setPaymentLocked(false);
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm(formFromItem(item));
    setPaymentLocked(Boolean(item.matricula_pagada));
    setModalOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await ingresantesApi.guardar({
        ...form,
        num_documento: String(form.num_documento || "").replace(/\D+/g, ""),
        matricula_pagada: Boolean(form.matricula_pagada),
        monto_matricula: form.matricula_pagada ? form.monto_matricula : null,
        id_medio_pago: form.matricula_pagada ? form.id_medio_pago : null,
        fecha_pago_matricula: form.matricula_pagada ? form.fecha_pago_matricula : null,
      });
      setModalOpen(false);
      setFeedback({
        type: "success",
        message: form.id_ingresante ? "Ingresante actualizado correctamente." : "Ingresante creado correctamente.",
      });
      await cargar({ silent: true });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo guardar el ingresante." });
    } finally {
      setSaving(false);
    }
  };

  const changeState = async (item, target) => {
    try {
      const response = await ingresantesApi.cambiarEstado({ id: item.id_ingresante, estado: target });
      setFeedback({
        type: "success",
        message: response?.mensaje || (target === "CANCELADO" ? "Ingresante cancelado." : "Ingresante vuelto a pendiente."),
      });
      setSelectedIds((current) => current.filter((id) => id !== Number(item.id_ingresante)));
      await cargar({ silent: true });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo actualizar el ingresante." });
    }
  };

  const passToStudents = async () => {
    setProcessingBulk(true);
    try {
      const response = await ingresantesApi.pasarAlumnos({ ciclo_lectivo: cycle, ids_ingresantes: selectedIds });
      setBulkModalOpen(false);
      setSelectedIds([]);
      setFeedback({ type: "success", message: response?.mensaje || "Los ingresantes seleccionados se pasaron a Alumnos correctamente." });
      await cargar({ silent: true });
      return response;
    } catch (requestError) {
      return { ok: false, mensaje: requestError.message || "No se pudieron pasar los ingresantes seleccionados a Alumnos." };
    } finally {
      setProcessingBulk(false);
    }
  };

  const selectedCount = selectedIds.length;
  const currentYear = new Date().getFullYear();
  const cycleCanActivate = Number(cycle) <= currentYear;

  const toggleSelected = (item) => {
    const id = Number(item.id_ingresante);
    if (!id || item.estado !== "PENDIENTE" || item.id_alumno_confirmado) return;
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const pageFilters = [
    {
      key: "estado",
      type: "tabs",
      label: "Situación",
      value: status,
      onChange: changeFilter(setStatus),
      options: [
        { value: "TODOS", label: "Todos", count: resumen.total ?? 0 },
        { value: "PENDIENTE", label: "Pendientes", count: resumen.pendientes ?? 0 },
        { value: "CANCELADO", label: "Cancelados", count: resumen.cancelados ?? 0 },
        { value: "INGRESADO", label: "Ingresados", count: resumen.ingresados ?? 0 },
      ],
    },
    { key: "buscar", type: "search", label: "Buscar", value: search, onChange: changeFilter(setSearch), placeholder: "Apellido, nombre o DNI..." },
    { key: "ciclo", type: "select", label: "Ciclo", value: cycle, onChange: changeFilter(setCycle), includeEmptyOption: false, options: (catalogos.ciclos || [suggestedCycle()]).map((value) => ({ value, label: String(value) })) },
    { key: "anio", type: "select", label: "Ingresa a", value: year, onChange: changeFilter(setYear), placeholder: "1° y 2°", options: (catalogos.anios || []).map((item) => ({ value: item.id_anio, label: item.nombre_anio })) },
  ];

  return (
    <>
      <ModulePage
        title="Ingresantes"
        description="Registro de preinscripciones para 1° y 2° hasta incorporarlas al padrón real de alumnos."
        filters={pageFilters}
        tabsInTitle
        headFiltersInActions
        primaryActionLabel="Nuevo ingresante"
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        className="ingresantes-page"
        secondaryActions={writable ? [{
          key: "pasar-alumnos",
          label: "Pasar seleccionados a alumnos",
          icon: faCheck,
          className: "mov-btn--ghost",
          disabled: selectedCount <= 0 || processingBulk || !cycleCanActivate,
          onClick: () => setBulkModalOpen(true),
          title: !cycleCanActivate ? `El ciclo ${cycle} todavía no comenzó; deben seguir como Ingresantes.` : selectedCount > 0 ? `Pasar ${selectedCount} ingresante(s) seleccionado(s) a Alumnos` : "Seleccioná uno o más ingresantes pendientes",
        }] : []}
        notice={`Matrículas pagadas: ${resumen.matriculas_pagadas || 0} · ${formatMoney(resumen.total_matriculas || 0)} · Todo cobro se refleja en Contable en la fecha en que ingresó el dinero.`}
      >
        <GlobalDivTable
          className="ingresantes-table"
          gridClassName="ingresantes-grid"
          ariaLabel="Listado de ingresantes"
          columns={["Apellido y nombre", { label: "DNI", align: "center" }, { label: "Destino", align: "center" }, { label: "Matrícula", align: "center" }, { label: "Inscripción", align: "center" }, { label: "Acciones", align: "center" }]}
          loading={loading}
          loadingLabel="Cargando ingresantes..."
          empty={!loading && !items.length}
        >
          {!loading && error ? <div className="module-empty"><strong>{error}</strong></div> : null}
          {!loading && !error && !items.length ? <div className="module-empty"><strong>Sin ingresantes para mostrar</strong><span>Cambiá los filtros o cargá una nueva inscripción.</span></div> : null}
          {!loading && !error ? items.map((item) => (
            <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ingresantes-grid" key={item.id_ingresante}>
              <div className="mov-gridCell entity-main-cell">
                <div className="ingresantes-nameRow">
                  {writable && item.estado === "PENDIENTE" && !item.id_alumno_confirmado ? (
                    <input
                      className="ingresantes-rowCheck"
                      type="checkbox"
                      aria-label={`Seleccionar ${item.nombre_completo}`}
                      checked={selectedIds.includes(Number(item.id_ingresante))}
                      onChange={() => toggleSelected(item)}
                    />
                  ) : null}
                  <div>
                    <strong>{item.nombre_completo}</strong>
                    <small>{item.id_alumno_confirmado ? `Ingresado · Alumno #${item.id_alumno_confirmado}${item.alumno_confirmado_eliminado ? " · Alumno eliminado" : ""}` : item.estado === "CANCELADO" ? "Cancelado" : `Pendiente · Ciclo ${item.ciclo_lectivo}`}</small>
                  </div>
                </div>
              </div>
              <div className="mov-gridCell is-center"><strong>{item.num_documento}</strong></div>
              <div className="mov-gridCell is-center"><strong>{item.nombre_anio || `${item.id_anio_destino}°`}</strong></div>
              <div className="mov-gridCell is-center">
                <span className={`socios-statusChip ${item.matricula_pagada ? "is-active" : "is-inactive"}`}>
                  {item.matricula_pagada ? `PAGADA · ${formatMoney(item.monto_matricula)}` : "NO PAGADA"}
                </span>
              </div>
              <div className="mov-gridCell is-center">{formatDate(item.fecha_inscripcion)}</div>
              <div className="mov-gridCell mov-actionsInline is-center">
                {writable && !item.id_alumno_confirmado ? <button className="mov-iconBtn" type="button" title="Editar" onClick={() => openEdit(item)}><FontAwesomeIcon icon={faPen} /></button> : null}
                {writable && !item.id_alumno_confirmado && item.estado === "PENDIENTE" ? <button className="mov-iconBtn" type="button" title="Cancelar ingreso" onClick={() => changeState(item, "CANCELADO")}><FontAwesomeIcon icon={faBan} /></button> : null}
                {writable && !item.id_alumno_confirmado && item.estado === "CANCELADO" ? <button className="mov-iconBtn" type="button" title="Volver a pendiente" onClick={() => changeState(item, "PENDIENTE")}><FontAwesomeIcon icon={faRotateLeft} /></button> : null}
                {item.id_alumno_confirmado ? <FontAwesomeIcon icon={faCheck} title="Ya fue pasado a Alumnos" /> : null}
              </div>
            </div>
          )) : null}
        </GlobalDivTable>

        <GlobalPagination
          currentPage={Number(paginacion.pagina || page)}
          totalPages={Number(paginacion.total_paginas || 0)}
          totalRecords={Number(paginacion.total || 0)}
          from={Number(paginacion.desde || 0)}
          to={Number(paginacion.hasta || 0)}
          loading={loading}
          itemLabel="ingresantes"
          ariaLabel="Paginación de ingresantes"
          onPageChange={setPage}
        />
      </ModulePage>

      <CrudModal
        open={modalOpen}
        title={form.id_ingresante ? "Editar ingresante" : "Nuevo ingresante"}
        subtitle="Datos mínimos para registrar la inscripción."
        onClose={() => !saving && setModalOpen(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_ingresante ? "Guardar cambios" : "Guardar ingresante"}
        modalClassName="ingresantes-modal"
      >
        <div className="ingresantes-formGrid">
          <FloatingField label="Apellido *" active={Boolean(form.apellido)}><input value={form.apellido} maxLength={100} required placeholder=" " onChange={(e) => setForm((c) => ({ ...c, apellido: e.target.value.toUpperCase() }))} /></FloatingField>
          <FloatingField label="Nombre *" active={Boolean(form.nombre)}><input value={form.nombre} maxLength={100} required placeholder=" " onChange={(e) => setForm((c) => ({ ...c, nombre: e.target.value.toUpperCase() }))} /></FloatingField>
          <FloatingField label="DNI *" active={Boolean(form.num_documento)}><input value={form.num_documento} maxLength={10} inputMode="numeric" required placeholder=" " disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, num_documento: e.target.value.replace(/\D+/g, "") }))} /></FloatingField>
          <FloatingField label="Ingresa a *" active={Boolean(form.id_anio_destino)}><select value={form.id_anio_destino} required onChange={(e) => setForm((c) => ({ ...c, id_anio_destino: e.target.value }))}>{(catalogos.anios || []).map((item) => <option key={item.id_anio} value={item.id_anio}>{item.nombre_anio}</option>)}</select></FloatingField>
          <FloatingField label="Ciclo lectivo *" active={Boolean(form.ciclo_lectivo)}><input type="number" min="2020" max="2100" value={form.ciclo_lectivo} required disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, ciclo_lectivo: e.target.value }))} /></FloatingField>
          <FloatingField label="Fecha de inscripción *" active={Boolean(form.fecha_inscripcion)}><input type="date" max={localToday()} value={form.fecha_inscripcion} required onChange={(e) => setForm((c) => ({ ...c, fecha_inscripcion: e.target.value }))} /></FloatingField>
          <label className="ingresantes-check"><input type="checkbox" checked={Boolean(form.matricula_pagada)} disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, matricula_pagada: e.target.checked }))} /><span>Matrícula pagada</span></label>
          {form.matricula_pagada ? <FloatingField label="Monto matrícula *" active={Boolean(form.monto_matricula)}><input type="number" min="0.01" step="0.01" value={form.monto_matricula} required disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, monto_matricula: e.target.value }))} /></FloatingField> : null}
          {form.matricula_pagada ? <FloatingField label="Medio de pago" active={Boolean(form.id_medio_pago)}><select value={form.id_medio_pago} disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, id_medio_pago: e.target.value }))}><option value="">Sin especificar</option>{(catalogos.medios_pago || []).map((item) => <option key={item.id_medio_pago} value={item.id_medio_pago}>{item.medio_pago}</option>)}</select></FloatingField> : null}
          {form.matricula_pagada ? <FloatingField label="Fecha de pago *" active={Boolean(form.fecha_pago_matricula)}><input type="date" max={localToday()} value={form.fecha_pago_matricula} required disabled={paymentLocked} onChange={(e) => setForm((c) => ({ ...c, fecha_pago_matricula: e.target.value }))} /></FloatingField> : null}
          {paymentLocked ? <div className="ingresantes-lockNote">La matrícula ya fue cobrada y forma parte de Contable. DNI, ciclo, estado del cobro, monto, fecha y medio de pago quedan bloqueados para no alterar el historial.</div> : null}
          <FloatingField label="Observaciones" active={Boolean(form.observaciones)} textarea wide><textarea rows={3} maxLength={5000} value={form.observaciones} placeholder=" " onChange={(e) => setForm((c) => ({ ...c, observaciones: e.target.value.toUpperCase() }))} /></FloatingField>
        </div>
      </CrudModal>

      <ModalEliminarGlobal
        open={bulkModalOpen}
        operacion="advertencia"
        loading={processingBulk}
        onClose={() => setBulkModalOpen(false)}
        title="Pasar seleccionados a Alumnos"
        message={`Se crearán o reactivarán como alumnos únicamente los ${selectedCount} ingresante(s) que seleccionaste del ciclo ${cycle}.`}
        warning="Los cancelados no se procesan. Si una matrícula ya fue cobrada, se asociará al alumno definitivo conservando la fecha original y sin duplicar el ingreso contable."
        confirmLabel="Pasar a Alumnos"
        successMessage="Ingresantes pasados a Alumnos correctamente."
        errorMessage="No se pudieron pasar los ingresantes a Alumnos."
        details={[
          { label: "Ciclo", value: cycle },
          { label: "Seleccionados", value: selectedCount },
        ]}
        onConfirm={passToStudents}
      />

      <ModuleFeedback type={feedback?.type} message={feedback?.message} onClose={() => setFeedback(null)} />
    </>
  );
}
