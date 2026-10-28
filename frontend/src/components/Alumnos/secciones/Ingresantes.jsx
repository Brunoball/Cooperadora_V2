import TableEmptyIcon from "../../Global/TableEmptyIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faCheck, faCreditCard, faPen, faRotateLeft, faUser } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { EntityTabPane, EntityTabs, FloatingField } from "../../Global/Formularios/TabbedForm";
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
    telefono: "",
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
    telefono: item.telefono || "",
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
const FORM_TAB_INGRESANTE = "ingresante";
const FORM_TAB_MATRICULA = "matricula";
const FORM_TABS = [
  { value: FORM_TAB_INGRESANTE, label: "Datos del ingresante", icon: faUser },
  { value: FORM_TAB_MATRICULA, label: "Matrícula y observaciones", icon: faCreditCard },
];

function isInteractiveRowTarget(target) {
  return target instanceof Element && Boolean(
    target.closest("button, a, input, label, select, textarea, [data-no-row-toggle]"),
  );
}

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
  const [origin, setOrigin] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [stateModal, setStateModal] = useState(null);
  const [changingState, setChangingState] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [formTab, setFormTab] = useState(FORM_TAB_INGRESANTE);

  const filters = useMemo(() => ({
    buscar: search,
    ciclo_lectivo: cycle,
    id_anio_destino: year,
    estado: status,
    origen: origin,
    pagina: page,
    por_pagina: 50,
  }), [search, cycle, year, status, origin, page]);

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
    setFormTab(FORM_TAB_INGRESANTE);
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm(formFromItem(item));
    setFormTab(FORM_TAB_INGRESANTE);
    setModalOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();

    // Con pestañas, la validación nativa no alcanza para los campos ocultos.
    // Revisamos ambas secciones y volvemos a la pestaña que requiere atención.
    const today = localToday();
    let invalid = null;
    if (!form.apellido.trim()) invalid = [FORM_TAB_INGRESANTE, "apellido", "Completá el apellido del ingresante."];
    else if (!form.nombre.trim()) invalid = [FORM_TAB_INGRESANTE, "nombre", "Completá el nombre del ingresante."];
    else if (!String(form.num_documento || "").replace(/\D+/g, "")) invalid = [FORM_TAB_INGRESANTE, "num_documento", "Ingresá el DNI del ingresante."];
    else if (!form.id_anio_destino) invalid = [FORM_TAB_INGRESANTE, "id_anio_destino", "Seleccioná el año al que ingresa."];
    else if (!form.ciclo_lectivo || Number(form.ciclo_lectivo) < 2020 || Number(form.ciclo_lectivo) > 2100 || !Number.isInteger(Number(form.ciclo_lectivo))) invalid = [FORM_TAB_INGRESANTE, "ciclo_lectivo", "Ingresá un ciclo lectivo válido (2020 a 2100)."];
    else if (!form.fecha_inscripcion || form.fecha_inscripcion > today) invalid = [FORM_TAB_INGRESANTE, "fecha_inscripcion", "Ingresá una fecha de inscripción válida."];
    else if (form.matricula_pagada && (!form.monto_matricula || !Number.isFinite(Number(form.monto_matricula)) || Number(form.monto_matricula) < 0.01)) invalid = [FORM_TAB_MATRICULA, "monto_matricula", "Ingresá un monto de matrícula mayor a cero."];
    else if (form.matricula_pagada && (!form.fecha_pago_matricula || form.fecha_pago_matricula > today)) invalid = [FORM_TAB_MATRICULA, "fecha_pago_matricula", "Ingresá una fecha de pago válida."];

    if (invalid) {
      const [tab, field, message] = invalid;
      setFormTab(tab);
      setFeedback({ type: "error", message });
      window.requestAnimationFrame(() => {
        document.querySelector(`.ingresantes-modal [name="${field}"]`)?.focus();
      });
      return;
    }

    setSaving(true);
    try {
      await ingresantesApi.guardar({
        ...form,
        num_documento: String(form.num_documento || "").replace(/\D+/g, ""),
        telefono: String(form.telefono || "").trim() || null,
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

  const requestStateChange = (item, target) => {
    if (!item || item.id_alumno_confirmado) return;
    setStateModal({ item, target });
  };

  const confirmStateChange = async () => {
    if (!stateModal?.item || !stateModal?.target) {
      return { ok: false, mensaje: "No se pudo determinar el cambio de estado." };
    }

    setChangingState(true);
    try {
      const response = await ingresantesApi.cambiarEstado({
        id: stateModal.item.id_ingresante,
        estado: stateModal.target,
      });
      setSelectedIds((current) =>
        current.filter((id) => id !== Number(stateModal.item.id_ingresante)),
      );
      await cargar({ silent: true });
      return {
        ok: true,
        mensaje:
          response?.mensaje ||
          (stateModal.target === "CANCELADO"
            ? "Ingreso cancelado correctamente."
            : "Ingresante vuelto a pendiente correctamente."),
      };
    } catch (requestError) {
      return {
        ok: false,
        mensaje: requestError.message || "No se pudo actualizar el ingresante.",
      };
    } finally {
      setChangingState(false);
    }
  };

  const passToStudents = async () => {
    setProcessingBulk(true);
    try {
      const response = await ingresantesApi.pasarAlumnos({ ciclo_lectivo: cycle, ids_ingresantes: selectedIds });
      setBulkModalOpen(false);
      setSelectedIds([]);
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
    { key: "buscar", type: "search", label: "Buscar", value: search, onChange: changeFilter(setSearch), placeholder: "Apellido, nombre, DNI o teléfono...", className: "ingresantes-searchFilter" },
    { key: "ciclo", type: "select", label: "Ciclo", value: cycle, onChange: changeFilter(setCycle), includeEmptyOption: false, className: "ingresantes-cycleFilter", options: (catalogos.ciclos || [suggestedCycle()]).map((value) => ({ value, label: String(value) })) },
    { key: "anio", type: "select", label: "Ingresa a", value: year, onChange: changeFilter(setYear), placeholder: "TODOS", className: "ingresantes-yearFilter", options: (catalogos.anios || []).map((item) => ({ value: item.id_anio, label: item.nombre_anio })) },
    { key: "origen", type: "select", label: "Origen", value: origin, onChange: changeFilter(setOrigin), placeholder: "TODOS", options: [{ value: "manual", label: "MANUAL" }, { value: "bot_whatsapp", label: "BOT" }] },
  ];

  return (
    <>
      <ModulePage
        title="Ingresantes"
        description="Registro de preinscripciones para 1° y 2° hasta incorporarlas al padrón real de alumnos."
        filters={pageFilters}
        tabsInTitle
        headFiltersInActions
        headFiltersClassName="ingresantes-headFilters"
        primaryActionLabel="Nuevo ingresante"
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        className="ingresantes-page"
        secondaryActions={writable ? [{
          key: "pasar-alumnos",
          label: selectedCount > 0 ? `Pasar a alumnos (${selectedCount})` : "Pasar a alumnos",
          icon: faCheck,
          className: "mov-btn--ghost",
          disabled: selectedCount <= 0 || processingBulk || !cycleCanActivate,
          onClick: () => setBulkModalOpen(true),
          title: !cycleCanActivate ? `El ciclo ${cycle} todavía no comenzó; deben seguir como Ingresantes.` : selectedCount > 0 ? `Pasar ${selectedCount} ingresante(s) seleccionado(s) a Alumnos` : "Seleccioná uno o más ingresantes pendientes",
        }] : []}
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
          {!loading && !error && !items.length ? <div className="module-empty"><TableEmptyIcon /><strong>Sin ingresantes para mostrar</strong><span>Cambiá los filtros o cargá una nueva inscripción.</span></div> : null}
          {!loading && !error ? items.map((item) => {
            const selectable = writable && cycleCanActivate && item.estado === "PENDIENTE" && !item.id_alumno_confirmado;
            const selected = selectedIds.includes(Number(item.id_ingresante));
            return (
              <div
                className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ingresantes-grid ${selectable ? "is-selectable" : ""}`.trim()}
                key={item.id_ingresante}
                role="row"
                tabIndex={selectable ? 0 : undefined}
                aria-selected={selectable ? selected : undefined}
                title={selectable ? (selected ? "Quitar de la selección" : "Hacé clic para seleccionar este ingresante") : item.estado === "PENDIENTE" && !cycleCanActivate ? `Los ingresantes del ciclo ${cycle} todavía no pueden pasarse a Alumnos.` : undefined}
                onClick={(event) => {
                  if (selectable && !isInteractiveRowTarget(event.target)) toggleSelected(item);
                }}
                onKeyDown={(event) => {
                  if (!selectable || isInteractiveRowTarget(event.target)) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleSelected(item);
                  }
                }}
              >
                <div className="mov-gridCell entity-main-cell">
                  <div className="ingresantes-nameRow">
                    <div>
                      <strong>{item.nombre_completo}</strong>
                      <small>{item.id_alumno_confirmado ? `Ingresado · Alumno #${item.id_alumno_confirmado}${item.alumno_confirmado_eliminado ? " · Alumno eliminado" : ""}` : item.estado === "CANCELADO" ? "Cancelado" : `Pendiente · Ciclo ${item.ciclo_lectivo}${selectable && selected ? " · Seleccionado" : ""}`}</small>
                    </div>
                  </div>
                </div>
                <div className="mov-gridCell is-center"><strong>{item.num_documento}</strong>{item.telefono ? <small>{item.telefono}</small> : null}</div>
                <div className="mov-gridCell is-center"><strong>{item.nombre_anio || `${item.id_anio_destino}°`}</strong></div>
                <div className="mov-gridCell is-center">
                  <span className={`socios-statusChip ${item.matricula_pagada ? "is-active" : "is-inactive"}`}>
                    {item.matricula_pagada ? `PAGADA · ${formatMoney(item.monto_matricula)}` : "NO PAGADA"}
                  </span>
                </div>
                <div className="mov-gridCell is-center">{formatDate(item.fecha_inscripcion)}</div>
                <div className="mov-gridCell mov-actionsInline is-center">
                  {writable && !item.id_alumno_confirmado ? <button className="mov-iconBtn" type="button" title="Editar" onClick={() => openEdit(item)}><FontAwesomeIcon icon={faPen} /></button> : null}
                  {writable && !item.id_alumno_confirmado && item.estado === "PENDIENTE" ? <button className="mov-iconBtn" type="button" title="Cancelar ingreso" onClick={() => requestStateChange(item, "CANCELADO")}><FontAwesomeIcon icon={faBan} /></button> : null}
                  {writable && !item.id_alumno_confirmado && item.estado === "CANCELADO" ? <button className="mov-iconBtn" type="button" title="Volver a pendiente" onClick={() => requestStateChange(item, "PENDIENTE")}><FontAwesomeIcon icon={faRotateLeft} /></button> : null}
                  {item.id_alumno_confirmado ? <FontAwesomeIcon icon={faCheck} title="Ya fue pasado a Alumnos" /> : null}
                </div>
              </div>
            );
          }) : null}
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
        subtitle="Completá los datos del ingresante y, si corresponde, registrá la matrícula."
        onClose={() => !saving && setModalOpen(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_ingresante ? "Guardar cambios" : "Guardar ingresante"}
        wide
        noValidate
        modalClassName="ingresantes-modal"
      >
        <EntityTabs
          tabs={FORM_TABS}
          value={formTab}
          onChange={setFormTab}
          idPrefix="ingresantes-form"
          ariaLabel="Datos de la inscripción"
        />

        <EntityTabPane active={formTab === FORM_TAB_INGRESANTE} disableWhenInactive className="ingresantes-tab-pane">
          <div
            className="ingresantes-formGrid"
            id="ingresantes-form-ingresante-panel"
            role="tabpanel"
            aria-labelledby="ingresantes-form-ingresante"
          >
          <FloatingField label="Apellido *" active={Boolean(form.apellido)} className="ingresantes-field--span-6">
            <input
              name="apellido"
              value={form.apellido}
              maxLength={100}
              required
              placeholder="Ej. PÉREZ"
              onChange={(e) => setForm((c) => ({ ...c, apellido: e.target.value.toUpperCase() }))}
            />
          </FloatingField>

          <FloatingField label="Nombre *" active={Boolean(form.nombre)} className="ingresantes-field--span-6">
            <input
              name="nombre"
              value={form.nombre}
              maxLength={100}
              required
              placeholder="Ej. JUAN"
              onChange={(e) => setForm((c) => ({ ...c, nombre: e.target.value.toUpperCase() }))}
            />
          </FloatingField>

          <FloatingField label="DNI *" active={Boolean(form.num_documento)} className="ingresantes-field--span-6">
            <input
              name="num_documento"
              value={form.num_documento}
              maxLength={10}
              inputMode="numeric"
              required
              placeholder="Ej. 45123456"
              onChange={(e) => setForm((c) => ({ ...c, num_documento: e.target.value.replace(/\D+/g, "") }))}
            />
          </FloatingField>

          <FloatingField label="Teléfono" active={Boolean(form.telefono)} className="ingresantes-field--span-6">
            <input
              type="tel"
              value={form.telefono}
              maxLength={20}
              autoComplete="tel"
              placeholder=" "
              onChange={(e) => setForm((c) => ({ ...c, telefono: e.target.value }))}
            />
          </FloatingField>

          <FloatingField label="Ingresa a *" active={Boolean(form.id_anio_destino)} className="ingresantes-field--span-4">
            <select
              name="id_anio_destino"
              value={form.id_anio_destino}
              required
              onChange={(e) => setForm((c) => ({ ...c, id_anio_destino: e.target.value }))}
            >
              {(catalogos.anios || []).map((item) => <option key={item.id_anio} value={item.id_anio}>{item.nombre_anio}</option>)}
            </select>
          </FloatingField>

          <FloatingField label="Ciclo lectivo *" active={Boolean(form.ciclo_lectivo)} className="ingresantes-field--span-4">
            <input
              type="number"
              min="2020"
              max="2100"
              name="ciclo_lectivo"
              value={form.ciclo_lectivo}
              required
              placeholder="Ej. 2027"
              onChange={(e) => setForm((c) => ({ ...c, ciclo_lectivo: e.target.value }))}
            />
          </FloatingField>

          <FloatingField label="Fecha de inscripción *" active={Boolean(form.fecha_inscripcion)} className="ingresantes-field--span-4">
            <input
              type="date"
              max={localToday()}
              name="fecha_inscripcion"
              value={form.fecha_inscripcion}
              required
              onChange={(e) => setForm((c) => ({ ...c, fecha_inscripcion: e.target.value }))}
            />
          </FloatingField>
          </div>
        </EntityTabPane>

        <EntityTabPane active={formTab === FORM_TAB_MATRICULA} disableWhenInactive className="ingresantes-tab-pane">
          <div
            className="ingresantes-formGrid"
            id="ingresantes-form-matricula-panel"
            role="tabpanel"
            aria-labelledby="ingresantes-form-matricula"
          >
          <label className={`entity-check-option ingresantes-check ingresantes-check--field ingresantes-field--span-12 ${form.matricula_pagada ? "is-selected" : ""}`}>
            <input
              type="checkbox"
              checked={Boolean(form.matricula_pagada)}
              onChange={(e) => setForm((c) => ({ ...c, matricula_pagada: e.target.checked }))}
            />
            <span>Matrícula pagada</span>
          </label>

          {form.matricula_pagada ? (
            <>
              <FloatingField label="Monto matrícula *" active={Boolean(form.monto_matricula)} className="ingresantes-field--span-4">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  name="monto_matricula"
                  value={form.monto_matricula}
                  required
                  placeholder="Ej. 15000"
                  onChange={(e) => setForm((c) => ({ ...c, monto_matricula: e.target.value }))}
                />
              </FloatingField>

              <FloatingField label="Medio de pago" active={Boolean(form.id_medio_pago)} className="ingresantes-field--span-4">
                <select
                  value={form.id_medio_pago}
                  onChange={(e) => setForm((c) => ({ ...c, id_medio_pago: e.target.value }))}
                >
                  <option value="">Sin especificar</option>
                  {(catalogos.medios_pago || []).map((item) => <option key={item.id_medio_pago} value={item.id_medio_pago}>{item.medio_pago}</option>)}
                </select>
              </FloatingField>

              <FloatingField label="Fecha de pago *" active={Boolean(form.fecha_pago_matricula)} className="ingresantes-field--span-4">
                <input
                  type="date"
                  max={localToday()}
                  name="fecha_pago_matricula"
                  value={form.fecha_pago_matricula}
                  required
                  onChange={(e) => setForm((c) => ({ ...c, fecha_pago_matricula: e.target.value }))}
                />
              </FloatingField>
            </>
          ) : null}

          <FloatingField label="Observaciones" active={Boolean(form.observaciones)} textarea wide className="ingresantes-field--span-12">
            <textarea
              rows={3}
              maxLength={5000}
              value={form.observaciones}
              placeholder="Ej. INFORMACIÓN ADICIONAL DE LA INSCRIPCIÓN"
              onChange={(e) => setForm((c) => ({ ...c, observaciones: e.target.value.toUpperCase() }))}
            />
          </FloatingField>
          </div>
        </EntityTabPane>
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
        onToast={(tipo, mensaje) => setFeedback({ type: tipo, message: mensaje })}
      />

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.target === "CANCELADO" ? "baja" : "alta"}
        row={stateModal?.item || null}
        loading={changingState}
        onClose={() => !changingState && setStateModal(null)}
        title={stateModal?.target === "CANCELADO" ? "Cancelar ingreso" : "Volver a pendiente"}
        message={
          stateModal?.target === "CANCELADO"
            ? "El ingresante dejará de figurar entre los pendientes y pasará a Cancelados."
            : "El ingresante volverá a figurar entre los pendientes para poder continuar su proceso de ingreso."
        }
        warning={
          stateModal?.target === "CANCELADO"
            ? "Esta acción no elimina el registro. Podés volverlo a Pendiente más adelante."
            : "El registro recuperará el estado Pendiente y volverá a estar disponible para selección."
        }
        confirmLabel={stateModal?.target === "CANCELADO" ? "Cancelar ingreso" : "Volver a pendiente"}
        successMessage={stateModal?.target === "CANCELADO" ? "Ingreso cancelado correctamente." : "Ingresante vuelto a pendiente correctamente."}
        errorMessage="No se pudo actualizar el estado del ingresante."
        tone={stateModal?.target === "CANCELADO" ? "warning" : "success"}
        icon={stateModal?.target === "CANCELADO" ? faBan : faRotateLeft}
        details={[
          { label: "Ingresante", value: stateModal?.item?.nombre_completo || "—" },
          { label: "DNI", value: stateModal?.item?.num_documento || "—" },
          { label: "Ciclo", value: stateModal?.item?.ciclo_lectivo || "—" },
          { label: "Estado", value: stateModal?.target === "CANCELADO" ? "CANCELADO" : "PENDIENTE" },
        ]}
        onConfirm={confirmStateChange}
        onToast={(tipo, mensaje) => setFeedback({ type: tipo, message: mensaje })}
      />

      <ModuleFeedback type={feedback?.type} message={feedback?.message} onClose={() => setFeedback(null)} />
    </>
  );
}
