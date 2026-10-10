import TableEmptyIcon from "../Global/TableEmptyIcon";
import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRightArrowLeft,
  faBookOpen,
  faCheck,
  faCircleInfo,
  faFileExcel,
  faFileImport,
  faHouse,
  faIdCard,
  faPen,
  faPlus,
  faRotateLeft,
  faTrashCan,
  faUser,
  faUserSlash,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import GlobalPagination from "../Global/GlobalPagination";
import CrudModal from "../Global/Modales/CrudModal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import ModalCambioEstadoGlobal from "../Global/Modales/ModalCambioEstadoGlobal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../Global/Modales/InfoModal";
import ModuleFeedback from "../Global/ModuleFeedback";
import {
  EntityFormPanel,
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../Global/Formularios/TabbedForm";
import { canWrite } from "../_shared/auth/session";
import { alumnosApi } from "./api/alumnosApi";
import { useAlumnos } from "./hooks/useAlumnos";
import logoCooperadoraPdf from "../../imagenes/Escudo_ipet50.png";
import "./Alumnos.css";

const FORM_TAB_PERSONAL = "personal";
const FORM_TAB_ESCOLAR = "escolar";
const INFO_TAB_GENERAL = "general";
const INFO_TAB_PAGOS = "pagos";
const INFO_TAB_HISTORIAL = "historial";

const EXPORT_COLUMNS_ACTIVOS = [
  { key: "nombre_completo", label: "APELLIDO Y NOMBRE" },
  { key: "tipo_documento_sigla", label: "TIPO DOC." },
  { key: "num_documento", label: "N° DOCUMENTO" },
  { key: "domicilio", label: "DOMICILIO" },
  { key: "localidad", label: "LOCALIDAD" },
  { key: "nombre_anio", label: "AÑO" },
  { key: "nombre_division", label: "DIVISIÓN" },
  { key: "telefono", label: "TELÉFONO" },
  { key: "nombre_familia", label: "FAMILIA" },
  { key: "categoria", label: "CATEGORÍA" },
];

const EXPORT_COLUMNS_BAJAS = [
  ...EXPORT_COLUMNS_ACTIVOS,
  { label: "FECHA DE BAJA", value: (item) => formatDate(item.actualizado_en) },
  { key: "motivo", label: "MOTIVO" },
];

const EXPORT_COLUMNS_EGRESADOS = [
  ...EXPORT_COLUMNS_ACTIVOS,
  { label: "FECHA DE EGRESO", value: (item) => formatDate(item.fecha_egreso) },
  { key: "promocion", label: "PROMOCIÓN" },
];

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function suggestedAcademicCycle() {
  return new Date().getFullYear();
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const text = String(value).replace("T", " ");
  const [date, time = ""] = text.split(" ");
  return `${formatDate(date)}${time ? ` · ${time.slice(0, 5)}` : ""}`;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function exportSection(tab, rows) {
  if (tab === "bajas") {
    return {
      titulo: "Alumnos dados de baja",
      hoja: "Bajas",
      columnas: EXPORT_COLUMNS_BAJAS,
      registros: rows,
    };
  }
  if (tab === "egresados") {
    return {
      titulo: "Alumnos egresados",
      hoja: "Egresados",
      columnas: EXPORT_COLUMNS_EGRESADOS,
      registros: rows,
    };
  }
  return {
    titulo: "Alumnos activos",
    hoja: "Activos",
    columnas: EXPORT_COLUMNS_ACTIVOS,
    registros: rows,
  };
}

function emptyForm() {
  return {
    id_alumno: "",
    apellido: "",
    nombre: "",
    id_tipo_documento: "",
    num_documento: "",
    id_sexo: "",
    domicilio: "",
    localidad: "SAN FRANCISCO",
    cp: "2400",
    telefono: "",
    lugar_nacimiento: "",
    fecha_nacimiento: "",
    id_anio: "",
    id_division: "",
    id_categoria: "",
    id_cat_monto: "",
    es_cobrador: false,
    ingreso: localToday(),
    observaciones: "",
    id_familia: "",
  };
}

function formFromItem(item = {}) {
  return {
    id_alumno: item.id_alumno || "",
    apellido: item.apellido || "",
    nombre: item.nombre || "",
    id_tipo_documento: item.id_tipo_documento ? String(item.id_tipo_documento) : "",
    num_documento: item.num_documento || "",
    id_sexo: item.id_sexo ? String(item.id_sexo) : "",
    domicilio: item.domicilio || "",
    localidad: item.localidad || "",
    cp: item.cp || "",
    telefono: item.telefono || "",
    lugar_nacimiento: item.lugar_nacimiento || "",
    fecha_nacimiento: item.fecha_nacimiento || "",
    id_anio: item.id_anio ? String(item.id_anio) : "",
    id_division: item.id_division ? String(item.id_division) : "",
    id_categoria: item.id_categoria ? String(item.id_categoria) : "",
    id_cat_monto: item.id_cat_monto ? String(item.id_cat_monto) : "",
    es_cobrador: Boolean(item.es_cobrador),
    ingreso: item.ingreso || localToday(),
    observaciones: item.observaciones || "",
    id_familia: item.id_familia ? String(item.id_familia) : "",
  };
}

function normalizePayload(form) {
  const optionalId = (value) => (String(value || "").trim() ? Number(value) : null);
  return {
    id_alumno: form.id_alumno || null,
    apellido: String(form.apellido || "").trim(),
    nombre: String(form.nombre || "").trim() || null,
    id_tipo_documento: Number(form.id_tipo_documento),
    num_documento: String(form.num_documento || "").trim(),
    id_sexo: optionalId(form.id_sexo),
    domicilio: String(form.domicilio || "").trim() || null,
    localidad: String(form.localidad || "").trim() || null,
    cp: String(form.cp || "").trim() || null,
    telefono: String(form.telefono || "").trim() || null,
    lugar_nacimiento: String(form.lugar_nacimiento || "").trim() || null,
    fecha_nacimiento: form.fecha_nacimiento || null,
    id_anio: optionalId(form.id_anio),
    id_division: optionalId(form.id_division),
    id_categoria: optionalId(form.id_categoria),
    id_cat_monto: optionalId(form.id_cat_monto),
    es_cobrador: Boolean(form.es_cobrador),
    ingreso: form.ingreso || localToday(),
    observaciones: String(form.observaciones || "").trim() || null,
    id_familia: optionalId(form.id_familia),
  };
}

function AlumnoForm({ form, setForm, catalogs, tab, setTab }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const catalogKey = (value) => String(value || "").trim().toLocaleUpperCase("es-AR");
  const setCategoria = (value) => {
    if (!value) {
      setForm((current) => ({ ...current, id_categoria: "", id_cat_monto: "" }));
      return;
    }
    const category = (catalogs.categorias || []).find(
      (item) => String(item.id_categoria) === String(value),
    );
    const amountCategory = (catalogs.categorias_monto || []).find(
      (item) => catalogKey(item.nombre_categoria) === catalogKey(category?.nombre_categoria),
    );
    setForm((current) => ({
      ...current,
      id_categoria: String(value),
      id_cat_monto: amountCategory ? String(amountCategory.id_cat_monto) : "",
    }));
  };
  const setCategoriaMonto = (value) => {
    if (!value) {
      setForm((current) => ({ ...current, id_categoria: "", id_cat_monto: "" }));
      return;
    }
    const amountCategory = (catalogs.categorias_monto || []).find(
      (item) => String(item.id_cat_monto) === String(value),
    );
    const category = (catalogs.categorias || []).find(
      (item) => catalogKey(item.nombre_categoria) === catalogKey(amountCategory?.nombre_categoria),
    );
    setForm((current) => ({
      ...current,
      id_cat_monto: String(value),
      id_categoria: category ? String(category.id_categoria) : "",
    }));
  };
  const active = (key) => Boolean(String(form[key] ?? "").trim());
  const tabs = [
    { value: FORM_TAB_PERSONAL, label: "Datos personales", icon: faUser },
    { value: FORM_TAB_ESCOLAR, label: "Datos escolares", icon: faBookOpen },
  ];

  return (
    <div className="entity-form-layout">
      <EntityTabs tabs={tabs} value={tab} onChange={setTab} idPrefix="alumnos-form" />

      <EntityTabPane active={tab === FORM_TAB_PERSONAL}>
        <EntityFormPanel
          tabValue={FORM_TAB_PERSONAL}
          idPrefix="alumnos-form"
          title="Identificación y contacto"
          icon={faIdCard}
          bodyClassName="alumnos-formGrid alumnos-formGrid--personal"
        >
          <FloatingField label="Apellido *" active={active("apellido")} className="alumnos-field--span-6">
            <input
              value={form.apellido}
              maxLength={100}
              onChange={(event) => set("apellido", event.target.value.toUpperCase())}
              required
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Nombre" active={active("nombre")} className="alumnos-field--span-6">
            <input
              value={form.nombre}
              maxLength={100}
              onChange={(event) => set("nombre", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Tipo de documento *" active={active("id_tipo_documento")} className="alumnos-field--span-4">
            <select
              value={form.id_tipo_documento}
              onChange={(event) => set("id_tipo_documento", event.target.value)}
              required
            >
              <option value="">Seleccionar</option>
              {(catalogs.tipos_documentos || []).map((item) => (
                <option key={item.id_tipo_documento} value={item.id_tipo_documento}>
                  {item.sigla} — {item.descripcion}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Número de documento *" active={active("num_documento")} className="alumnos-field--span-4">
            <input
              value={form.num_documento}
              maxLength={20}
              onChange={(event) => set("num_documento", event.target.value.replace(/\s+/g, ""))}
              required
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Sexo" active={active("id_sexo")} className="alumnos-field--span-4">
            <select value={form.id_sexo} onChange={(event) => set("id_sexo", event.target.value)}>
              <option value="">Sin especificar</option>
              {(catalogs.sexos || []).map((item) => (
                <option key={item.id_sexo} value={item.id_sexo}>{item.sexo}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Fecha de nacimiento" active={active("fecha_nacimiento")} className="alumnos-field--span-4">
            <input
              type="date"
              max={localToday()}
              value={form.fecha_nacimiento}
              onChange={(event) => set("fecha_nacimiento", event.target.value)}
            />
          </FloatingField>
          <FloatingField label="Lugar de nacimiento" active={active("lugar_nacimiento")} className="alumnos-field--span-8">
            <input
              value={form.lugar_nacimiento}
              maxLength={100}
              onChange={(event) => set("lugar_nacimiento", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Domicilio" active={active("domicilio")} wide className="alumnos-field--span-12">
            <input
              value={form.domicilio}
              maxLength={150}
              onChange={(event) => set("domicilio", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Localidad" active={active("localidad")} className="alumnos-field--span-5">
            <input
              value={form.localidad}
              maxLength={100}
              onChange={(event) => set("localidad", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Código postal" active={active("cp")} className="alumnos-field--span-3">
            <input
              value={form.cp}
              maxLength={10}
              onChange={(event) => set("cp", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
          <FloatingField label="Teléfono" active={active("telefono")} className="alumnos-field--span-4">
            <input
              value={form.telefono}
              maxLength={20}
              onChange={(event) => set("telefono", event.target.value)}
              placeholder=" "
            />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={tab === FORM_TAB_ESCOLAR}>
        <EntityFormPanel
          tabValue={FORM_TAB_ESCOLAR}
          idPrefix="alumnos-form"
          title="Curso, cuota y familia"
          icon={faUsers}
          bodyClassName="alumnos-formGrid alumnos-formGrid--school"
        >
          <FloatingField label="Año" active={active("id_anio")} className="alumnos-field--span-3">
            <select value={form.id_anio} onChange={(event) => set("id_anio", event.target.value)}>
              <option value="">Sin asignar</option>
              {(catalogs.anios || []).map((item) => (
                <option key={item.id_anio} value={item.id_anio}>{item.nombre_anio}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="División" active={active("id_division")} className="alumnos-field--span-3">
            <select value={form.id_division} onChange={(event) => set("id_division", event.target.value)}>
              <option value="">Sin asignar</option>
              {(catalogs.divisiones || []).map((item) => (
                <option key={item.id_division} value={item.id_division}>{item.nombre_division}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Categoría" active={active("id_categoria")} className="alumnos-field--span-6">
            <select value={form.id_categoria} onChange={(event) => setCategoria(event.target.value)}>
              <option value="">Sin asignar</option>
              {(catalogs.categorias || []).map((item) => (
                <option key={item.id_categoria} value={item.id_categoria}>{item.nombre_categoria}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Categoría de monto" active={active("id_cat_monto")} className="alumnos-field--span-6">
            <select value={form.id_cat_monto} onChange={(event) => setCategoriaMonto(event.target.value)}>
              <option value="">Sin asignar</option>
              {(catalogs.categorias_monto || []).map((item) => (
                <option key={item.id_cat_monto} value={item.id_cat_monto}>
                  {item.nombre_categoria} — {formatMoney(item.monto_mensual)} / mes
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Familia" active={active("id_familia")} className="alumnos-field--span-6">
            <select value={form.id_familia} onChange={(event) => set("id_familia", event.target.value)}>
              <option value="">Sin familia</option>
              {(catalogs.familias || []).map((item) => (
                <option key={item.id_familia} value={item.id_familia}>
                  {item.nombre_familia}{item.activo ? "" : " (BAJA)"}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Fecha de ingreso *" active={active("ingreso")} className="alumnos-field--span-6">
            <input
              type="date"
              max={localToday()}
              value={form.ingreso}
              onChange={(event) => set("ingreso", event.target.value)}
              required
            />
          </FloatingField>
          <label className={`entity-field alumnos-cobradorCheck alumnos-field--span-6 ${form.es_cobrador ? "is-selected" : ""}`}>
            <span className="entity-checkRow">
              <input
                type="checkbox"
                checked={form.es_cobrador}
                onChange={(event) => set("es_cobrador", event.target.checked)}
              />
              <b>Marcar como cobrador</b>
            </span>
          </label>
          <FloatingField label="Observaciones" active={active("observaciones")} wide textarea className="alumnos-field--span-12">
            <textarea
              value={form.observaciones}
              maxLength={5000}
              rows={4}
              onChange={(event) => set("observaciones", event.target.value.toUpperCase())}
              placeholder=" "
            />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>
    </div>
  );
}

export default function Alumnos() {
  const writable = canWrite();
  const [view, setView] = useState("activos");
  const [search, setSearch] = useState("");
  const [anio, setAnio] = useState("");
  const [division, setDivision] = useState("");
  const [categoria, setCategoria] = useState("");
  const [familia, setFamilia] = useState("");
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState(null);
  const [formModal, setFormModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formTab, setFormTab] = useState(FORM_TAB_PERSONAL);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [detailTab, setDetailTab] = useState(INFO_TAB_GENERAL);
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importCycle, setImportCycle] = useState(String(suggestedAcademicCycle()));
  const [exportOpen, setExportOpen] = useState(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const [exportCurrentSections, setExportCurrentSections] = useState([]);
  const [exportAllSections, setExportAllSections] = useState([]);

  const filters = useMemo(
    () =>
      view === "activos"
        ? {
            buscar: search,
            id_anio: anio,
            id_division: division,
            id_categoria: categoria,
            id_familia: familia,
            pagina: page,
          }
        : {
            buscar: search,
            tipo: view === "bajas" ? "BAJA" : "EGRESO",
            id_anio: anio,
            id_division: division,
            pagina: page,
          },
    [view, search, anio, division, categoria, familia, page],
  );

  const { items, resumen, catalogos, paginacion, loading, error, cargar } = useAlumnos(
    filters,
    view === "activos" ? "activos" : "inactivos",
  );

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const changeView = (value) => {
    setView(value);
    setPage(1);
    setSearch("");
    setAnio("");
    setDivision("");
    setCategoria("");
    setFamilia("");
    setFeedback(null);
  };

  const openCreate = async () => {
    const next = emptyForm();
    if ((catalogos.tipos_documentos || []).length === 1) {
      next.id_tipo_documento = String(catalogos.tipos_documentos[0].id_tipo_documento);
    } else {
      const dni = (catalogos.tipos_documentos || []).find((item) => item.sigla === "DNI");
      if (dni) next.id_tipo_documento = String(dni.id_tipo_documento);
    }
    setForm(next);
    setFormTab(FORM_TAB_PERSONAL);
    setFormModal({ mode: "create" });
  };

  const openEdit = async (item) => {
    try {
      const result = await alumnosApi.obtener(item.id_alumno);
      setForm(formFromItem(result.item));
      setFormTab(FORM_TAB_PERSONAL);
      setFormModal({ mode: "edit" });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message });
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.apellido.trim() || !form.id_tipo_documento || !form.num_documento.trim()) {
      setFeedback({ type: "error", message: "Completá apellido, tipo y número de documento." });
      return;
    }
    setSaving(true);
    try {
      const response = await alumnosApi.guardar(normalizePayload(form));
      setFeedback({ type: "success", message: response.mensaje || "Alumno guardado correctamente." });
      setFormModal(null);
      await cargar();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo guardar el alumno." });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (item) => {
    setDetailTab(INFO_TAB_GENERAL);
    setDetailModal({ loading: true, data: null });
    try {
      const result = await alumnosApi.obtener(item.id_alumno);
      setDetailModal({ loading: false, data: result });
    } catch (requestError) {
      setDetailModal(null);
      setFeedback({ type: "error", message: requestError.message });
    }
  };

  const changeState = async ({ row, mode, tipo, motivo }) => {
    if (!row?.id_alumno) {
      return { ok: false, mensaje: "No hay un alumno seleccionado." };
    }

    setSavingId(row.id_alumno);
    try {
      const response = mode === "reactivar"
        ? await alumnosApi.reactivar({ id: row.id_alumno })
        : mode === "reclasificar"
          ? await alumnosApi.reclasificar({ id: row.id_alumno, tipo })
          : await alumnosApi.darBaja({
              id: row.id_alumno,
              motivo: String(motivo || "").trim(),
              tipo_baja: tipo,
            });
      await cargar({ silent: true });
      return response;
    } catch (requestError) {
      throw requestError;
    } finally {
      setSavingId(null);
    }
  };

  const eliminarAlumno = async ({ motivo }) => {
    if (!deleteModal) return { ok: false, mensaje: "No hay un alumno seleccionado." };
    setSavingId(deleteModal.id_alumno);
    try {
      const response = await alumnosApi.eliminarDefinitivo({
        id: deleteModal.id_alumno,
        motivo,
      });
      await cargar({ silent: true });
      return response;
    } catch (requestError) {
      throw requestError;
    } finally {
      setSavingId(null);
    }
  };


  const reclasificarAlumno = (item) => {
    setStateModal({
      mode: "reclasificar",
      row: item,
      initialType: view === "bajas" ? "EGRESO" : "BAJA",
    });
  };

  const fetchAllRows = async (targetView) => {
    const request = targetView === "activos" ? alumnosApi.listar : alumnosApi.listarEgresados;
    const baseParams = {
      buscar: search,
      id_anio: anio,
      id_division: division,
      ...(targetView === "activos"
        ? { id_categoria: categoria, id_familia: familia }
        : { tipo: targetView === "bajas" ? "BAJA" : "EGRESO" }),
      por_pagina: 200,
    };

    const rows = [];
    let currentPage = 1;
    let totalPages = 1;
    do {
      const response = await request({ ...baseParams, pagina: currentPage });
      rows.push(...(response.items || []));
      totalPages = Math.max(1, Number(response.paginacion?.total_paginas || 1));
      currentPage += 1;
    } while (currentPage <= totalPages);

    return rows;
  };

  const openExportModal = async () => {
    setPreparingExport(true);
    try {
      const [activos, bajas, egresados] = await Promise.all([
        fetchAllRows("activos"),
        fetchAllRows("bajas"),
        fetchAllRows("egresados"),
      ]);
      const allSections = [
        exportSection("activos", activos),
        exportSection("bajas", bajas),
        exportSection("egresados", egresados),
      ];
      const currentRows = view === "activos" ? activos : view === "bajas" ? bajas : egresados;
      setExportCurrentSections([exportSection(view, currentRows)]);
      setExportAllSections(allSections);
      setExportOpen(true);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo preparar la exportación." });
    } finally {
      setPreparingExport(false);
    }
  };

  const openImportModal = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportCycle(String(suggestedAcademicCycle()));
    setImportModalOpen(true);
  };

  const importarExcel = async (event) => {
    event.preventDefault();
    if (!importFile) {
      setFeedback({ type: "error", message: "Seleccioná primero el archivo del padrón." });
      return;
    }

    setImporting(true);
    try {
      if (!importPreview) {
        const preview = await alumnosApi.previsualizarImportacion(importFile, importCycle);
        setImportPreview(preview);
        return;
      }

      const response = await alumnosApi.importarExcel(importFile, importPreview.firma, importCycle);
      const summary = [
        `${response.nuevos || 0} nuevos`,
        `${response.actualizados || 0} actualizados`,
        `${response.reactivados || 0} reactivados`,
        `${response.bajas || 0} bajas`,
        `${response.egresados || 0} egresados`,
        `${response.ingresantes_confirmados || 0} ingresantes vinculados`,
        `${response.matriculas_migradas || 0} matrículas migradas`,
        `${response.matriculas_existentes || 0} matrículas ya existentes`,
      ].join(" · ");
      setImportModalOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setFeedback({ type: "success", message: `Padrón sincronizado: ${summary}.` });
      await cargar();
    } catch (requestError) {
      const errors = requestError?.data?.detalles?.errores || [];
      const detail = errors.length ? ` ${errors.slice(0, 3).join(" ")}` : "";
      setImportPreview(null);
      setFeedback({ type: "error", message: `${requestError.message || "No se pudo importar el padrón."}${detail}` });
    } finally {
      setImporting(false);
    }
  };

  const viewTabs = {
    key: "vista",
    type: "tabs",
    label: "Alumnos",
    value: view,
    onChange: changeView,
    options: [
      { value: "activos", label: "Activos", count: resumen.activos ?? 0 },
      { value: "bajas", label: "Bajas", count: resumen.bajas ?? 0 },
      { value: "egresados", label: "Egresados", count: resumen.egresados ?? 0 },
    ],
  };

  const activeFilters = [
    {
      key: "buscar",
      type: "search",
      label: "Buscar alumno",
      value: search,
      onChange: changeFilter(setSearch),
      placeholder: "Apellido, nombre, documento, teléfono o familia...",
      className: "socios-mainSearch",
    },
    {
      key: "anio",
      type: "select",
      label: "Año",
      value: anio,
      onChange: changeFilter(setAnio),
      placeholder: "TODOS",
      options: (catalogos.anios || []).map((item) => ({ value: item.id_anio, label: item.nombre_anio })),
    },
    {
      key: "division",
      type: "select",
      label: "División",
      value: division,
      onChange: changeFilter(setDivision),
      placeholder: "TODAS",
      options: (catalogos.divisiones || []).map((item) => ({ value: item.id_division, label: item.nombre_division })),
    },
    {
      key: "categoria",
      type: "select",
      label: "Categoría",
      value: categoria,
      onChange: changeFilter(setCategoria),
      placeholder: "TODAS",
      options: (catalogos.categorias || []).map((item) => ({ value: item.id_categoria, label: item.nombre_categoria })),
    },
    {
      key: "familia",
      type: "select",
      label: "Familia",
      value: familia,
      onChange: changeFilter(setFamilia),
      placeholder: "TODAS",
      options: (catalogos.familias || []).map((item) => ({ value: item.id_familia, label: item.nombre_familia })),
    },
  ];

  const inactiveFilters = [
    {
      key: "buscar",
      type: "search",
      label: "Buscar alumno",
      value: search,
      onChange: changeFilter(setSearch),
      placeholder: "Apellido, nombre, documento, domicilio o teléfono...",
      className: "socios-mainSearch",
    },
    {
      key: "anio",
      type: "select",
      label: "Último año",
      value: anio,
      onChange: changeFilter(setAnio),
      placeholder: "TODOS",
      options: (catalogos.anios || []).map((item) => ({ value: item.id_anio, label: item.nombre_anio })),
    },
    {
      key: "division",
      type: "select",
      label: "División",
      value: division,
      onChange: changeFilter(setDivision),
      placeholder: "TODAS",
      options: (catalogos.divisiones || []).map((item) => ({ value: item.id_division, label: item.nombre_division })),
    },
  ];

  const pageFilters = [viewTabs, ...(view === "activos" ? activeFilters : inactiveFilters)];

  const activeColumns = [
    "Apellido y nombre",
    { label: "Documento", align: "center" },
    "Domicilio",
    "Localidad / Teléfono",
    { label: "Curso", align: "center", className: "global-courseColumn" },
    { label: "Acciones", align: "center" },
  ];
  const bajaColumns = [
    "Apellido y nombre",
    { label: "Documento", align: "center" },
    "Domicilio",
    "Localidad / Teléfono",
    { label: "Curso", align: "center", className: "global-courseColumn" },
    "Fecha de baja",
    "Motivo",
    { label: "Acciones", align: "center" },
  ];
  const egresoColumns = [
    "Apellido y nombre",
    { label: "Documento", align: "center" },
    "Domicilio",
    "Localidad / Teléfono",
    { label: "Curso", align: "center", className: "global-courseColumn" },
    { label: "Fecha de egreso", align: "center" },
    { label: "Promoción", align: "center" },
    { label: "Acciones", align: "center" },
  ];
  const columns = view === "activos" ? activeColumns : view === "bajas" ? bajaColumns : egresoColumns;

  const fileActions = [
    {
      key: "exportar",
      label: preparingExport ? "Preparando..." : "Exportar",
      icon: faFileExcel,
      onClick: openExportModal,
      disabled: preparingExport || loading,
      className: "mov-btn--ghost alumnos-headAction alumnos-headAction--export",
    },
    ...(writable
      ? [{
          key: "importar",
          label: "Importar alumnos",
          icon: faFileImport,
          onClick: openImportModal,
          disabled: importing,
          className: "mov-btn--ghost alumnos-headAction alumnos-headAction--import",
        }]
      : []),
  ];

  return (
    <>
      <ModulePage
        title="Alumnos"
        description="Padrón de alumnos de la Cooperadora IPET N° 50."
        filters={pageFilters}
        tabsInTitle
        headFiltersInActions
        headFiltersClassName="socios-headFilters"
        primaryActionLabel="Nuevo alumno"
        primaryActionClassName="alumnos-headAction alumnos-headAction--new"
        onPrimaryAction={view === "activos" && writable ? openCreate : undefined}
        canCreate={view === "activos" && writable}
        secondaryActions={fileActions}
        className="socios-page"
      >
        <GlobalDivTable
          className="socios-table has-bottom-pagination"
          gridClassName={view === "activos" ? "socios-grid" : "alumnos-inactive-grid"}
          ariaLabel={view === "activos" ? "Listado de alumnos activos" : view === "bajas" ? "Listado de alumnos dados de baja" : "Listado de alumnos egresados"}
          columns={columns}
          loading={loading}
          loadingLabel={view === "activos" ? "Cargando alumnos..." : view === "bajas" ? "Cargando bajas..." : "Cargando egresados..."}
          empty={!loading && !items.length}
        >
          {!loading && error ? (
            <div className="module-empty"><strong>{error}</strong></div>
          ) : null}
          {!loading && !error && !items.length ? (
            <div className="module-empty"><TableEmptyIcon />
              <strong>{view === "activos" ? "Sin alumnos para mostrar" : view === "bajas" ? "Sin alumnos dados de baja" : "Sin alumnos egresados"}</strong>
              <span>{view === "activos" ? "Cambiá los filtros o creá un nuevo alumno." : "Cambiá los filtros para consultar otros alumnos."}</span>
            </div>
          ) : null}

          {!loading && !error && view === "activos"
            ? items.map((item) => (
                <div
                  className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row socios-grid"
                  key={item.id_alumno}
                >
                  <div className="mov-gridCell entity-main-cell alumnos-nameCell">
                    <strong>{item.nombre_completo}</strong>
                    {item.nombre_familia ? <span>{item.nombre_familia}</span> : null}
                  </div>
                  <div className="mov-gridCell is-center alumnos-documentCell">
                    <strong>{item.num_documento || "—"}</strong>
                  </div>
                  <div className="mov-gridCell"><span>{item.domicilio || "—"}</span></div>
                  <div className="mov-gridCell is-center alumnos-contactLocationCell">
                    <strong>{item.localidad || "—"}</strong>
                    <span>{item.telefono || "SIN TELÉFONO"}</span>
                  </div>
                  <div className="mov-gridCell is-center alumnos-courseCell global-courseColumn">
                    <strong>{[item.nombre_anio, item.nombre_division].filter(Boolean).join(" ") || "SIN CURSO"}</strong>
                  </div>
                  <div className="mov-gridCell mov-actionsInline is-center">
                    <button className="mov-iconBtn" type="button" title="Ver información" onClick={() => openDetail(item)}>
                      <FontAwesomeIcon icon={faCircleInfo} />
                    </button>
                    {writable ? (
                      <button className="mov-iconBtn" type="button" title="Editar" onClick={() => openEdit(item)}>
                        <FontAwesomeIcon icon={faPen} />
                      </button>
                    ) : null}
                    {writable ? (
                      <button
                        className="mov-iconBtn mov-iconBtn--danger"
                        type="button"
                        title="Dar de baja"
                        onClick={() => {
                          setStateModal({
                            mode: "salida",
                            row: item,
                            initialType: Number(item.id_anio) === 7 ? "EGRESO" : "BAJA",
                          });
                        }}
                      >
                        <FontAwesomeIcon icon={faUserSlash} />
                      </button>
                    ) : null}
                    {writable ? (
                      <button
                        className="mov-iconBtn mov-iconBtn--danger"
                        type="button"
                        title="Eliminar alumno"
                        disabled={savingId === item.id_alumno}
                        onClick={() => setDeleteModal(item)}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            : null}

          {!loading && !error && view !== "activos"
            ? items.map((item) => (
                <div
                  className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row alumnos-inactive-grid"
                  key={item.id_alumno}
                >
                  <div className="mov-gridCell entity-main-cell alumnos-nameCell">
                    <strong>{item.nombre_completo}</strong>
                    {item.nombre_familia ? <span>{item.nombre_familia}</span> : null}
                  </div>
                  <div className="mov-gridCell is-center alumnos-documentCell">
                    <strong>{item.num_documento || "—"}</strong>
                  </div>
                  <div className="mov-gridCell"><span>{item.domicilio || "—"}</span></div>
                  <div className="mov-gridCell is-center alumnos-contactLocationCell">
                    <strong>{item.localidad || "—"}</strong>
                    <span>{item.telefono || "SIN TELÉFONO"}</span>
                  </div>
                  <div className="mov-gridCell is-center alumnos-courseCell global-courseColumn">
                    <strong>{[item.nombre_anio, item.nombre_division].filter(Boolean).join(" ") || "SIN CURSO"}</strong>
                  </div>
                  <div className="mov-gridCell is-center">{formatDate(view === "egresados" ? item.fecha_egreso : item.actualizado_en)}</div>
                  <div className={view === "bajas" ? "mov-gridCell" : "mov-gridCell is-center"}>
                    <span>{view === "bajas" ? (item.motivo || "BAJA") : (item.promocion || "—")}</span>
                  </div>
                  <div className="mov-gridCell mov-actionsInline is-center">
                    <button className="mov-iconBtn" type="button" title="Ver información" onClick={() => openDetail(item)}>
                      <FontAwesomeIcon icon={faCircleInfo} />
                    </button>
                    {writable ? (
                      <button
                        className="mov-iconBtn"
                        type="button"
                        title={view === "bajas" ? "Reclasificar como Egresado" : "Reclasificar como Baja"}
                        disabled={savingId === item.id_alumno}
                        onClick={() => reclasificarAlumno(item)}
                      >
                        <FontAwesomeIcon icon={faArrowRightArrowLeft} />
                      </button>
                    ) : null}
                    {writable ? (
                      <button
                        className="mov-iconBtn"
                        type="button"
                        title="Reactivar"
                        disabled={savingId === item.id_alumno}
                        onClick={() => setStateModal({ mode: "reactivar", row: item, initialType: "BAJA" })}
                      >
                        <FontAwesomeIcon icon={faRotateLeft} />
                      </button>
                    ) : null}
                    {writable ? (
                      <button
                        className="mov-iconBtn mov-iconBtn--danger"
                        type="button"
                        title="Eliminar alumno"
                        disabled={savingId === item.id_alumno}
                        onClick={() => setDeleteModal(item)}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            : null}
        </GlobalDivTable>

        <GlobalPagination
          className="alumnos-tableFooter"
          currentPage={Number(paginacion?.pagina || page)}
          totalPages={Number(paginacion?.total_paginas || 0)}
          totalRecords={Number(paginacion?.total || 0)}
          from={Number(paginacion?.desde || 0)}
          to={Number(paginacion?.hasta || 0)}
          loading={loading}
          itemLabel="alumnos"
          ariaLabel="Paginación de alumnos"
          onPageChange={setPage}
          leftContent={(
            <div className="alumnos-footerActions" aria-label="Acciones de alumnos">
              {view === "activos" && writable ? (
                <button
                  type="button"
                  className="alumnos-footerAction alumnos-footerAction--nuevo"
                  onClick={openCreate}
                >
                  <FontAwesomeIcon icon={faPlus} />
                  <span>Nuevo alumno</span>
                </button>
              ) : null}

              {fileActions.map((action) => (
                <button
                  type="button"
                  className={`alumnos-footerAction alumnos-footerAction--${action.key}`}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  key={`footer-${action.key}`}
                >
                  <FontAwesomeIcon icon={action.icon} />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}
        />
      </ModulePage>

      <CrudModal
        open={Boolean(formModal)}
        title={form.id_alumno ? "Editar alumno" : "Nuevo alumno"}
        subtitle="Datos del padrón de Cooperadora V2."
        onClose={() => !saving && setFormModal(null)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_alumno ? "Guardar cambios" : "Crear alumno"}
        wide
        modalClassName="socios-modal socios-modal--form"
      >
        <AlumnoForm form={form} setForm={setForm} catalogs={catalogos} tab={formTab} setTab={setFormTab} />
      </CrudModal>

      <InfoModal
        open={Boolean(detailModal)}
        title="Ficha del alumno"
        subtitle={detailModal?.data?.item?.nombre_completo || "Consultando datos..."}
        onClose={() => setDetailModal(null)}
        loading={Boolean(detailModal?.loading)}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        tabs={[
          { value: INFO_TAB_GENERAL, label: "General" },
          { value: INFO_TAB_PAGOS, label: "Pagos", badge: detailModal?.data?.pagos?.length || null },
          { value: INFO_TAB_HISTORIAL, label: "Historial", badge: detailModal?.data?.historial?.length || null },
        ]}
      >
        {detailModal?.data ? (
          <div className="socios-info-content">
            {detailTab === INFO_TAB_GENERAL ? (
              <>
                <InfoSummary
                  items={[
                    { label: "Estado", value: detailModal.data.item.activo ? "ACTIVO" : (detailModal.data.item.tipo_baja === "EGRESO" ? "EGRESADO" : "BAJA"), icon: detailModal.data.item.activo ? faCheck : faUserSlash, tone: detailModal.data.item.activo ? "success" : "danger" },
                    { label: "Curso", value: detailModal.data.item.curso || "SIN CURSO", icon: faBookOpen },
                    { label: "Familia", value: detailModal.data.item.nombre_familia || "SIN FAMILIA", icon: faHouse },
                    { label: "Categoría", value: detailModal.data.item.categoria_monto || detailModal.data.item.categoria || "—", icon: faUsers },
                  ]}
                />
                <InfoSection title="Datos personales" icon={faUser}>
                  <InfoRow title="Documento" detail={`${detailModal.data.item.tipo_documento_sigla || ""} ${detailModal.data.item.num_documento || "—"}`.trim()} />
                  <InfoRow title="Sexo" detail={detailModal.data.item.sexo || "—"} />
                  <InfoRow title="Nacimiento" detail={`${formatDate(detailModal.data.item.fecha_nacimiento)} · ${detailModal.data.item.lugar_nacimiento || "SIN LUGAR"}`} />
                  <InfoRow title="Domicilio" detail={[detailModal.data.item.domicilio, detailModal.data.item.localidad, detailModal.data.item.cp].filter(Boolean).join(" · ") || "—"} />
                  <InfoRow title="Teléfono" detail={detailModal.data.item.telefono || "—"} />
                  <InfoRow title="Ingreso" detail={formatDate(detailModal.data.item.ingreso)} />
                  <InfoRow title="Cuota" detail={`${formatMoney(detailModal.data.item.monto_mensual)} mensual · ${formatMoney(detailModal.data.item.monto_anual)} anual`} />
                  {detailModal.data.item.observaciones ? <InfoRow title="Observaciones" detail={detailModal.data.item.observaciones} /> : null}
                  {!detailModal.data.item.activo && detailModal.data.item.motivo ? <InfoRow title="Motivo de baja" detail={detailModal.data.item.motivo} tone="danger" /> : null}
                </InfoSection>
              </>
            ) : null}

            {detailTab === INFO_TAB_PAGOS ? (
              <>
                <InfoSummary
                  items={[
                    { label: "Registros", value: detailModal.data.resumen_pagos?.cantidad || 0 },
                    { label: "Total pagado", value: formatMoney(detailModal.data.resumen_pagos?.total_pagado || 0) },
                    { label: "Último pago", value: formatDate(detailModal.data.resumen_pagos?.ultimo_pago) },
                  ]}
                />
                <InfoSection title="Últimos pagos" badge={detailModal.data.pagos.length}>
                  {detailModal.data.pagos.length ? detailModal.data.pagos.map((payment) => (
                    <InfoRow
                      key={payment.id_pago}
                      title={`${payment.mes || `Mes ${payment.id_mes}`} ${payment.anio_aplicado}`}
                      detail={`${payment.estado.toUpperCase()} · ${payment.medio_pago || "SIN MEDIO"}`}
                      meta={`${formatDate(payment.fecha_pago)} · ${formatMoney(payment.monto_pago)}`}
                      tone={payment.estado === "condonado" ? "warning" : "success"}
                    />
                  )) : <InfoEmpty>El alumno no registra pagos.</InfoEmpty>}
                </InfoSection>
              </>
            ) : null}

            {detailTab === INFO_TAB_HISTORIAL ? (
              <InfoSection title="Cambios auditados" badge={detailModal.data.historial.length}>
                {detailModal.data.historial.length ? detailModal.data.historial.map((entry) => (
                  <InfoRow
                    key={entry.id_auditoria}
                    title={entry.etiqueta || "Cambio en el alumno"}
                    detail={entry.detalle || "Se actualizó información del alumno."}
                    meta={`${entry.usuario || "SISTEMA"} · ${formatDateTime(entry.creado_en)}`}
                  />
                )) : <InfoEmpty>Sin cambios auditados para este alumno.</InfoEmpty>}
              </InfoSection>
            ) : null}
          </div>
        ) : null}
      </InfoModal>

      <ModalCambioEstadoGlobal
        open={Boolean(stateModal)}
        row={stateModal?.row || null}
        mode={stateModal?.mode || "salida"}
        initialType={stateModal?.initialType || "BAJA"}
        loading={Boolean(stateModal?.row && savingId === stateModal.row.id_alumno)}
        onClose={() => setStateModal(null)}
        onConfirm={changeState}
        onToast={(tipo, mensaje) => {
          if (tipo === "exito") setFeedback({ type: "success", message: mensaje });
          if (tipo === "error") setFeedback({ type: "error", message: mensaje });
        }}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal}
        title="Eliminar alumno"
        message="El alumno dejará de aparecer en el padrón operativo y se guardará una copia completa en alumnos_eliminados para conservar la trazabilidad."
        warning="Los pagos, ventas y demás movimientos históricos NO se borran. El alumno conserva internamente su mismo ID para que todo el historial financiero siga relacionado correctamente."
        details={[
          { label: "Alumno", value: deleteModal?.nombre_completo || "—" },
          { label: "Documento", value: [deleteModal?.tipo_documento_sigla, deleteModal?.num_documento].filter(Boolean).join(" ") || "—" },
          { label: "Estado actual", value: deleteModal ? (deleteModal.activo ? "ACTIVO" : (view === "egresados" ? "EGRESADO" : "BAJA")) : "—" },
        ]}
        showReason
        reasonRequired
        reasonLabel="Motivo de eliminación *"
        reasonPlaceholder="Ej.: registro duplicado, alumno cargado por error..."
        confirmLabel="Eliminar alumno"
        loadingLabel="Eliminando..."
        successMessage="Alumno eliminado correctamente. La trazabilidad quedó guardada."
        errorMessage="No se pudo eliminar el alumno."
        onConfirm={eliminarAlumno}
        onClose={() => setDeleteModal(null)}
        onToast={(tipo, mensaje) => {
          if (tipo === "exito") setFeedback({ type: "success", message: mensaje });
          if (tipo === "error") setFeedback({ type: "error", message: mensaje });
        }}
      />

      <CrudModal
        open={importModalOpen}
        title="Importar padrón de alumnos"
        subtitle={importPreview ? "Revisá el impacto y confirmá la sincronización." : "Seleccioná el archivo y revisá las reglas antes de sincronizar."}
        onClose={() => {
          if (importing) return;
          setImportModalOpen(false);
          setImportFile(null);
          setImportPreview(null);
        }}
        onSubmit={importarExcel}
        submitLabel={importing ? (importPreview ? "Importando..." : "Analizando...") : (importPreview ? "Confirmar importación" : "Importar")}
        submitDisabled={!importFile || importing}
        hideCancel={importing}
        modalClassName="alumnos-importModal"
      >
        <div className="alumnos-importRules">
          <div className="alumnos-importRules__intro">
            <strong>Reglas de sincronización</strong>
            <span>El archivo se toma como el padrón completo actual de la escuela. Antes de aplicar cambios se muestra una vista previa obligatoria.</span>
          </div>
          <ul>
            <li><b>Documento es la clave:</b> si ya existe, se actualizan sus datos y se reactiva si estaba en Baja o Egresados.</li>
            <li><b>Documento nuevo:</b> se agrega automáticamente como alumno Activo.</li>
            <li><b>Tipo de documento:</b> si la columna TIPO DOCUMENTO no está, los existentes conservan su tipo y los nuevos se crean como DNI.</li>
            <li><b>Activo que no aparece:</b> pasa a Baja; si estaba en 7°, pasa automáticamente a Egresados.</li>
            <li><b>Baja y Egreso son distintos:</b> una baja por cambio de escuela no genera un egreso.</li>
            <li><b>No se borran pagos ni historial:</b> el alumno permanece en la base y conserva toda su trazabilidad.</li>
            <li><b>Ingresantes:</b> si un DNI de Ingresantes aparece en el padrón del ciclo actual, se vincula al mismo alumno y la matrícula pagada pasa a Pagos sin duplicarse. Un ciclo futuro se puede previsualizar, pero no activar antes de tiempo.</li>
            <li><b>Columnas obligatorias:</b> APELLIDO Y NOMBRE (o APELLIDO), DOCUMENTO, DOMICILIO, LOCALIDAD, AÑO y DIVISIÓN.</li>
            <li><b>Columnas opcionales:</b> NOMBRE, TIPO DOCUMENTO, TELÉFONO y CP.</li>
          </ul>

          <label className="alumnos-importCycle">
            <span>Ciclo lectivo del padrón</span>
            <input
              type="number"
              min="2020"
              max="2100"
              value={importCycle}
              disabled={importing}
              onChange={(event) => {
                setImportCycle(event.target.value);
                setImportPreview(null);
              }}
            />
            <small>Se usa para vincular ingresantes y llevar la matrícula al ciclo correcto.</small>
          </label>

          <label className="alumnos-importFile">
            <span>Archivo del padrón</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={importing}
              onChange={(event) => {
                setImportFile(event.target.files?.[0] || null);
                setImportPreview(null);
              }}
            />
            <strong>{importFile ? importFile.name : "Ningún archivo seleccionado"}</strong>
            <small>Formatos admitidos: .xlsx y .csv</small>
          </label>

          {importPreview ? (
            <section className="alumnos-importPreview" aria-live="polite">
              <div className="alumnos-importPreview__title">
                <strong>Vista previa del impacto</strong>
                <span>Ningún cambio se aplicó todavía.</span>
              </div>
              <div className="alumnos-importPreview__grid">
                <div><strong>{importPreview.resumen?.leidos || 0}</strong><span>leídos</span></div>
                <div><strong>{importPreview.resumen?.nuevos || 0}</strong><span>nuevos</span></div>
                <div><strong>{importPreview.resumen?.actualizados || 0}</strong><span>actualizados</span></div>
                <div><strong>{importPreview.resumen?.reactivados || 0}</strong><span>reactivados</span></div>
                <div className="is-warning"><strong>{importPreview.resumen?.bajas || 0}</strong><span>bajas</span></div>
                <div className="is-warning"><strong>{importPreview.resumen?.egresados || 0}</strong><span>egresados</span></div>
                <div><strong>{importPreview.resumen?.ingresantes_a_confirmar || 0}</strong><span>ingresantes</span></div>
                <div><strong>{importPreview.resumen?.matriculas_a_migrar || 0}</strong><span>matrículas</span></div>
              </div>
              {(importPreview.advertencias || []).length ? (
                <div className="alumnos-importPreview__warnings">
                  {(importPreview.advertencias || []).map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
                </div>
              ) : null}
              <p className="alumnos-importPreview__confirm">Confirmá solamente si este archivo representa el padrón completo actual.</p>
            </section>
          ) : null}
        </div>
      </CrudModal>

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar alumnos"
        subtitle="Elegí si querés exportar la pestaña actual o las tres pestañas y seleccioná Excel o PDF."
        tituloArchivo="Alumnos - Cooperadora IPET N° 50"
        subtituloArchivoActual={view === "activos" ? "Activos" : view === "bajas" ? "Bajas" : "Egresados"}
        subtituloArchivoTodos="Activos, Bajas y Egresados"
        nombreArchivo="alumnos_cooperadora"
        logoPdfUrl={logoCooperadoraPdf}
        seccionesActuales={exportCurrentSections}
        seccionesTodos={exportAllSections}
        cantidadActual={exportCurrentSections.reduce((total, section) => total + (section.registros?.length || 0), 0)}
        cantidadTodos={exportAllSections.reduce((total, section) => total + (section.registros?.length || 0), 0)}
        mostrarAlcanceTodos
        defaultAlcance="actual"
        alcanceActualLabel="Exportar pestaña actual"
        alcanceActualDescription="Exporta todos los alumnos de la pestaña seleccionada que coinciden con los filtros actuales."
        alcanceTodosLabel="Exportar las tres pestañas"
        alcanceTodosDescription="Exporta Activos, Bajas y Egresados en el mismo archivo, separados por sección/pestaña."
        totalLabelSingular="alumno disponible"
        totalLabelPlural="alumnos disponibles"
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => setFeedback({ type: "success", message })}
        onError={(message) => setFeedback({ type: "error", message })}
      />

      <ModuleFeedback
        type={feedback?.type}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
