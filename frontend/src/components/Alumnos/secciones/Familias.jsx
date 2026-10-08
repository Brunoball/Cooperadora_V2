import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAddressBook,
  faCircleInfo,
  faHouse,
  faPen,
  faPlus,
  faRotateLeft,
  faTrashCan,
  faUserSlash,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import CrudModal from "../../Global/Modales/CrudModal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../../Global/Modales/InfoModal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import {
  EntityFormPanel,
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import { familiasApi } from "../api/alumnosApi";
import { useFamilias } from "../hooks/useFamilias";
import "./Familias.css";

const FORM_TAB_DETAILS = "datos";
const FORM_TAB_MEMBERS = "integrantes";

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

function emptyForm() {
  return {
    id_familia: "",
    nombre_familia: "",
    observaciones: "",
    integrantes: [],
  };
}

function formFromDetail(detail) {
  const item = detail?.item || {};
  return {
    id_familia: item.id_familia || "",
    nombre_familia: item.nombre_familia || "",
    observaciones: item.observaciones || "",
    integrantes: (detail?.integrantes || []).map((member) => member.id_alumno),
  };
}

function FamilyForm({ form, setForm, catalog = [], activeTab, onTabChange }) {
  const [memberSearch, setMemberSearch] = useState("");
  const [pendingMemberIds, setPendingMemberIds] = useState(() => new Set());

  const selectedSet = useMemo(
    () => new Set((form.integrantes || []).map(Number)),
    [form.integrantes],
  );

  const normalizedSearch = memberSearch.trim().toLocaleUpperCase("es-AR");

  const matchesSearch = (person) => {
    if (!normalizedSearch) return true;
    const haystack = [
      person.nombre_completo,
      person.apellido,
      person.nombre,
      person.num_documento,
      person.curso,
      person.categoria,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleUpperCase("es-AR");
    return haystack.includes(normalizedSearch);
  };

  const belongsToAnotherFamily = (person) => {
    const assignedFamilyId = Number(person.id_familia || 0);
    const currentFamilyId = Number(form.id_familia || 0);
    if (!assignedFamilyId) return false;
    return !currentFamilyId || assignedFamilyId !== currentFamilyId;
  };

  const available = useMemo(
    () =>
      catalog.filter(
        (person) =>
          !selectedSet.has(Number(person.id_alumno)) && matchesSearch(person),
      ),
    // normalizedSearch is derived from memberSearch and intentionally included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, selectedSet, normalizedSearch],
  );

  const selectedMembers = useMemo(
    () =>
      (form.integrantes || []).map((id) => {
        const person = catalog.find(
          (candidate) => Number(candidate.id_alumno) === Number(id),
        );
        return (
          person || {
            id_alumno: id,
            nombre_completo: `ALUMNO #${id}`,
            num_documento: "",
            curso: "",
          }
        );
      }),
    [catalog, form.integrantes],
  );

  const togglePendingMember = (person) => {
    const id = Number(person.id_alumno);
    if (!id || belongsToAnotherFamily(person) || !person.activo) return;

    setPendingMemberIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addPendingMembers = () => {
    if (!pendingMemberIds.size) return;
    setForm((current) => ({
      ...current,
      integrantes: Array.from(
        new Set([
          ...(current.integrantes || []).map(Number),
          ...Array.from(pendingMemberIds),
        ]),
      ),
    }));
    setPendingMemberIds(new Set());
  };

  const removeMember = (id) => {
    const numericId = Number(id);
    setForm((current) => ({
      ...current,
      integrantes: (current.integrantes || []).filter(
        (currentId) => Number(currentId) !== numericId,
      ),
    }));
  };

  return (
    <div className="entity-form familias-modal__form">
      <EntityTabs
        tabs={[
          {
            value: FORM_TAB_DETAILS,
            label: "Datos de la familia",
            icon: faHouse,
          },
          {
            value: FORM_TAB_MEMBERS,
            label: "Integrantes",
            icon: faUsers,
            badge: form.integrantes.length || null,
          },
        ]}
        value={activeTab}
        onChange={onTabChange}
        idPrefix="cooperadora-familia-form-tab"
        ariaLabel="Secciones de la familia"
      />

      <EntityTabPane active={activeTab === FORM_TAB_DETAILS} disableWhenInactive>
        <EntityFormPanel
          tabValue={FORM_TAB_DETAILS}
          idPrefix="cooperadora-familia-form-tab"
          eyebrow="Ficha principal"
          title="Identificación del grupo"
          icon={faAddressBook}
          tag="Nombre obligatorio"
          bodyClassName="familias-form-panel__body--details"
        >
          <FloatingField
            label="Nombre de la familia *"
            active={Boolean(form.nombre_familia)}
          >
            <input
              value={form.nombre_familia}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  nombre_familia: event.target.value.toUpperCase(),
                }))
              }
              required
              placeholder=" "
              autoFocus
            />
          </FloatingField>

          <FloatingField
            label="Observaciones"
            active={Boolean(form.observaciones)}
            textarea
          >
            <textarea
              value={form.observaciones}
              maxLength={5000}
              rows={4}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  observaciones: event.target.value.toUpperCase(),
                }))
              }
              placeholder=" "
            />
          </FloatingField>

          <div className="familias-form-note">
            <FontAwesomeIcon icon={faCircleInfo} />
            <span>
              Cada alumno puede pertenecer a una sola familia. La asociación se
              conserva para cuotas, cobradores y recordatorios.
            </span>
          </div>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={activeTab === FORM_TAB_MEMBERS} disableWhenInactive>
        <EntityFormPanel
          tabValue={FORM_TAB_MEMBERS}
          idPrefix="cooperadora-familia-form-tab"
          bodyClassName="familias-form-panel__body--members"
        >
          <div className="familias-members-layout">
            <section className="familias-members-column familias-members-column--available">
              <div className="familias-members-column__header">
                <div>
                  <strong>Alumnos</strong>
                  <span>Los que ya tienen otra familia quedan deshabilitados.</span>
                </div>
                <span className="familias-members-count">{available.length}</span>
              </div>

              <FloatingField
                label="Buscar alumno por nombre, documento o curso"
                active
                placeholderOnFloat
                className="familias-modal__member-search"
              >
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.currentTarget.value)}
                  placeholder="Nombre, documento o curso..."
                  autoComplete="off"
                />
              </FloatingField>

              <div className="familias-modal__member-list familias-modal__member-list--available">
                {available.map((person) => {
                  const id = Number(person.id_alumno);
                  const checked = pendingMemberIds.has(id);
                  const belongsElsewhere = belongsToAnotherFamily(person);
                  const disabled = Boolean(belongsElsewhere || !person.activo);
                  return (
                    <label
                      className={`familias-modal__member ${checked ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`.trim()}
                      key={person.id_alumno}
                      title={
                        belongsElsewhere
                          ? person.nombre_familia
                            ? `Ya pertenece a ${person.nombre_familia}`
                            : "Ya pertenece a otra familia"
                          : !person.activo
                            ? "Alumno dado de baja"
                            : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => togglePendingMember(person)}
                      />
                      <span className="familias-member-avatar" aria-hidden="true">
                        {String(person.apellido || person.nombre || "?")
                          .trim()
                          .charAt(0)
                          .toLocaleUpperCase("es-AR")}
                      </span>
                      <span className="familias-modal__member-copy">
                        <strong>{person.nombre_completo}</strong>
                        <small>
                          {person.tipo_documento_sigla
                            ? `${person.tipo_documento_sigla} `
                            : ""}
                          {person.num_documento || "SIN DOCUMENTO"}
                          {person.curso ? ` · ${person.curso}` : ""}
                          {belongsElsewhere && person.nombre_familia
                            ? ` · Familia: ${person.nombre_familia}`
                            : ""}
                          {!person.activo ? " · BAJA" : ""}
                        </small>
                      </span>
                    </label>
                  );
                })}

                {!available.length ? (
                  <div className="familias-modal__empty">
                    <strong>Sin alumnos disponibles</strong>
                    <span>No hay alumnos que coincidan con la búsqueda.</span>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="familias-add-members-button"
                onClick={addPendingMembers}
                disabled={!pendingMemberIds.size}
              >
                <FontAwesomeIcon icon={faPlus} />
                <span>
                  Agregar {pendingMemberIds.size || ""}{" "}
                  {pendingMemberIds.size === 1 ? "integrante" : "integrantes"}
                </span>
              </button>
            </section>

            <section className="familias-members-column familias-members-column--current">
              <div className="familias-members-column__header">
                <div>
                  <strong>Integrantes actuales</strong>
                  <span>Alumnos que quedarán vinculados a la familia.</span>
                </div>
                <span className="familias-members-count">
                  {selectedMembers.length}
                </span>
              </div>

              <div className="familias-selected-members__list">
                {selectedMembers.length ? (
                  selectedMembers.map((person) => (
                    <article
                      className="familias-selected-member"
                      key={person.id_alumno}
                    >
                      <div className="familias-selected-member__top">
                        <span className="familias-member-avatar" aria-hidden="true">
                          {String(person.apellido || person.nombre || "?")
                            .trim()
                            .charAt(0)
                            .toLocaleUpperCase("es-AR")}
                        </span>
                        <span className="familias-selected-member__identity">
                          <strong>{person.nombre_completo}</strong>
                          <small>
                            {person.tipo_documento_sigla
                              ? `${person.tipo_documento_sigla} `
                              : ""}
                            {person.num_documento || "SIN DOCUMENTO"}
                            {person.curso ? ` · ${person.curso}` : ""}
                          </small>
                        </span>
                        <button
                          type="button"
                          className="familias-member-remove"
                          title="Quitar integrante"
                          aria-label={`Quitar ${person.nombre_completo || "integrante"}`}
                          onClick={() => removeMember(person.id_alumno)}
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="familias-modal__empty">
                    <strong>Sin integrantes seleccionados</strong>
                    <span>Elegí alumnos de la columna izquierda y agregalos.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </EntityFormPanel>
      </EntityTabPane>
    </div>
  );
}

export default function Familias() {
  const writable = canWrite();
  const [status, setStatus] = useState("activo");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [formModal, setFormModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formTab, setFormTab] = useState(FORM_TAB_DETAILS);
  const [saving, setSaving] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailTab, setDetailTab] = useState("integrantes");
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);

  const filters = useMemo(
    () => ({ estado: status, buscar: search }),
    [status, search],
  );
  const { items, resumen, catalogos, loading, error, cargar } = useFamilias(filters);

  const openCreate = () => {
    setForm(emptyForm());
    setFormTab(FORM_TAB_DETAILS);
    setFormModal(true);
  };

  const openEdit = async (item) => {
    try {
      const result = await familiasApi.obtener(item.id_familia);
      setForm(formFromDetail(result));
      setFormTab(FORM_TAB_DETAILS);
      setFormModal(true);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message });
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.nombre_familia.trim()) {
      setFeedback({ type: "error", message: "Completá el nombre de la familia." });
      return;
    }
    setSaving(true);
    try {
      const response = await familiasApi.guardar({
        id_familia: form.id_familia || null,
        nombre_familia: form.nombre_familia.trim(),
        observaciones: form.observaciones.trim() || null,
        integrantes: form.integrantes.map((id) => ({ id_alumno: id })),
      });
      setFeedback({ type: "success", message: response.mensaje || "Familia guardada correctamente." });
      setFormModal(false);
      await cargar();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo guardar la familia." });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (item) => {
    setDetailTab("integrantes");
    setDetailModal({ loading: true, data: null });
    try {
      const result = await familiasApi.obtener(item.id_familia);
      setDetailModal({ loading: false, data: result });
    } catch (requestError) {
      setDetailModal(null);
      setFeedback({ type: "error", message: requestError.message });
    }
  };

  const changeState = async () => {
    if (!stateModal) return { ok: false, mensaje: "No hay una familia seleccionada." };

    const response = stateModal.activo
      ? await familiasApi.darBaja({ id: stateModal.id_familia })
      : await familiasApi.reactivar(stateModal.id_familia);

    await cargar();
    return response;
  };

  const hardDelete = async () => {
    if (!deleteModal) return { ok: false, mensaje: "No hay una familia seleccionada." };

    const response = await familiasApi.eliminarDefinitivo({
      id: deleteModal.id_familia,
    });

    await cargar();
    return response;
  };

  const pageFilters = [
    {
      key: "estado",
      type: "tabs",
      label: "Estado",
      value: status,
      onChange: setStatus,
      options: [
        { value: "activo", label: "Activas", count: resumen.activas ?? 0 },
        { value: "inactivo", label: "Bajas", count: resumen.inactivas ?? 0 },
      ],
    },
    {
      key: "buscar",
      type: "search",
      label: "Buscar familia",
      value: search,
      onChange: setSearch,
      placeholder: "Familia o integrante...",
      className: "familias-mainSearch",
    },
  ];

  return (
    <>
      <ModulePage
        title="Familias"
        description="Grupos familiares vinculados directamente con los alumnos."
        filters={pageFilters}
        tabsInTitle
        headFiltersInActions
        primaryActionLabel="Nueva familia"
        primaryActionClassName="familias-headAction familias-headAction--new"
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        className="familias-page"
      >
        <GlobalDivTable
          className="familias-table"
          gridClassName="familias-grid"
          ariaLabel="Listado de familias"
          columns={["Familia", "Integrantes", "Estado", "Acciones"]}
          loading={loading}
          loadingLabel="Cargando familias..."
          empty={!loading && !items.length}
        >
          {!loading && error ? (
            <div className="module-empty"><strong>{error}</strong></div>
          ) : null}
          {!loading && !error && !items.length ? (
            <div className="module-empty">
              <strong>Sin familias para mostrar</strong>
              <span>Creá la primera familia o cambiá los filtros.</span>
            </div>
          ) : null}
          {!loading && !error
            ? items.map((item) => (
                <div
                  className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row familias-grid"
                  key={item.id_familia}
                >
                  <div className="mov-gridCell entity-main-cell">
                    <strong>{item.nombre_familia}</strong>
                    {item.observaciones ? <small>{item.observaciones}</small> : null}
                  </div>
                  <div className="mov-gridCell familias-integrantesCell">
                    <strong className="familias-integrantesCell__resumen">
                      {item.integrantes_resumen || "SIN INTEGRANTES"}
                    </strong>
                    <span className="familias-integrantesCountChip">
                      {Number(item.cantidad_integrantes || 0)}{" "}
                      {Number(item.cantidad_integrantes || 0) === 1
                        ? "integrante"
                        : "integrantes"}
                    </span>
                  </div>
                  <div className="mov-gridCell is-center">
                    <span className={`socios-statusChip ${item.activo ? "is-active" : "is-inactive"}`}>
                      {item.activo ? "ACTIVA" : "BAJA"}
                    </span>
                  </div>
                  <div className="mov-gridCell mov-actionsInline is-center">
                    <button className="mov-iconBtn" type="button" title="Ver familia" onClick={() => openDetail(item)}>
                      <FontAwesomeIcon icon={faCircleInfo} />
                    </button>
                    {writable ? (
                      <button className="mov-iconBtn" type="button" title="Editar" onClick={() => openEdit(item)}>
                        <FontAwesomeIcon icon={faPen} />
                      </button>
                    ) : null}
                    {writable ? (
                      <button
                        className={`mov-iconBtn ${item.activo ? "mov-iconBtn--danger" : ""}`}
                        type="button"
                        title={item.activo ? "Dar de baja" : "Reactivar"}
                        onClick={() => setStateModal(item)}
                      >
                        <FontAwesomeIcon icon={item.activo ? faUserSlash : faRotateLeft} />
                      </button>
                    ) : null}
                    {writable && !item.activo ? (
                      <button
                        className="mov-iconBtn mov-iconBtn--danger"
                        type="button"
                        title="Eliminar definitivamente"
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
      </ModulePage>

      <CrudModal
        open={formModal}
        title={form.id_familia ? "Editar familia" : "Nueva familia"}
        subtitle="Administrá los datos y los alumnos vinculados a este grupo familiar."
        onClose={() => !saving && setFormModal(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_familia ? "Guardar cambios" : "Crear familia"}
        wide
        closeOnBackdrop={false}
        modalClassName="familias-modal familias-modal--form"
      >
        <FamilyForm
          form={form}
          setForm={setForm}
          catalog={catalogos.alumnos || []}
          activeTab={formTab}
          onTabChange={setFormTab}
        />
      </CrudModal>

      <InfoModal
        open={Boolean(detailModal)}
        title="Ficha de la familia"
        subtitle={detailModal?.data?.item?.nombre_familia || "Consultando datos..."}
        onClose={() => setDetailModal(null)}
        loading={Boolean(detailModal?.loading)}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        tabs={[
          { value: "integrantes", label: "Integrantes", badge: detailModal?.data?.integrantes?.length || null },
          { value: "historial", label: "Historial", badge: detailModal?.data?.historial?.length || null },
        ]}
      >
        {detailModal?.data ? (
          <div className="socios-info-content">
            <InfoSummary
              items={[
                { label: "Estado", value: detailModal.data.item.activo ? "ACTIVA" : "BAJA", icon: faHouse, tone: detailModal.data.item.activo ? "success" : "danger" },
                { label: "Integrantes", value: detailModal.data.integrantes.length, icon: faUsers },
                { label: "Creada", value: formatDate(detailModal.data.item.creado_en) },
                { label: "Actualizada", value: formatDate(detailModal.data.item.actualizado_en) },
              ]}
            />

            {detailTab === "integrantes" ? (
              <InfoSection title="Integrantes actuales" icon={faUsers} badge={detailModal.data.integrantes.length}>
                {detailModal.data.integrantes.length ? (
                  detailModal.data.integrantes.map((member) => (
                    <InfoRow
                      key={member.id_alumno}
                      title={member.nombre_completo}
                      detail={`${member.tipo_documento_sigla ? `${member.tipo_documento_sigla} ` : ""}${member.num_documento || "SIN DOCUMENTO"} · ${member.curso || "SIN CURSO"}`}
                      meta={`${member.categoria_monto || member.categoria || "SIN CATEGORÍA"}${member.es_cobrador ? " · COBRADOR" : ""}`}
                      tone={member.activo ? "success" : "danger"}
                    />
                  ))
                ) : (
                  <InfoEmpty>La familia no tiene alumnos vinculados.</InfoEmpty>
                )}
                {detailModal.data.item.observaciones ? (
                  <InfoRow title="Observaciones" detail={detailModal.data.item.observaciones} />
                ) : null}
              </InfoSection>
            ) : null}

            {detailTab === "historial" ? (
              <InfoSection title="Cambios auditados" badge={detailModal.data.historial.length}>
                {detailModal.data.historial.length ? (
                  detailModal.data.historial.map((entry) => (
                    <InfoRow
                      key={entry.id_auditoria}
                      title={entry.accion}
                      detail={entry.usuario || "SISTEMA"}
                      meta={formatDateTime(entry.creado_en)}
                    />
                  ))
                ) : (
                  <InfoEmpty>Sin cambios auditados para esta familia.</InfoEmpty>
                )}
              </InfoSection>
            ) : null}
          </div>
        ) : null}
      </InfoModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.activo ? "baja" : "alta"}
        row={stateModal}
        onClose={() => setStateModal(null)}
        title={stateModal?.activo ? "Dar de baja familia" : "Reactivar familia"}
        message={
          stateModal?.activo
            ? "La familia dejará de figurar entre las activas."
            : "La familia volverá a estar disponible entre las activas."
        }
        warning={
          stateModal?.activo
            ? "Los alumnos conservarán el vínculo familiar para no perder la agrupación usada por cuotas, cobradores y recordatorios."
            : "La reactivación no modifica los integrantes ni el historial de la familia."
        }
        confirmLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
        successMessage={
          stateModal?.activo
            ? "Familia dada de baja correctamente."
            : "Familia reactivada correctamente."
        }
        errorMessage={
          stateModal?.activo
            ? "No se pudo dar de baja la familia."
            : "No se pudo reactivar la familia."
        }
        details={[
          { label: "Familia", value: stateModal?.nombre_familia || "—" },
          {
            label: "Integrantes",
            value: stateModal?.cantidad_integrantes ?? 0,
          },
          {
            label: "Estado actual",
            value: stateModal?.activo ? "ACTIVA" : "BAJA",
          },
        ]}
        onConfirm={changeState}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Eliminar familia definitivamente"
        message="La familia se eliminará definitivamente del padrón."
        warning="Los alumnos vinculados quedarán sin familia. Esta acción no se puede deshacer."
        confirmLabel="Eliminar familia"
        successMessage="Familia eliminada correctamente."
        errorMessage="No se pudo eliminar la familia."
        details={[
          { label: "Familia", value: deleteModal?.nombre_familia || "—" },
          {
            label: "Integrantes",
            value: deleteModal?.cantidad_integrantes ?? 0,
          },
          { label: "Estado", value: "BAJA" },
        ]}
        onConfirm={hardDelete}
      />

      <ModuleFeedback
        type={feedback?.type}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
