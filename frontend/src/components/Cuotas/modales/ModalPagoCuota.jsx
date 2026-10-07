import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faChevronDown,
  faCoins,
  faIdCard,
  faMoneyBillWave,
  faPenToSquare,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import {
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import "./CuotasModal.css";

const PERIODOS_MENSUALES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const ANUAL = 13;
const MATRICULA = 14;
const MITAD_1 = 15;
const MITAD_2 = 16;
const H1_MONTHS = new Set([3, 4, 5, 6, 7]);
const H2_MONTHS = new Set([8, 9, 10, 11, 12]);
const SPECIAL_PERIODS = new Set([ANUAL, MATRICULA, MITAD_1, MITAD_2]);

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const amountInput = (value) =>
  String(value ?? "")
    .replace(/,/g, ".")
    .replace(/[^0-9.]/g, "")
    .replace(/(\..*)\./g, "$1")
    .slice(0, 16);

const statusLabel = (period) => {
  if (!period) return "";
  if (period.condonado) return "Condonado";
  if (period.pagado) {
    return period.periodo_pago ? `Pagado por ${period.periodo_pago}` : "Pagado";
  }
  if (period.motivo_bloqueo) return "No disponible";
  return "Disponible";
};

const memberResolvedStatus = (member, periodId) => {
  const status = String(member?.periodos?.[Number(periodId)] || "").toUpperCase();
  return status === "PAGADO" || status === "CONDONADO";
};

function PaymentYearChip({ value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div className="cuotas-year-chip" ref={containerRef}>
      <button
        type="button"
        className={open ? "is-open" : ""}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Año ${value}`}
      >
        <FontAwesomeIcon icon={faCalendarDays} />
        <span>{value}</span>
        <i aria-hidden="true" />
      </button>

      {open ? (
        <div className="cuotas-year-chip__menu" role="listbox">
          {options.map((year) => {
            const selected = String(year) === String(value);
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "is-selected" : ""}
                key={year}
                onClick={() => {
                  onChange(String(year));
                  setOpen(false);
                }}
              >
                {year}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function ModalPagoCuota({
  open,
  mode = "pago",
  alumno,
  context,
  catalogos,
  loading,
  saving,
  initialYear,
  initialPeriod,
  onClose,
  onSubmit,
  onReloadContext,
  onUpdateMatricula,
}) {
  const condoning = mode === "condonar";
  const [fecha, setFecha] = useState(today());
  const [anio, setAnio] = useState(String(initialYear || new Date().getFullYear()));
  const [selected, setSelected] = useState([]);
  const [medio, setMedio] = useState("");
  const [family, setFamily] = useState(false);
  const [familyExpanded, setFamilyExpanded] = useState(false);
  const [amounts, setAmounts] = useState({});
  const [matriculaGlobal, setMatriculaGlobal] = useState("");
  const [editingMatricula, setEditingMatricula] = useState(false);
  const [updatingMatricula, setUpdatingMatricula] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [freeAmount, setFreeAmount] = useState("");
  const [activePaymentTab, setActivePaymentTab] = useState("periods");

  const periods = useMemo(() => context?.periodos || [], [context?.periodos]);
  const periodMap = useMemo(
    () => new Map(periods.map((item) => [Number(item.id_mes), item])),
    [periods],
  );

  useEffect(() => {
    if (!open) return;
    setFecha(today());
    setAnio(String(initialYear || new Date().getFullYear()));
    setSelected(initialPeriod ? [Number(initialPeriod)] : []);
    setMedio("");
    setFamily(
      Boolean(
        context?.familia?.tiene_familia &&
          context?.familia?.integrantes_activos > 0,
      ),
    );
    setFamilyExpanded(false);
    setAmounts({});
    setEditingMatricula(false);
    setMatriculaGlobal("");
    setFreeMode(false);
    setFreeAmount("");
    setActivePaymentTab(
      SPECIAL_PERIODS.has(Number(initialPeriod)) ? "special" : "periods",
    );
  }, [
    open,
    alumno?.id_alumno,
    initialYear,
    initialPeriod,
    context?.familia?.tiene_familia,
    context?.familia?.integrantes_activos,
  ]);

  useEffect(() => {
    if (!open || !context) return;
    const defaults = {};
    (context.periodos || []).forEach((item) => {
      defaults[String(item.id_mes)] = String(Number(item.monto_sugerido || 0));
    });
    setAmounts(defaults);
    const registration = (context.periodos || []).find(
      (item) => Number(item.id_mes) === MATRICULA,
    );
    setMatriculaGlobal(String(Number(registration?.monto_sugerido || 0)));
  }, [context, open]);

  useEffect(() => {
    if (condoning && activePaymentTab === "amounts") {
      setActivePaymentTab("periods");
    }
  }, [activePaymentTab, condoning]);

  const years = useMemo(() => {
    const all = new Set((catalogos?.anios || []).map(String));
    all.add(String(initialYear || new Date().getFullYear()));
    all.add(String(new Date().getFullYear() + 1));
    return Array.from(all).sort((a, b) => Number(b) - Number(a));
  }, [catalogos?.anios, initialYear]);

  const monthly = periods.filter((item) =>
    PERIODOS_MENSUALES.has(Number(item.id_mes)),
  );
  const special = {
    anual: periodMap.get(ANUAL),
    mitad1: periodMap.get(MITAD_1),
    mitad2: periodMap.get(MITAD_2),
    matricula: periodMap.get(MATRICULA),
  };
  const specialPeriods = [
    special.anual,
    special.mitad1,
    special.mitad2,
    special.matricula,
  ].filter(Boolean);

  const canSelect = (period) => Boolean(period?.puede_pagar);
  const selectedSet = new Set(selected.map(Number));
  const monthBlockedBySelection = (id) =>
    selectedSet.has(ANUAL) ||
    (selectedSet.has(MITAD_1) && H1_MONTHS.has(Number(id))) ||
    (selectedSet.has(MITAD_2) && H2_MONTHS.has(Number(id)));

  const toggle = (id) => {
    const numeric = Number(id);
    const period = periodMap.get(numeric);
    if (!canSelect(period)) return;

    setSelected((current) => {
      const has = current.includes(numeric);
      if (has) return current.filter((value) => value !== numeric);

      const next = [...current];
      if (PERIODOS_MENSUALES.has(numeric)) {
        const blocked =
          next.includes(ANUAL) ||
          (next.includes(MITAD_1) && H1_MONTHS.has(numeric)) ||
          (next.includes(MITAD_2) && H2_MONTHS.has(numeric));
        return blocked ? current : [...next, numeric];
      }

      if (numeric === ANUAL) {
        return [
          ...next.filter(
            (value) =>
              !PERIODOS_MENSUALES.has(Number(value)) &&
              value !== MITAD_1 &&
              value !== MITAD_2,
          ),
          ANUAL,
        ];
      }

      if (numeric === MITAD_1 || numeric === MITAD_2) {
        const other = numeric === MITAD_1 ? MITAD_2 : MITAD_1;
        const range = numeric === MITAD_1 ? H1_MONTHS : H2_MONTHS;
        const cleaned = next.filter(
          (value) =>
            value !== ANUAL &&
            !(PERIODOS_MENSUALES.has(Number(value)) && range.has(Number(value))),
        );

        if (cleaned.includes(other) && canSelect(periodMap.get(ANUAL))) {
          return [...cleaned.filter((value) => value !== other), ANUAL];
        }
        return [...cleaned, numeric];
      }

      return [...next, numeric];
    });
  };

  const availableMonthly = monthly
    .filter((item) => canSelect(item) && !monthBlockedBySelection(item.id_mes))
    .map((item) => Number(item.id_mes));
  const allMonthlySelected =
    availableMonthly.length > 0 &&
    availableMonthly.every((id) => selectedSet.has(id));

  const toggleAllMonthly = () => {
    if (allMonthlySelected) {
      setSelected((current) =>
        current.filter((id) => !availableMonthly.includes(Number(id))),
      );
      return;
    }
    setSelected((current) =>
      Array.from(new Set([...current, ...availableMonthly])),
    );
  };

  const operationTotal = condoning
    ? 0
    : selected.reduce((sum, id) => {
        const period = periodMap.get(Number(id));
        const applicableFamily = family
          ? Math.max(1, Number(period?.cantidad_familia_aplicable || 1))
          : 1;
        return sum + Number(amounts[String(id)] || 0) * applicableFamily;
      }, 0);

  const applyFreeAmount = (raw) => {
    const normalized = amountInput(raw);
    setFreeAmount(normalized);
    const value = normalized === "" ? "0" : normalized;
    setAmounts((current) => {
      const next = { ...current };
      monthly.forEach((period) => {
        if (canSelect(period)) next[String(period.id_mes)] = value;
      });
      return next;
    });
  };

  const toggleFreeMode = (checked) => {
    setFreeMode(checked);
    if (checked) {
      setSelected((current) =>
        current.filter(
          (id) => ![ANUAL, MITAD_1, MITAD_2].includes(Number(id)),
        ),
      );
      if (freeAmount !== "") applyFreeAmount(freeAmount);
      return;
    }

    setAmounts((current) => {
      const next = { ...current };
      monthly.forEach((period) => {
        next[String(period.id_mes)] = String(
          Number(period.monto_sugerido || 0),
        );
      });
      return next;
    });
  };

  const fechaMaxima = today();
  const fechaFutura = Boolean(fecha && fecha > fechaMaxima);
  const submitDisabled =
    selected.length === 0 ||
    fechaFutura ||
    (!condoning && !medio) ||
    (!condoning &&
      selected.some((id) => Number(amounts[String(id)] || 0) <= 0));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitDisabled) return;

    const payloadAmounts = {};
    selected.forEach((id) => {
      payloadAmounts[String(id)] = Number(amounts[String(id)] || 0);
    });

    await onSubmit?.({
      id_alumno: Number(alumno?.id_alumno || alumno?.id_socio),
      anio: Number(anio),
      fecha_pago: fecha,
      periodos: selected,
      id_medio_pago: condoning ? null : Number(medio),
      aplicar_familia: family,
      ids_familia: family
        ? (context?.familia?.integrantes || [])
            .filter((member) => member.activo)
            .map((member) => Number(member.id_alumno || member.id_socio))
        : [],
      montos_por_periodo: payloadAmounts,
    });
  };

  const changeYear = async (value) => {
    setAnio(value);
    setSelected([]);
    await onReloadContext?.({ anio: Number(value), fecha_pago: fecha });
  };

  const changeDate = async (value) => {
    const maximum = today();
    const normalized = value && value > maximum ? maximum : value;
    setFecha(normalized);
    await onReloadContext?.({ anio: Number(anio), fecha_pago: normalized });
  };

  const saveGlobalRegistration = async () => {
    const value = Number(matriculaGlobal || 0);
    if (value < 0 || Number.isNaN(value)) return;
    setUpdatingMatricula(true);
    try {
      await onUpdateMatricula?.(value);
      setEditingMatricula(false);
      await onReloadContext?.({ anio: Number(anio), fecha_pago: fecha });
    } finally {
      setUpdatingMatricula(false);
    }
  };

  const renderPaymentData = () => (
    <aside className="cuotas-payment-date-card">
      <div className="cuotas-payment-date-card__header">
        <span>Datos del pago</span>
        <small>
          {condoning
            ? "Definí la fecha en la que se registra la condonación."
            : "Completá la fecha y el medio de pago."}
        </small>
      </div>

      <div className="cuotas-payment-date-card__fields">
        <div className="cuotas-payment-date-method-row">
          <FloatingField label="Fecha de pago *" active={Boolean(fecha)}>
            <input
              type="date"
              value={fecha}
              max={fechaMaxima}
              onChange={(event) => changeDate(event.target.value)}
              aria-label="Fecha de pago *"
            />
          </FloatingField>

          {!condoning ? (
            <FloatingField label="Medio de pago *" active>
              <select
                value={medio}
                onChange={(event) => setMedio(event.target.value)}
                aria-label="Medio de pago *"
              >
                <option value="">Seleccionar...</option>
                {(catalogos?.medios_pago || []).map((item) => (
                  <option value={item.id_medio_pago} key={item.id_medio_pago}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </FloatingField>
          ) : (
            <div className="cuotas-registration-note" role="note">
              <FontAwesomeIcon icon={faCoins} aria-hidden="true" />
              <span>
                La condonación se registra con importe $0 y sin medio de pago.
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  const renderPeriodButton = (period) => {
    if (!period) return null;

    const id = Number(period.id_mes);
    const selectedPeriod = selectedSet.has(id);
    const paid = Boolean(period.pagado || period.condonado);
    const blockedBySpecial =
      PERIODOS_MENSUALES.has(id) && monthBlockedBySelection(id);
    const blockedByFreeMode =
      freeMode && [ANUAL, MITAD_1, MITAD_2].includes(id);
    const unavailable = !canSelect(period) && !paid;
    const disabled = unavailable || paid || blockedBySpecial || blockedByFreeMode;

    let stateText = statusLabel(period);
    if (blockedBySpecial) stateText = "Modalidad exclusiva";
    if (blockedByFreeMode) stateText = "Monto libre activo";
    if (selectedPeriod) stateText = "Seleccionado";

    return (
      <button
        type="button"
        key={`${anio}-${id}`}
        className={`${selectedPeriod ? "is-selected" : ""} ${
          paid ? "is-paid" : ""
        } ${unavailable ? "is-unavailable" : ""} ${
          disabled && !paid ? "is-disabled" : ""
        }`.trim()}
        onClick={() => toggle(id)}
        disabled={disabled}
        aria-pressed={selectedPeriod}
        title={
          period.motivo_bloqueo ||
          (blockedBySpecial
            ? "Desmarcá la modalidad especial seleccionada para cambiar."
            : blockedByFreeMode
              ? "Desactivá el monto libre para seleccionar esta modalidad."
              : undefined)
        }
        aria-label={`${period.nombre} ${anio}: ${stateText.toLowerCase()}`}
      >
        <strong>{period.nombre}</strong>
        <small>{anio}</small>
        <span>{stateText}</span>
      </button>
    );
  };

  const selectedItems = selected
    .map((id) => periodMap.get(Number(id)))
    .filter(Boolean);
  const selectedMonthlyCount = selected.filter((id) =>
    PERIODOS_MENSUALES.has(Number(id)),
  ).length;
  const selectedSpecialCount = selected.filter((id) =>
    SPECIAL_PERIODS.has(Number(id)),
  ).length;

  const familyMembers = context?.familia?.integrantes || [];
  const familyHasResolvedSelected = familyMembers.some((member) =>
    selected.some((id) => memberResolvedStatus(member, id)),
  );

  const alumnoNombre =
    alumno?.denominacion || alumno?.nombre_completo || "Alumno";
  const alumnoDocumento = alumno?.documento || alumno?.dni || "—";
  const alumnoCurso = alumno?.curso || "Sin curso";
  const alumnoCategoria = alumno?.categoria || "Sin categoría";
  const alumnoFamilia =
    alumno?.familia || context?.familia?.nombre_familia || "Sin grupo familiar";

  const tabs = [
    {
      value: "periods",
      label: "Meses a pagar",
      icon: faCalendarDays,
      badge: selectedMonthlyCount || null,
    },
    {
      value: "special",
      label: "Anual / especiales",
      icon: faCoins,
      badge: selectedSpecialCount || null,
    },
    {
      value: "family",
      label: "Familia",
      icon: faUsers,
      badge: Number(context?.familia?.integrantes_activos || 0) || null,
    },
    ...(!condoning
      ? [
          {
            value: "amounts",
            label: "Importe por período",
            icon: faMoneyBillWave,
            badge: selected.length || null,
          },
        ]
      : []),
  ];

  const submitLabel = condoning
    ? selected.length > 1
      ? `Condonar ${selected.length} períodos`
      : "Confirmar condonación"
    : family && context?.familia?.tiene_familia
      ? "Registrar pago familiar"
      : selected.length > 1
        ? `Registrar ${selected.length} cuotas`
        : "Registrar pago";

  return (
    <CrudModal
      open={open}
      title={alumnoNombre}
      subtitle={
        <span className="cuotas-payment-header-meta">
          <span>DNI {alumnoDocumento}</span>
          <span>{alumnoCurso}</span>
          <span>{alumnoCategoria}</span>
          <span>{alumnoFamilia}</span>
        </span>
      }
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      loading={loading}
      loadingLabel="Cargando datos del pago..."
      loadingText="Consultando períodos disponibles y grupo familiar."
      submitLabel={submitLabel}
      danger={condoning}
      submitDisabled={submitDisabled}
      wide
      modalClassName="cuotas-payment-modal cuotas-modal--payment"
      footerStart={
        <div className="cuotas-payment-footer-total">
          <span>{condoning ? "Importe condonado" : "Total a pagar"}</span>
          <strong>{money(operationTotal)}</strong>
          <small>
            {selected.length
              ? `${selected.length} ${selected.length === 1 ? "período seleccionado" : "períodos seleccionados"}`
              : "Sin períodos seleccionados"}
          </small>
        </div>
      }
    >
      {context?.aviso ? (
        <div className="cuotas-package-notice" role="status">
          <strong>Aviso</strong>
          <span>{context.aviso}</span>
        </div>
      ) : null}

      <EntityTabs
        tabs={tabs}
        value={activePaymentTab}
        onChange={setActivePaymentTab}
        idPrefix="cooperadora-payment-tab"
        ariaLabel="Secciones del pago"
      />

      <div
        id={`cooperadora-payment-tab-${activePaymentTab}-panel`}
        className="cuotas-payment-tab-panel"
        role="tabpanel"
        aria-labelledby={`cooperadora-payment-tab-${activePaymentTab}`}
      >
        {activePaymentTab === "periods" ? (
          <div className="cuotas-payment-main-row">
            {renderPaymentData()}

            <section
              className="cuotas-period-group cuotas-period-selector"
              aria-label="Cuotas mensuales"
            >
              <header>
                <div>
                  <span>Períodos disponibles</span>
                  <small>
                    Marzo a diciembre. Podés registrar varios meses en una sola
                    operación.
                  </small>
                </div>
                <div className="cuotas-period-selector__actions">
                  <PaymentYearChip
                    value={anio}
                    options={years}
                    onChange={changeYear}
                    disabled={loading}
                  />
                  <div
                    className="cuotas-period-amount"
                    aria-label={`Total seleccionado ${money(operationTotal)}`}
                  >
                    <span>Total selección</span>
                    <strong>{money(operationTotal)}</strong>
                  </div>
                  <button
                    type="button"
                    className="cuotas-select-all"
                    onClick={toggleAllMonthly}
                    disabled={loading || !availableMonthly.length}
                  >
                    {allMonthlySelected
                      ? "Deseleccionar todos"
                      : "Seleccionar todos"}
                  </button>
                </div>
              </header>

              <div className={`cuotas-month-grid ${loading ? "is-loading" : ""}`}>
                {monthly.map((period) => renderPeriodButton(period))}
              </div>
            </section>
          </div>
        ) : null}

        {activePaymentTab === "special" ? (
          <div className="cuotas-payment-main-row">
            {renderPaymentData()}

            <section
              className="cuotas-period-group cuotas-period-selector"
              aria-label="Pagos especiales"
            >
              <header>
                <div>
                  <span>Pagos especiales</span>
                  <small>
                    Contado anual, mitades y matrícula respetan la cobertura ya
                    registrada.
                  </small>
                </div>
                <div className="cuotas-period-selector__actions">
                  <PaymentYearChip
                    value={anio}
                    options={years}
                    onChange={changeYear}
                    disabled={loading}
                  />
                  <div
                    className="cuotas-period-amount"
                    aria-label={`Total seleccionado ${money(operationTotal)}`}
                  >
                    <span>Total selección</span>
                    <strong>{money(operationTotal)}</strong>
                  </div>
                </div>
              </header>

              <div className={`cuotas-month-grid ${loading ? "is-loading" : ""}`}>
                {specialPeriods.map((period) => renderPeriodButton(period))}
              </div>
            </section>

            {!condoning && special.matricula ? (
              <section
                className="cuotas-registration-card"
                aria-label="Configuración de matrícula"
              >
                <header className="cuotas-registration-card__header">
                  <div className="cuotas-registration-card__identity">
                    <span
                      className="cuotas-registration-card__icon"
                      aria-hidden="true"
                    >
                      <FontAwesomeIcon icon={faIdCard} />
                    </span>
                    <div className="cuotas-registration-card__copy">
                      <div className="cuotas-registration-card__eyebrow">
                        <span>Configuración</span>
                        <em>Valor global</em>
                      </div>
                      <strong>Matrícula</strong>
                      <small>
                        Este importe se usa como valor sugerido para nuevos pagos
                        de matrícula.
                      </small>
                    </div>
                  </div>

                  <div className="cuotas-registration-card__suggested">
                    <span>Importe vigente</span>
                    <strong>{money(special.matricula.monto_sugerido)}</strong>
                    <small>Año {anio}</small>
                  </div>
                </header>

                <div className="cuotas-registration-card__body">
                  {editingMatricula ? (
                    <div className="cuotas-registration-fields">
                      <FloatingField label="Nuevo importe *" active>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={matriculaGlobal}
                          onChange={(event) =>
                            setMatriculaGlobal(amountInput(event.target.value))
                          }
                          placeholder="0,00"
                          aria-label="Nuevo importe de matrícula"
                        />
                      </FloatingField>
                      <button
                        type="button"
                        className="mov-btn mov-btn--primary"
                        disabled={updatingMatricula}
                        onClick={saveGlobalRegistration}
                      >
                        {updatingMatricula ? "Guardando..." : "Guardar valor"}
                      </button>
                      <button
                        type="button"
                        className="mov-btn mov-btn--ghost"
                        disabled={updatingMatricula}
                        onClick={() => {
                          setMatriculaGlobal(
                            String(Number(special.matricula?.monto_sugerido || 0)),
                          );
                          setEditingMatricula(false);
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mov-btn mov-btn--ghost"
                      onClick={() => setEditingMatricula(true)}
                    >
                      <FontAwesomeIcon icon={faPenToSquare} />
                      Editar valor global
                    </button>
                  )}

                  <div className="cuotas-registration-note" role="note">
                    <FontAwesomeIcon icon={faIdCard} aria-hidden="true" />
                    <span>
                      Cambiar este valor no modifica pagos de matrícula ya
                      registrados.
                    </span>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {activePaymentTab === "family" ? (
          <div className="cuotas-payment-top-context">
            {context?.familia?.tiene_familia ? (
              <section
                className="cuotas-family-card"
                aria-label="Grupo familiar del alumno"
              >
                <div className="cuotas-family-card__head">
                  <div className="cuotas-family-card__identity">
                    <span className="cuotas-family-card__icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faUsers} />
                    </span>
                    <div>
                      <span>Grupo familiar</span>
                      <strong>
                        {context.familia.nombre_familia || "Familia"}
                      </strong>
                      <small>
                        {context.familia.cantidad_total || familyMembers.length}{" "}
                        integrantes · {context.familia.integrantes_activos || 0}{" "}
                        activos
                      </small>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`cuotas-family-expand-btn ${
                      familyExpanded ? "is-open" : ""
                    }`.trim()}
                    onClick={() => setFamilyExpanded((current) => !current)}
                    aria-expanded={familyExpanded}
                    aria-controls="cooperadora-family-members-list"
                  >
                    <span>
                      {familyExpanded ? "Ocultar integrantes" : "Ver integrantes"}
                    </span>
                    <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
                  </button>
                </div>

                <label className="cuotas-family-toggle">
                  <input
                    type="checkbox"
                    checked={family}
                    disabled={!selected.length || !context.familia.integrantes_activos}
                    onChange={(event) => setFamily(event.target.checked)}
                    aria-label="Aplicar pago a todo el grupo familiar"
                  />
                  <span>
                    <strong>Aplicar pago a todo el grupo familiar</strong>
                    <small>
                      {!selected.length
                        ? "Seleccioná uno o más períodos para habilitar el pago familiar."
                        : family
                          ? "Se registrarán los períodos pendientes para los integrantes activos del grupo."
                          : `El pago se registrará únicamente para ${alumnoNombre}.`}
                    </small>
                  </span>
                </label>

                {familyHasResolvedSelected ? (
                  <div className="cuotas-family-paid-note" role="status">
                    <strong>Hay períodos ya registrados.</strong>
                    <span>
                      Los integrantes marcados en verde ya tienen alguno de los
                      períodos seleccionados y el backend omitirá esos cruces.
                    </span>
                  </div>
                ) : null}

                <div
                  className={`cuotas-family-members-shell ${
                    familyExpanded ? "is-open" : ""
                  }`.trim()}
                  aria-hidden={!familyExpanded}
                >
                  <div
                    id="cooperadora-family-members-list"
                    className="cuotas-family-members"
                  >
                    {familyMembers.map((member) => {
                      const resolvedPeriods = selectedItems.filter((period) =>
                        memberResolvedStatus(member, period.id_mes),
                      );
                      const resolvedLabels = resolvedPeriods.map(
                        (period) => period.nombre,
                      );
                      const resolved = resolvedPeriods.length > 0;

                      return (
                        <article
                          key={member.id_alumno || member.id_socio}
                          className={`${!member.activo ? "is-unavailable" : ""} ${
                            resolved ? "has-paid-selected-period" : ""
                          }`.trim()}
                        >
                          <div>
                            <strong>{member.denominacion}</strong>
                            <span>
                              {member.documento || "SIN DNI"} · {member.curso || "SIN CURSO"}
                            </span>
                            {resolved ? (
                              <small
                                className="cuotas-family-paid-badge"
                                title={resolvedLabels.join(", ")}
                              >
                                Registró {resolvedLabels.join(" · ")}
                              </small>
                            ) : null}
                          </div>
                          <div>
                            {resolved ? (
                              <>
                                <strong className="cuotas-family-paid-status">
                                  REGISTRADO
                                </strong>
                                <small>{resolvedLabels.join(" · ")}</small>
                              </>
                            ) : (
                              <>
                                <strong>{member.activo ? "ACTIVO" : "BAJA"}</strong>
                                <small>{member.curso || "Sin curso"}</small>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : (
              <div className="cuotas-no-family">
                <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
                <span>Este alumno no pertenece a un grupo familiar.</span>
              </div>
            )}
          </div>
        ) : null}

        {activePaymentTab === "amounts" && !condoning ? (
          <aside className="cuotas-payment-date-card is-amounts-only">
            <div className="cuotas-payment-date-card__fields">
              {selectedItems.length ? (
                <div className="cuotas-month-amount-editor">
                  <div className="cuotas-month-amount-editor__title">
                    <span>Importe por período</span>
                    <small>
                      Ajustá los importes antes de confirmar. El total del pie se
                      actualiza automáticamente.
                    </small>
                  </div>

                  <div className="cuotas-month-amount-editor__list">
                    <section className="cuotas-month-amount-row">
                      <div className="cuotas-month-amount-row__head">
                        <strong>Monto libre mensual</strong>
                        <span>{freeMode ? money(freeAmount || 0) : "Opcional"}</span>
                      </div>
                      <label className="cuotas-custom-amount-toggle">
                        <input
                          type="checkbox"
                          checked={freeMode}
                          onChange={(event) =>
                            toggleFreeMode(event.target.checked)
                          }
                        />
                        <span>Usar el mismo importe para cuotas mensuales</span>
                      </label>
                      {freeMode ? (
                        <FloatingField label="Monto libre por mes *" active>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={freeAmount}
                            onChange={(event) =>
                              applyFreeAmount(event.target.value)
                            }
                            placeholder="0,00"
                            aria-label="Monto libre por mes"
                          />
                        </FloatingField>
                      ) : null}
                    </section>

                    {selectedItems.map((period) => (
                      <section
                        className="cuotas-month-amount-row"
                        key={`amount-${anio}-${period.id_mes}`}
                      >
                        <div className="cuotas-month-amount-row__head">
                          <strong>{period.nombre}</strong>
                          <span>{money(amounts[String(period.id_mes)] || 0)}</span>
                        </div>
                        <FloatingField label="Importe *" active>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={amounts[String(period.id_mes)] ?? ""}
                            onChange={(event) =>
                              setAmounts((current) => ({
                                ...current,
                                [String(period.id_mes)]: amountInput(
                                  event.target.value,
                                ),
                              }))
                            }
                            disabled={
                              freeMode && PERIODOS_MENSUALES.has(Number(period.id_mes))
                            }
                            placeholder="0,00"
                            aria-label={`Importe de ${period.nombre}`}
                          />
                        </FloatingField>
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="cuotas-payment-tab-empty" role="status">
                  <strong>No hay períodos seleccionados</strong>
                  <span>
                    Elegí una o más cuotas o modalidades especiales para editar
                    sus importes.
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePaymentTab("periods")}
                  >
                    Ir a Meses a pagar
                  </button>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </CrudModal>
  );
}
