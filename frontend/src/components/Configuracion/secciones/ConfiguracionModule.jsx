import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBarsStaggered,
  faChevronRight,
  faFileLines,
  faGear,
  faIdCard,
  faPen,
  faTags,
  faTrashCan,
  faTruck,
  faUserTie,
  faUsers,
  faVenusMars,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import DataTableSkeleton from "../../Global/DataTableSkeleton";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { useSmartScrollRefresh } from "../../Global/useSmartScrollRefresh";
import { canWrite } from "../../_shared/auth/session";
import { configuracionApi } from "../api/configuracionApi";
import { useConfiguracion } from "../hooks/useConfiguracion";
import { useTableScrollbarCompensation } from "../../Global/useTableScrollbarCompensation";
import "../configuracion.css";
import "./CatalogosConfiguracion.css";

const LIST_META = {
  contable_categoria: {
    label: "categoría contable",
    title: "Categorías",
    description: "Categorías usadas para clasificar ingresos y egresos.",
    icon: faTags,
    fields: [{ key: "nombre", label: "Nombre", maxLength: 120 }],
    display: (item) => ({ primary: item.nombre, secondary: "Categoría contable" }),
  },
  contable_descripcion: {
    label: "descripción contable",
    title: "Descripciones",
    description: "Descripciones reutilizables de los movimientos contables.",
    icon: faFileLines,
    fields: [{ key: "nombre", label: "Descripción", maxLength: 160 }],
    display: (item) => ({ primary: item.nombre, secondary: "Descripción contable" }),
  },
  contable_proveedor: {
    label: "proveedor",
    title: "Proveedores",
    description: "Proveedores disponibles para ingresos y egresos.",
    icon: faTruck,
    fields: [{ key: "nombre", label: "Proveedor", maxLength: 120 }],
    display: (item) => ({ primary: item.nombre, secondary: "Proveedor contable" }),
  },
  sexo: {
    label: "sexo",
    title: "Sexo",
    description: "Valores de sexo disponibles en la ficha de alumnos.",
    icon: faVenusMars,
    fields: [{ key: "nombre", label: "Sexo", maxLength: 50 }],
    display: (item) => ({ primary: item.nombre, secondary: "Dato de alumno" }),
  },
  tipo_documento: {
    label: "tipo de documento",
    title: "Tipos de documento",
    description: "Tipos y siglas de documento disponibles para alumnos.",
    icon: faIdCard,
    fields: [
      { key: "descripcion", label: "Descripción", maxLength: 100 },
      { key: "sigla", label: "Sigla", maxLength: 10 },
    ],
    display: (item) => ({
      primary: item.sigla || item.descripcion,
      secondary: item.descripcion || "Tipo de documento",
    }),
  },
  docentes: {
    label: "docente",
    title: "Docentes",
    description: "Administrá los docentes que aparecen en las planillas de ventas.",
    icon: faUserTie,
    fields: [
      { key: "nombre", label: "Nombre y apellido", maxLength: 100 },
      { key: "dni", label: "DNI", maxLength: 20, optional: true, type: "dni" },
      { key: "email", label: "Correo electrónico", maxLength: 150, optional: true, type: "email" },
    ],
    display: (item) => ({
      primary: item.nombre,
      secondary: item.email || "Docente",
    }),
  },
};

const VALID_LISTS = Object.keys(LIST_META);
const DEFAULT_LIST = "contable_categoria";

function normalizeList(value) {
  return VALID_LISTS.includes(value) ? value : DEFAULT_LIST;
}

function emptyForm(listKey) {
  const form = { id: "", lista: listKey, activo: true, motivo: "" };
  LIST_META[listKey].fields.forEach((field) => {
    form[field.key] = "";
  });
  return form;
}

function normalizeInput(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .toLocaleUpperCase("es-AR");
}

function normalizeFieldInput(value, field) {
  if (field.type === "dni") return String(value ?? "").replace(/[^0-9]/g, "").slice(0, field.maxLength);
  if (field.type === "email") return String(value ?? "").trimStart().toLowerCase().slice(0, field.maxLength);
  return normalizeInput(value, field.maxLength);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

function AccessCard({ title, description, icon, status, area, detail, onClick }) {
  return (
    <button type="button" className="config-accessCard" onClick={onClick}>
      <span className="config-accessCard__icon" aria-hidden="true">
        <FontAwesomeIcon icon={icon} />
      </span>
      <strong className="config-accessCard__title">{title}</strong>
      <span className="config-accessCard__status">{status}</span>
      <span className="config-accessCard__description">{description}</span>
      <span className="config-accessCard__meta">
        <span><small>ÁREA</small>{area}</span>
        <span><small>GESTIÓN</small>{detail}</span>
      </span>
      <span className="config-accessCard__arrow" aria-hidden="true">
        <FontAwesomeIcon icon={faChevronRight} />
      </span>
    </button>
  );
}

function ConfigurationHome() {
  const navigate = useNavigate();
  const cards = [
    {
      id: "usuarios",
      title: "Usuarios y roles",
      description: "Creá, editá, eliminá o desactivá usuarios y definí el rol de cada acceso.",
      icon: faUsers,
      status: "Seguridad",
      area: "Usuarios",
      detail: "Administradores y solo lectura",
      path: "/configuracion/usuarios",
    },
    {
      id: "tablas",
      title: "Tablas auxiliares",
      description: "Personalizá categorías, descripciones, proveedores, sexo, documentos y docentes.",
      icon: faBarsStaggered,
      status: "6 tablas",
      area: "Datos maestros",
      detail: "Altas, edición y eliminación segura",
      path: "/configuracion/catalogos?lista=contable_categoria",
    },
  ];

  return (
    <section className="config-homePage">
      <header className="config-homeIntro">
        <span className="config-homeIntro__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faGear} />
        </span>
        <div>
          <small>CONFIGURACIÓN DEL SISTEMA</small>
          <strong>Administración y configuración general</strong>
          <p>Gestioná los accesos del sistema y las tablas auxiliares usadas por Cooperadora.</p>
        </div>
      </header>

      <nav className="config-accessGrid config-accessGrid--compact" aria-label="Secciones de configuración">
        {cards.map((card) => (
          <AccessCard key={card.id} {...card} onClick={() => navigate(card.path)} />
        ))}
      </nav>
    </section>
  );
}

function CatalogTable({ items, loading, meta, writable, onEdit, onDelete, externalBodyRef }) {
  const isTeachers = meta.title === "Docentes";
  const { bodyRef, hasVerticalScroll, scrollbarWidth } = useTableScrollbarCompensation();
  const setBodyRef = useCallback((node) => {
    bodyRef(node);
    if (externalBodyRef) externalBodyRef.current = node;
  }, [bodyRef, externalBodyRef]);

  return (
    <div
      className={`config-catalogTable global-scrollAwareTable ${isTeachers ? "config-catalogTable--docentes" : ""} ${hasVerticalScroll ? "has-y-scroll" : ""}`.trim()}
      role="table"
      aria-label={meta.title}
      aria-busy={loading}
      style={{ "--global-table-scrollbar-width": `${scrollbarWidth}px` }}
    >
      <div className="config-catalogTable__head global-scrollAwareTable__head" role="row">
        <span role="columnheader">{isTeachers ? "Docente" : "Opción"}</span>
        <span role="columnheader">{isTeachers ? "DNI" : "Uso"}</span>
        <span role="columnheader">{isTeachers ? "Estado" : "Creación"}</span>
        <span className="config-catalogTable__actionsHeading" role="columnheader">Acciones</span>
      </div>
      <div ref={setBodyRef} className="config-catalogTable__body global-scrollAwareTable__body" role="rowgroup">
        {loading ? (
          <DataTableSkeleton
            actionColumnIndex={3}
            columnCount={4}
            gridClassName="config-catalogTable__skeletonRow"
            rows={6}
          />
        ) : null}

        {!loading && items.map((item) => {
          const display = meta.display(item);
          const uses = Number(item.cantidad_usos || 0);
          return (
            <div className={`config-catalogTable__row ${isTeachers && !Number(item.activo) ? "is-inactive" : ""}`} role="row" key={item.id}>
              <div className="config-catalogIdentity" role="cell">
                <span className="config-catalogIdentity__icon" aria-hidden="true">
                  <FontAwesomeIcon icon={meta.icon} />
                </span>
                <div>
                  <strong>{display.primary}</strong>
                  <small>{display.secondary}</small>
                </div>
              </div>
              {isTeachers ? (
                <>
                  <div className="config-catalogDni" role="cell" data-label="DNI">{item.dni || "SIN DNI"}</div>
                  <div className="config-catalogTeacherState" role="cell" data-label="Estado">
                    <span className={`config-catalogState ${Number(item.activo) ? "" : "is-inactive"}`}>
                      <i aria-hidden="true" />{Number(item.activo) ? "ACTIVO" : "INACTIVO"}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="config-catalogUsage" role="cell" data-label="Uso">
                    <strong>{uses}</strong>
                    <span>{uses === 1 ? "registro asociado" : "registros asociados"}</span>
                  </div>
                  <div className="config-usersCreated" role="cell" data-label="Creación">
                    {formatDate(item.creado_en)}
                  </div>
                </>
              )}
              <div className="config-catalogActions config-catalogTable__actionsCell mov-actionsInline" role="cell">
                {writable ? (
                  <>
                    <button
                      type="button"
                      className="mov-iconBtn"
                      onClick={() => onEdit(item)}
                      title={`Editar ${meta.label}`}
                      aria-label={`Editar ${display.primary}`}
                    >
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                    <button
                      type="button"
                      className="mov-iconBtn mov-iconBtn--danger"
                      onClick={() => onDelete(item)}
                      disabled={!isTeachers && uses > 0}
                      title={!isTeachers && uses > 0 ? "No se puede eliminar porque tiene registros asociados" : "Eliminar definitivamente"}
                      aria-label={`Eliminar ${display.primary}`}
                    >
                      <FontAwesomeIcon icon={faTrashCan} />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && !items.length ? (
          <div className="config-usersEmpty">{isTeachers ? "No hay docentes que coincidan con la búsqueda." : "No hay opciones que coincidan con la búsqueda."}</div>
        ) : null}
      </div>
    </div>
  );
}

function CatalogsPanel() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialList = normalizeList(searchParams.get("lista"));
  const writable = canWrite();
  const { listas, loading, error, cargar } = useConfiguracion();
  const [activeList, setActiveList] = useState(initialList);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm(initialList));
  const [deleteModal, setDeleteModal] = useState(null);
  const { bodyRef: scrollBodyRef, captureScroll } = useSmartScrollRefresh({
    loading,
    contentKey: `${activeList}:${(listas[activeList] || []).length}`,
  });

  const meta = LIST_META[activeList];
  const items = useMemo(() => listas[activeList] || [], [listas, activeList]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    if (!term) return items;
    const plain = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
    const normalizedTerm = plain(term);
    return items.filter((item) => meta.fields.some((field) => plain(item[field.key]).includes(normalizedTerm)));
  }, [items, meta, search]);

  const refreshKeepingScroll = useCallback(async () => {
    captureScroll();
    return cargar();
  }, [captureScroll, cargar]);

  const changeList = (key) => {
    setActiveList(key);
    setSearchParams({ lista: key }, { replace: true });
    setSearch("");
    setFeedback(null);
    setForm(emptyForm(key));
  };

  const openCreate = () => {
    setFeedback(null);
    setForm(emptyForm(activeList));
    setFormOpen(true);
  };

  const openEdit = (item) => {
    const next = emptyForm(activeList);
    next.id = String(item.id);
    meta.fields.forEach((field) => {
      next[field.key] = item[field.key] || "";
    });
    if (activeList === "docentes") {
      next.activo = Number(item.activo) === 1;
      next.motivo = item.motivo || "";
    }
    setFeedback(null);
    setForm(next);
    setFormOpen(true);
  };

  const saveItem = async (event) => {
    event.preventDefault();
    const payload = { lista: activeList, id: form.id || null };
    for (const field of meta.fields) {
      const value = normalizeFieldInput(form[field.key], field).trim();
      if (!value && !field.optional) {
        setFeedback({ type: "error", message: `Completá ${field.label.toLocaleLowerCase("es-AR")}.` });
        return;
      }
      if (value && field.type === "dni" && !/^\d{6,9}$/.test(value)) {
        setFeedback({ type: "error", message: "El DNI debe tener entre 6 y 9 dígitos." });
        return;
      }
      if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setFeedback({ type: "error", message: "Ingresá un correo electrónico válido." });
        return;
      }
      payload[field.key] = value;
    }
    if (activeList === "docentes") {
      payload.activo = form.activo;
      payload.motivo = form.activo ? "" : normalizeInput(form.motivo, 250).trim();
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await configuracionApi.guardarItem(payload);
      setFormOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      await refreshKeepingScroll();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo guardar el registro." });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return { ok: false };
    setSaving(true);
    try {
      const response = await configuracionApi.eliminarItem(activeList, deleteModal.id);
      await refreshKeepingScroll();
      return response;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ModulePage
        className="config-sectionPage"
        title="Tablas auxiliares"
        description={meta.description}
        filters={[{
          key: "catalog-search",
          type: "search",
          label: "Buscar",
          value: search,
          onChange: setSearch,
          placeholder: "Buscar en la tabla...",
        }]}
        primaryActionLabel={`Nuevo ${meta.label}`}
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        secondaryActions={[{
          key: "volver",
          label: "Volver",
          icon: faArrowLeft,
          onClick: () => navigate("/configuracion"),
        }]}
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || error}
          onClose={() => setFeedback(null)}
        />

        <section className="config-catalogPanel">
          <header className="config-catalogPanel__toolbar">
            <div className="config-catalogTabsRow">
              <div className="config-catalogTabs" role="tablist" aria-label="Tablas auxiliares">
                {Object.entries(LIST_META).map(([key, option]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeList === key}
                    className={activeList === key ? "is-active" : ""}
                    onClick={() => changeList(key)}
                  >
                    <FontAwesomeIcon icon={option.icon} />
                    {option.title}
                  </button>
                ))}
              </div>
            </div>
            <strong>{loading ? "Cargando opciones..." : `Mostrando ${filteredItems.length} de ${items.length} ${activeList === "docentes" ? "docentes" : "opciones"}`}</strong>
          </header>

          <CatalogTable
            items={filteredItems}
            loading={loading}
            meta={meta}
            writable={writable}
            onEdit={openEdit}
            onDelete={setDeleteModal}
            externalBodyRef={scrollBodyRef}
          />
        </section>
      </ModulePage>

      <CrudModal
        open={formOpen}
        title={
          <>
            <FontAwesomeIcon icon={form.id ? faPen : meta.icon} aria-hidden="true" />
            <span>{`${form.id ? "Editar" : "Agregar"} ${meta.label}`}</span>
          </>
        }
        subtitle={meta.description}
        onClose={() => setFormOpen(false)}
        onSubmit={saveItem}
        saving={saving}
        submitLabel={form.id ? "Guardar cambios" : "Agregar"}
        closeOnBackdrop={false}
        modalClassName="config-catalogModal"
      >
        <div className="entity-form config-catalogForm">
          {feedback?.type === "error" ? (
            <p className="config-catalogForm__error" role="alert">{feedback.message}</p>
          ) : null}
          <div className="entity-form__grid entity-form__grid--single">
            {meta.fields.map((field, index) => (
              <div className="config-catalogField" key={field.key}>
                <FloatingField
                  label={<><FontAwesomeIcon icon={meta.icon} aria-hidden="true" />{field.label}{field.optional ? "" : " *"}</>}
                  active={Boolean(String(form[field.key] || "").trim())}
                >
                  <input
                    type={field.type === "email" ? "email" : "text"}
                    inputMode={field.type === "dni" ? "numeric" : undefined}
                    value={form[field.key] || ""}
                    placeholder=" "
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      [field.key]: normalizeFieldInput(event.target.value, field),
                    }))}
                    maxLength={field.maxLength}
                    required={!field.optional}
                    autoFocus={index === 0}
                  />
                </FloatingField>
                <div className="config-catalogField__meta">
                  <span>Máximo {field.maxLength} caracteres.</span>
                  <strong>{String(form[field.key] || "").length}/{field.maxLength}</strong>
                </div>
              </div>
            ))}
            {activeList === "docentes" ? (
              <div className="config-catalogTeacherOptions">
                <label className="config-catalogTeacherToggle">
                  <input type="checkbox" checked={Boolean(form.activo)} onChange={(event) => setForm((current) => ({ ...current, activo: event.target.checked, motivo: event.target.checked ? "" : current.motivo }))} />
                  <span>Docente activo</span>
                </label>
                <p>Solo los docentes activos aparecen en las planillas de ventas.</p>
                {!form.activo ? (
                  <FloatingField label="Motivo de inactividad (opcional)" active={Boolean(form.motivo?.trim())}>
                    <input type="text" value={form.motivo || ""} maxLength={250} placeholder=" " onChange={(event) => setForm((current) => ({ ...current, motivo: normalizeInput(event.target.value, 250) }))} />
                  </FloatingField>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal}
        title={`Eliminar ${meta.label}`}
        message={activeList === "docentes" ? "El docente se eliminará definitivamente del padrón." : "La opción se eliminará definitivamente de la tabla auxiliar."}
        warning={activeList === "docentes" ? "Esta acción no se puede deshacer. Si querés conservarlo sin incluirlo en las planillas, editá su estado a inactivo." : "Esta acción no se puede deshacer. Las opciones usadas por alumnos o movimientos contables quedan protegidas y no se pueden eliminar."}
        confirmLabel="Eliminar"
        loadingLabel="Eliminando..."
        loadingMessage="Eliminando opción…"
        successMessage="Opción eliminada correctamente."
        errorMessage="No se pudo eliminar la opción."
        details={deleteModal ? [
          { label: "Sección", value: meta.title },
          ...(activeList === "docentes" ? [
            { label: "Docente", value: deleteModal.nombre },
            { label: "DNI", value: deleteModal.dni || "SIN DNI" },
          ] : [{ label: "Registros asociados", value: Number(deleteModal.cantidad_usos || 0) }]),
        ] : []}
        onClose={() => setDeleteModal(null)}
        onConfirm={confirmDelete}
        onToast={(type, message, duration) => setFeedback({ type, message, duration })}
        loading={saving}
      />
    </>
  );
}

export default function ConfiguracionModule({ group = null }) {
  if (group === "catalogos") return <CatalogsPanel />;
  return <ConfigurationHome />;
}
