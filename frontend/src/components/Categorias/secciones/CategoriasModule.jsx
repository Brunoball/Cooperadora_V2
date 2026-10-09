import React, { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft,
  faPen,
  faRotateLeft,
  faTags,
  faToggleOff,
  faTrashCan,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import { useSmartScrollRefresh } from "../../Global/useSmartScrollRefresh";
import CrudModal from "../../Global/Modales/CrudModal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../../Global/Modales/InfoModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import {
  EntityFormPanel,
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import {
  decimalInput,
  onlyDigits,
  preventInvalidDecimalKey,
  upperLimitedText,
} from "../../Global/Formularios/inputSanitizers";
import { categoriasApi } from "../api/categoriasApi";
import { useCategorias } from "../hooks/useCategorias";
import { useDescuentosFamiliares } from "../hooks/useDescuentosFamiliares";
import "../Categorias.css";
import "../modales/CategoriasModal.css";

const CATEGORY_TAB_GENERAL = "general";
const CATEGORY_TAB_VALUES = "values";

const dateToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value, empty = "—") => {
  if (!value) return empty;
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

const emptyCategoryForm = () => ({
  id_cat_monto: "",
  nombre: "",
  monto_mensual: "",
  monto_anual: "",
  vigente_desde: dateToday(),
});

const emptySiblingForm = () => ({
  id_cat_hermanos: "",
  id_cat_monto: "",
  cantidad_hermanos: "2",
  monto_mensual: "",
  monto_anual: "",
  vigente_desde: dateToday(),
});

function CategoryForm({ form, setForm, activeTab, onTabChange }) {
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="entity-form categorias-modal__form">
      <EntityTabs
        tabs={[
          { value: CATEGORY_TAB_GENERAL, label: "Datos generales", icon: faTags },
          { value: CATEGORY_TAB_VALUES, label: "Valores", icon: faWallet },
        ]}
        value={activeTab}
        onChange={onTabChange}
        idPrefix="categoria-form-tab"
        ariaLabel="Secciones de la categoría"
      />

      <EntityTabPane active={activeTab === CATEGORY_TAB_GENERAL} disableWhenInactive>
        <EntityFormPanel
          tabValue={CATEGORY_TAB_GENERAL}
          idPrefix="categoria-form-tab"
          eyebrow="Identificación"
          title="Categoría de cuota"
          icon={faTags}
          tag="Paso 1 de 2"
          bodyClassName="entity-form__grid entity-form__grid--single"
          hint="Este nombre se usa en Alumnos, Cuotas y comprobantes. Se mantiene sincronizado con el catálogo de categoría."
        >
          <FloatingField label="Nombre *" active={Boolean(form.nombre)}>
            <input
              value={form.nombre}
              placeholder=" "
              maxLength={20}
              onChange={(event) =>
                update("nombre", upperLimitedText(event.target.value, 20))
              }
              required
              autoFocus
            />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={activeTab === CATEGORY_TAB_VALUES} disableWhenInactive>
        <EntityFormPanel
          tabValue={CATEGORY_TAB_VALUES}
          idPrefix="categoria-form-tab"
          eyebrow="Configuración económica"
          title="Monto mensual y contado anual"
          icon={faWallet}
          tag={form.id_cat_monto ? "Actualización" : "Valores iniciales"}
          bodyClassName="entity-form__grid categorias-price-panel__body"
          hint="Cada cambio queda registrado en precios_historicos con su fecha de vigencia."
        >
          <FloatingField label="Monto mensual *" active={form.monto_mensual !== ""}>
            <input
              type="text"
              inputMode="numeric"
              value={form.monto_mensual}
              placeholder=" "
              maxLength={10}
              onChange={(event) =>
                update("monto_mensual", onlyDigits(event.target.value, 10))
              }
              required
            />
          </FloatingField>
          <FloatingField label="Monto anual *" active={form.monto_anual !== ""}>
            <input
              type="text"
              inputMode="numeric"
              value={form.monto_anual}
              placeholder=" "
              maxLength={10}
              onChange={(event) =>
                update("monto_anual", onlyDigits(event.target.value, 10))
              }
              required
            />
          </FloatingField>
          <FloatingField label="Vigente desde *" active>
            <input
              type="date"
              value={form.vigente_desde}
              max={dateToday()}
              onChange={(event) => update("vigente_desde", event.target.value)}
              required
            />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>
    </div>
  );
}

function SiblingForm({ form, setForm, categories }) {
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const editing = Boolean(form.id_cat_hermanos);

  return (
    <div className="entity-form categorias-discount-form">
      <EntityFormPanel
        tabValue="siblings"
        eyebrow="Precio familiar"
        title="Valores por cantidad de hermanos"
        icon={faUsers}
        tag={editing ? "Actualización" : "Nueva regla"}
        standalone
        bodyClassName="entity-form__grid categorias-discount-panel__body"
        hint="El monto es por alumno. Cuotas usa automáticamente esta regla cuando la familia tiene exactamente esa cantidad de alumnos."
      >
        <FloatingField label="Categoría *" active={Boolean(form.id_cat_monto)}>
          <select
            value={form.id_cat_monto}
            disabled={editing}
            onChange={(event) => update("id_cat_monto", event.target.value)}
            required
          >
            <option value="">Seleccionar</option>
            {categories.map((item) => (
              <option key={item.id_cat_monto} value={item.id_cat_monto}>
                {item.nombre}
              </option>
            ))}
          </select>
        </FloatingField>
        <FloatingField label="Cantidad de hermanos *" active>
          <input
            type="text"
            inputMode="numeric"
            value={form.cantidad_hermanos}
            disabled={editing}
            maxLength={2}
            onChange={(event) =>
              update("cantidad_hermanos", onlyDigits(event.target.value, 2))
            }
            required
          />
        </FloatingField>
        <FloatingField label="Monto mensual por alumno *" active={form.monto_mensual !== ""}>
          <input
            type="text"
            inputMode="decimal"
            value={form.monto_mensual}
            placeholder=" "
            maxLength={13}
            onKeyDown={preventInvalidDecimalKey}
            onChange={(event) =>
              update("monto_mensual", decimalInput(event.target.value, 10, 2))
            }
            required
          />
        </FloatingField>
        <FloatingField label="Monto anual por alumno *" active={form.monto_anual !== ""}>
          <input
            type="text"
            inputMode="decimal"
            value={form.monto_anual}
            placeholder=" "
            maxLength={13}
            onKeyDown={preventInvalidDecimalKey}
            onChange={(event) =>
              update("monto_anual", decimalInput(event.target.value, 10, 2))
            }
            required
          />
        </FloatingField>
        <FloatingField label="Vigente desde *" active>
          <input
            type="date"
            value={form.vigente_desde}
            max={dateToday()}
            onChange={(event) => update("vigente_desde", event.target.value)}
            required
          />
        </FloatingField>
      </EntityFormPanel>
    </div>
  );
}

export default function CategoriasModule({ section = "categorias" }) {
  const writable = canWrite();
  const siblingsSection = section === "descuentos";
  const [search, setSearch] = useState("");
  const [siblingStatus, setSiblingStatus] = useState("activo");
  const [siblingCategory, setSiblingCategory] = useState("");
  const categoryFilters = useMemo(
    () => ({ buscar: siblingsSection ? "" : search }),
    [search, siblingsSection],
  );
  const siblingFilters = useMemo(
    () => ({ estado: siblingStatus, id_cat_monto: siblingCategory || undefined }),
    [siblingCategory, siblingStatus],
  );

  const {
    items: categories,
    loading: categoriesLoading,
    error: categoriesError,
    cargar: loadCategories,
  } = useCategorias(categoryFilters, true);
  const {
    items: siblingRules,
    loading: siblingsLoading,
    error: siblingsError,
    cargar: loadSiblingRules,
  } = useDescuentosFamiliares(siblingFilters, siblingsSection);

  const activeLoading = siblingsSection ? siblingsLoading : categoriesLoading;
  const activeLength = siblingsSection ? siblingRules.length : categories.length;
  const { bodyRef: tableBodyRef, captureScroll } = useSmartScrollRefresh({
    loading: activeLoading,
    contentKey: `${section}:${activeLength}`,
  });

  const refreshCategories = useCallback(async () => {
    captureScroll();
    return loadCategories();
  }, [captureScroll, loadCategories]);
  const refreshSiblingRules = useCallback(async () => {
    captureScroll();
    return loadSiblingRules();
  }, [captureScroll, loadSiblingRules]);

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm());
  const [categoryTab, setCategoryTab] = useState(CATEGORY_TAB_GENERAL);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [siblingForm, setSiblingForm] = useState(emptySiblingForm());
  const [siblingModalOpen, setSiblingModalOpen] = useState(false);
  const [deleteCategoryModal, setDeleteCategoryModal] = useState(null);
  const [siblingStateModal, setSiblingStateModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const openNewCategory = () => {
    setFeedback(null);
    setCategoryForm(emptyCategoryForm());
    setCategoryTab(CATEGORY_TAB_GENERAL);
    setCategoryModalOpen(true);
  };
  const openEditCategory = (item) => {
    setFeedback(null);
    setCategoryForm({
      id_cat_monto: item.id_cat_monto,
      nombre: item.nombre,
      monto_mensual: String(Math.round(Number(item.monto_mensual || 0))),
      monto_anual: String(Math.round(Number(item.monto_anual || 0))),
      vigente_desde: dateToday(),
    });
    setCategoryTab(CATEGORY_TAB_GENERAL);
    setCategoryModalOpen(true);
  };
  const openNewSibling = () => {
    setFeedback(null);
    setSiblingForm(emptySiblingForm());
    setSiblingModalOpen(true);
  };
  const openEditSibling = (item) => {
    setFeedback(null);
    setSiblingForm({
      id_cat_hermanos: item.id_cat_hermanos,
      id_cat_monto: String(item.id_cat_monto),
      cantidad_hermanos: String(item.cantidad_hermanos),
      monto_mensual: String(item.monto_mensual),
      monto_anual: String(item.monto_anual),
      vigente_desde: dateToday(),
    });
    setSiblingModalOpen(true);
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    const payload = {
      ...categoryForm,
      nombre: upperLimitedText(categoryForm.nombre, 20).trim(),
      monto_mensual: onlyDigits(categoryForm.monto_mensual, 10),
      monto_anual: onlyDigits(categoryForm.monto_anual, 10),
    };
    if (!payload.nombre) {
      setCategoryTab(CATEGORY_TAB_GENERAL);
      setFeedback({ type: "error", message: "Completá el nombre de la categoría." });
      return;
    }
    if (payload.monto_mensual === "" || payload.monto_anual === "") {
      setCategoryTab(CATEGORY_TAB_VALUES);
      setFeedback({ type: "error", message: "Completá los importes mensual y anual." });
      return;
    }
    if (!payload.vigente_desde) {
      setCategoryTab(CATEGORY_TAB_VALUES);
      setFeedback({ type: "error", message: "Seleccioná la fecha de vigencia." });
      return;
    }

    setSaving(true);
    try {
      const response = await categoriasApi.guardar(payload);
      setCategoryModalOpen(false);
      setFeedback({ type: "success", message: response.mensaje || "Categoría guardada correctamente." });
      await refreshCategories();
      if (siblingsSection) await refreshSiblingRules();
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const saveSibling = async (event) => {
    event.preventDefault();
    const count = Number(onlyDigits(siblingForm.cantidad_hermanos, 2));
    if (!siblingForm.id_cat_monto) {
      setFeedback({ type: "error", message: "Seleccioná una categoría." });
      return;
    }
    if (!Number.isInteger(count) || count < 2 || count > 50) {
      setFeedback({ type: "error", message: "La cantidad de hermanos debe estar entre 2 y 50." });
      return;
    }
    if (siblingForm.monto_mensual === "" || siblingForm.monto_anual === "") {
      setFeedback({ type: "error", message: "Completá los importes mensual y anual." });
      return;
    }
    if (!siblingForm.vigente_desde) {
      setFeedback({ type: "error", message: "Seleccioná la fecha de vigencia." });
      return;
    }

    setSaving(true);
    try {
      const response = await categoriasApi.guardarHermanos({
        ...siblingForm,
        id_cat_monto: Number(siblingForm.id_cat_monto),
        cantidad_hermanos: count,
        monto_mensual: decimalInput(siblingForm.monto_mensual, 10, 2),
        monto_anual: decimalInput(siblingForm.monto_anual, 10, 2),
      });
      setSiblingModalOpen(false);
      setFeedback({ type: "success", message: response.mensaje || "Valor por hermanos guardado correctamente." });
      setSiblingStatus("activo");
      await refreshSiblingRules();
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async () => {
    if (!deleteCategoryModal) return null;
    const response = await categoriasApi.eliminar(deleteCategoryModal.id_cat_monto);
    await refreshCategories();
    return response;
  };

  const changeSiblingState = async () => {
    if (!siblingStateModal) return null;
    const response = siblingStateModal.activo
      ? await categoriasApi.desactivarHermanos(siblingStateModal.id_cat_hermanos)
      : await categoriasApi.reactivarHermanos(siblingStateModal.id_cat_hermanos);
    await refreshSiblingRules();
    return response;
  };

  const openCategoryHistory = async (item) => {
    setHistoryModal({ type: "categoria", item });
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await categoriasApi.historial(item.id_cat_monto);
      setHistory(response.items || []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      setHistoryModal(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openSiblingHistory = async (item) => {
    setHistoryModal({ type: "hermanos", item });
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await categoriasApi.historialHermanos(item.id_cat_hermanos);
      setHistory(response.items || []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      setHistoryModal(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filters = siblingsSection
    ? [
        {
          key: "estado-hermanos",
          label: "Estado",
          type: "tabs",
          value: siblingStatus,
          onChange: setSiblingStatus,
          options: [
            { value: "activo", label: "Activos" },
            { value: "inactivo", label: "Historial" },
          ],
        },
        {
          key: "categoria-hermanos",
          label: "Categoría",
          type: "select",
          value: siblingCategory,
          onChange: setSiblingCategory,
          placeholder: "TODAS",
          className: "categorias-siblingCategory-filter",
          options: categories.map((item) => ({
            value: String(item.id_cat_monto),
            label: item.nombre,
          })),
        },
      ]
    : [
        {
          key: "buscar",
          label: "Búsqueda",
          type: "search",
          value: search,
          onChange: setSearch,
          placeholder: "Buscar categoría...",
        },
      ];

  const activeError = siblingsSection ? siblingsError : categoriesError;
  const primaryAction = siblingsSection ? openNewSibling : openNewCategory;

  return (
    <>
      <ModulePage
        className="categorias-page"
        title={siblingsSection ? "Valores por hermanos" : "Categorías"}
        description={
          siblingsSection
            ? "Definí los importes que Cuotas aplica automáticamente por alumno según la cantidad de hermanos de la familia."
            : "Administrá las categorías y sus valores de cuota."
        }
        filters={filters}
        tabsInTitle={siblingsSection}
        primaryActionLabel={siblingsSection ? "Nuevo valor" : "Nueva categoría"}
        onPrimaryAction={primaryAction}
        primaryActionClassName="categorias-primaryAction"
        canCreate={writable}
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || activeError}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />

        {!siblingsSection ? (
          <GlobalDivTable
            bodyRef={tableBodyRef}
            className="categorias-table"
            bodyClassName="entity-table-wrap"
            gridClassName="categorias-grid"
            ariaLabel="Listado de categorías"
            loading={categoriesLoading}
            loadingLabel="Cargando categorías..."
            skeletonRows={6}
            columns={[
              "Categoría",
              { label: "Mensual", align: "right" },
              { label: "Anual", align: "right" },
              "Alumnos activos",
              "Último cambio",
              "Acciones",
            ]}
          >
            {!categoriesLoading && !categoriesError && !categories.length ? (
              <div className="module-empty">
                <FontAwesomeIcon icon={faTags} />
                <strong>Sin categorías para mostrar</strong>
                <span>Creá una categoría o cambiá la búsqueda.</span>
              </div>
            ) : null}
            {categories.map((item) => (
              <div
                className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row categorias-grid"
                role="row"
                key={item.id_cat_monto}
              >
                <div className="mov-gridCell is-strong">
                  <span className="mov-categoryChip">{item.nombre}</span>
                </div>
                <div className="mov-gridCell is-right is-strong categorias-money-cell">
                  {money(item.monto_mensual)}
                </div>
                <div className="mov-gridCell is-right is-strong categorias-money-cell">
                  {money(item.monto_anual)}
                </div>
                <div className="mov-gridCell is-center">
                  <span className="mov-chip">{item.cantidad_alumnos_activos}</span>
                </div>
                <div className="mov-gridCell is-center">{formatDate(item.ultimo_cambio)}</div>
                <div className="mov-gridCell mov-gridCell--actions">
                  <div className="mov-actionsInline">
                    <button
                      className="mov-iconBtn"
                      type="button"
                      title="Historial de precios"
                      onClick={() => openCategoryHistory(item)}
                    >
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                    </button>
                    {writable ? (
                      <>
                        <button
                          className="mov-iconBtn"
                          type="button"
                          title="Editar categoría"
                          onClick={() => openEditCategory(item)}
                        >
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button
                          className="mov-iconBtn mov-iconBtn--danger"
                          type="button"
                          title="Eliminar categoría"
                          onClick={() => setDeleteCategoryModal(item)}
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </GlobalDivTable>
        ) : (
          <GlobalDivTable
            bodyRef={tableBodyRef}
            className="categorias-discountsTable"
            bodyClassName="entity-table-wrap"
            gridClassName="categorias-discountsGrid"
            ariaLabel="Valores por hermanos"
            loading={siblingsLoading}
            loadingLabel="Cargando valores por hermanos..."
            skeletonRows={7}
            columns={[
              "Categoría",
              "Hermanos",
              { label: "Mensual / alumno", align: "right" },
              { label: "Anual / alumno", align: "right" },
              "Último cambio",
              "Estado",
              "Acciones",
            ]}
          >
            {!siblingsLoading && !siblingsError && !siblingRules.length ? (
              <div className="module-empty">
                <FontAwesomeIcon icon={faUsers} />
                <strong>Sin valores para mostrar</strong>
                <span>
                  {siblingStatus === "activo"
                    ? "Todavía no hay reglas activas para hermanos."
                    : "No hay reglas dadas de baja."}
                </span>
              </div>
            ) : null}
            {siblingRules.map((item) => (
              <div
                className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row categorias-discountsGrid"
                role="row"
                key={item.id_cat_hermanos}
              >
                <div className="mov-gridCell is-strong">
                  <span className="mov-categoryChip">{item.categoria}</span>
                </div>
                <div className="mov-gridCell is-center">
                  <span className="mov-chip">{item.cantidad_hermanos}</span>
                </div>
                <div className="mov-gridCell is-right is-strong categorias-money-cell">
                  {money(item.monto_mensual)}
                </div>
                <div className="mov-gridCell is-right is-strong categorias-money-cell">
                  {money(item.monto_anual)}
                </div>
                <div className="mov-gridCell is-center">
                  {formatDate(item.ultimo_cambio || item.actualizado_en)}
                </div>
                <div className="mov-gridCell is-center">
                  <span className={`mov-chip ${item.activo ? "mov-chip--ok" : "mov-chip--danger"}`}>
                    {item.activo ? "ACTIVO" : "HISTÓRICO"}
                  </span>
                </div>
                <div className="mov-gridCell mov-gridCell--actions">
                  <div className="mov-actionsInline">
                    <button
                      className="mov-iconBtn"
                      type="button"
                      title="Historial de valores"
                      onClick={() => openSiblingHistory(item)}
                    >
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                    </button>
                    {writable ? (
                      <>
                        {item.activo ? (
                          <button
                            className="mov-iconBtn"
                            type="button"
                            title="Editar valores"
                            onClick={() => openEditSibling(item)}
                          >
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                        ) : null}
                        <button
                          className={`mov-iconBtn ${item.activo ? "mov-iconBtn--danger" : ""}`}
                          type="button"
                          title={item.activo ? "Enviar al historial" : "Reactivar"}
                          onClick={() => setSiblingStateModal(item)}
                        >
                          <FontAwesomeIcon icon={item.activo ? faToggleOff : faRotateLeft} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </GlobalDivTable>
        )}
      </ModulePage>

      <CrudModal
        open={categoryModalOpen}
        title={categoryForm.id_cat_monto ? "Editar categoría" : "Nueva categoría"}
        subtitle="Los importes se usan como base en Cuotas y cada modificación queda historizada."
        onClose={() => setCategoryModalOpen(false)}
        onSubmit={saveCategory}
        saving={saving}
        submitLabel={categoryForm.id_cat_monto ? "Guardar cambios" : "Crear categoría"}
        modalClassName="categorias-modal categorias-modal--form"
        closeOnBackdrop={false}
        wide
      >
        <CategoryForm
          form={categoryForm}
          setForm={setCategoryForm}
          activeTab={categoryTab}
          onTabChange={setCategoryTab}
        />
      </CrudModal>

      <CrudModal
        open={siblingModalOpen}
        title={siblingForm.id_cat_hermanos ? "Editar valor por hermanos" : "Nuevo valor por hermanos"}
        subtitle="Configurá el importe que Cuotas aplicará por alumno cuando corresponda esa cantidad de hermanos."
        onClose={() => setSiblingModalOpen(false)}
        onSubmit={saveSibling}
        saving={saving}
        submitLabel={siblingForm.id_cat_hermanos ? "Guardar cambios" : "Crear valor"}
        modalClassName="categorias-modal categorias-modal--discount"
        closeOnBackdrop={false}
        wide
      >
        <SiblingForm
          form={siblingForm}
          setForm={setSiblingForm}
          categories={categories}
        />
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(deleteCategoryModal)}
        operacion="eliminar"
        row={deleteCategoryModal}
        title="Eliminar categoría"
        message="La categoría solo se eliminará si nunca quedó asociada a alumnos ni egresados."
        warning="Si está en uso, el sistema bloqueará la eliminación para conservar historial y relaciones."
        details={
          deleteCategoryModal
            ? [
                { label: "Categoría", value: deleteCategoryModal.nombre },
                { label: "Mensual", value: money(deleteCategoryModal.monto_mensual) },
                { label: "Anual", value: money(deleteCategoryModal.monto_anual) },
                { label: "Alumnos activos", value: deleteCategoryModal.cantidad_alumnos_activos },
              ]
            : []
        }
        onClose={() => setDeleteCategoryModal(null)}
        onConfirm={deleteCategory}
        onToast={(type, message, duration) => setFeedback({ type, message, duration })}
        successMessage="Categoría eliminada correctamente."
        errorMessage="No se pudo eliminar la categoría."
      />

      <ModalEliminarGlobal
        open={Boolean(siblingStateModal)}
        operacion={siblingStateModal?.activo ? "baja" : "alta"}
        row={siblingStateModal}
        title={siblingStateModal?.activo ? "Enviar valor al historial" : "Reactivar valor por hermanos"}
        message={
          siblingStateModal?.activo
            ? "La regla dejará de utilizarse para nuevos cálculos de Cuotas, pero conservará todo su historial."
            : "La regla volverá a utilizarse automáticamente en Cuotas."
        }
        warning="No se modifica ningún pago ya registrado."
        details={
          siblingStateModal
            ? [
                { label: "Categoría", value: siblingStateModal.categoria },
                { label: "Hermanos", value: siblingStateModal.cantidad_hermanos },
                { label: "Mensual / alumno", value: money(siblingStateModal.monto_mensual) },
                { label: "Anual / alumno", value: money(siblingStateModal.monto_anual) },
              ]
            : []
        }
        onClose={() => setSiblingStateModal(null)}
        onConfirm={changeSiblingState}
        onToast={(type, message, duration) => setFeedback({ type, message, duration })}
        confirmLabel={siblingStateModal?.activo ? "Enviar al historial" : "Reactivar"}
        successMessage={siblingStateModal?.activo ? "Valor enviado al historial." : "Valor reactivado correctamente."}
        errorMessage="No se pudo cambiar el estado de la regla."
      />

      <InfoModal
        open={Boolean(historyModal)}
        title={historyModal?.type === "hermanos" ? "Historial de valores por hermanos" : "Historial de categoría"}
        subtitle={
          historyModal?.type === "hermanos"
            ? `${historyModal?.item?.categoria || ""} · ${historyModal?.item?.cantidad_hermanos || ""} hermanos`
            : historyModal?.item?.nombre || ""
        }
        onClose={() => setHistoryModal(null)}
        loading={historyLoading}
        modalClassName="categorias-info-modal"
      >
        {historyModal ? (
          <div className="categorias-info-content">
            <InfoSummary
              items={
                historyModal.type === "hermanos"
                  ? [
                      { label: "Mensual actual", value: money(historyModal.item.monto_mensual) },
                      { label: "Anual actual", value: money(historyModal.item.monto_anual) },
                      { label: "Hermanos", value: historyModal.item.cantidad_hermanos },
                    ]
                  : [
                      { label: "Mensual actual", value: money(historyModal.item.monto_mensual) },
                      { label: "Anual actual", value: money(historyModal.item.monto_anual) },
                      { label: "Alumnos activos", value: historyModal.item.cantidad_alumnos_activos },
                    ]
              }
            />
            <InfoSection title="Cambios registrados" icon={faClockRotateLeft} badge={history.length}>
              {history.length ? (
                history.map((entry) => (
                  <InfoRow
                    key={entry.id_historico || entry.id_hist}
                    title={`${entry.tipo === "MENSUAL" ? "MENSUAL" : "ANUAL"}: ${money(entry.precio_nuevo)}`}
                    detail={`Anterior: ${entry.precio_anterior == null ? "—" : money(entry.precio_anterior)}`}
                    meta={formatDate(entry.fecha_cambio)}
                  />
                ))
              ) : (
                <InfoEmpty>No hay cambios históricos registrados.</InfoEmpty>
              )}
            </InfoSection>
          </div>
        ) : null}
      </InfoModal>
    </>
  );
}
