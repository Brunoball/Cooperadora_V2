import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEye,
  faHouse,
  faPen,
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
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import { familiasApi } from "../api/alumnosApi";
import { useFamilias } from "../hooks/useFamilias";
import "./Familias.css";

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

function MemberPicker({ catalog = [], selected = [], familyId, onChange }) {
  const [search, setSearch] = useState("");
  const normalized = search.trim().toLocaleUpperCase("es-AR");
  const selectedSet = useMemo(() => new Set(selected.map(Number)), [selected]);

  const available = catalog.filter((person) => {
    const belongsHere = Number(person.id_familia || 0) === Number(familyId || 0);
    const free = !person.id_familia || belongsHere;
    if (!free) return false;
    if (!normalized) return true;
    const haystack = `${person.apellido || ""} ${person.nombre || ""} ${person.num_documento || ""} ${person.curso || ""}`.toLocaleUpperCase("es-AR");
    return haystack.includes(normalized);
  });

  const toggle = (id) => {
    const numericId = Number(id);
    if (selectedSet.has(numericId)) {
      onChange(selected.filter((current) => Number(current) !== numericId));
    } else {
      onChange([...selected, numericId]);
    }
  };

  return (
    <section className="familias-members-panel">
      <div className="familias-members-panel__head">
        <div>
          <strong>Integrantes</strong>
          <span>{selected.length} seleccionados</span>
        </div>
        <input
          className="familias-member-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar alumno por nombre o documento..."
        />
      </div>

      <div className="familias-memberPicker-list">
        {available.length ? (
          available.map((person) => {
            const checked = selectedSet.has(Number(person.id_alumno));
            return (
              <label
                className={`familias-member-option ${checked ? "is-selected" : ""}`}
                key={person.id_alumno}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(person.id_alumno)}
                />
                <span className="familias-member-avatar" aria-hidden="true">
                  {String(person.apellido || "?").charAt(0)}
                </span>
                <span className="familias-member-option__identity">
                  <strong>{person.nombre_completo}</strong>
                  <small>{person.tipo_documento_sigla ? `${person.tipo_documento_sigla} ` : ""}{person.num_documento || "SIN DOCUMENTO"} · {person.curso || "SIN CURSO"}{person.activo ? "" : " · BAJA"}</small>
                </span>
              </label>
            );
          })
        ) : (
          <div className="familias-modal__empty">
            <strong>Sin alumnos disponibles</strong>
            <span>Los alumnos que ya pertenecen a otra familia no se muestran para evitar duplicaciones.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Familias() {
  const writable = canWrite();
  const [status, setStatus] = useState("activo");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [formModal, setFormModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
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
    setFormModal(true);
  };

  const openEdit = async (item) => {
    try {
      const result = await familiasApi.obtener(item.id_familia);
      setForm(formFromDetail(result));
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

  const changeState = async (event) => {
    event.preventDefault();
    if (!stateModal) return;
    setSaving(true);
    try {
      const response = stateModal.activo
        ? await familiasApi.darBaja({ id: stateModal.id_familia })
        : await familiasApi.reactivar(stateModal.id_familia);
      setFeedback({ type: "success", message: response.mensaje });
      setStateModal(null);
      await cargar();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message });
    } finally {
      setSaving(false);
    }
  };

  const hardDelete = async (event) => {
    event.preventDefault();
    if (!deleteModal) return;
    setSaving(true);
    try {
      const response = await familiasApi.eliminarDefinitivo({ id: deleteModal.id_familia });
      setFeedback({ type: "success", message: response.mensaje });
      setDeleteModal(null);
      await cargar();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message });
    } finally {
      setSaving(false);
    }
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
                    <small>{item.observaciones || `ID ${item.id_familia}`}</small>
                  </div>
                  <div className="mov-gridCell">
                    <strong>{item.cantidad_integrantes}</strong>
                    <small>{item.integrantes_resumen || "SIN INTEGRANTES"}</small>
                  </div>
                  <div className="mov-gridCell is-center">
                    <span className={`socios-statusChip ${item.activo ? "is-active" : "is-inactive"}`}>
                      {item.activo ? "ACTIVA" : "BAJA"}
                    </span>
                  </div>
                  <div className="mov-gridCell mov-actionsInline is-center">
                    <button className="mov-iconBtn" type="button" title="Ver familia" onClick={() => openDetail(item)}>
                      <FontAwesomeIcon icon={faEye} />
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
        subtitle="Los integrantes se vinculan mediante alumnos.id_familia."
        onClose={() => !saving && setFormModal(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_familia ? "Guardar cambios" : "Crear familia"}
        wide
        modalClassName="familias-modal familias-modal--form"
      >
        <div className="familias-modal__layout">
          <section className="familias-modal__data">
            <FloatingField label="Nombre de familia *" active={Boolean(form.nombre_familia)} wide>
              <input
                value={form.nombre_familia}
                maxLength={120}
                onChange={(event) => setForm((current) => ({ ...current, nombre_familia: event.target.value.toUpperCase() }))}
                required
                placeholder=" "
              />
            </FloatingField>
            <FloatingField label="Observaciones" active={Boolean(form.observaciones)} wide textarea>
              <textarea
                value={form.observaciones}
                maxLength={5000}
                rows={4}
                onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value.toUpperCase() }))}
                placeholder=" "
              />
            </FloatingField>
          </section>
          <MemberPicker
            catalog={catalogos.alumnos || []}
            selected={form.integrantes}
            familyId={form.id_familia}
            onChange={(integrantes) => setForm((current) => ({ ...current, integrantes }))}
          />
        </div>
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

      <CrudModal
        open={Boolean(stateModal)}
        title={stateModal?.activo ? "Dar de baja la familia" : "Reactivar familia"}
        subtitle={stateModal?.nombre_familia || ""}
        onClose={() => !saving && setStateModal(null)}
        onSubmit={changeState}
        saving={saving}
        submitLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
        danger={Boolean(stateModal?.activo)}
      >
        <p>
          {stateModal?.activo
            ? "La familia quedará marcada como baja. Los alumnos conservarán el vínculo familiar para no perder la agrupación usada por cuotas y recordatorios."
            : "La familia volverá a estar disponible como activa."}
        </p>
      </CrudModal>

      <CrudModal
        open={Boolean(deleteModal)}
        title="Eliminar definitivamente la familia"
        subtitle={deleteModal?.nombre_familia || ""}
        onClose={() => !saving && setDeleteModal(null)}
        onSubmit={hardDelete}
        saving={saving}
        submitLabel="Eliminar definitivamente"
        danger
      >
        <p>
          Los alumnos vinculados quedarán <b>sin familia</b>. Esta acción sólo se habilita después de dar de baja la familia.
        </p>
      </CrudModal>

      <ModuleFeedback
        type={feedback?.type}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
