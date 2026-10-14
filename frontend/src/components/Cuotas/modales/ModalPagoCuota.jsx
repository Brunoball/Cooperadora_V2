import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faCoins,
  faIdCard,
  faPenToSquare,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import { EntityTabs } from "../../Global/Formularios/TabbedForm";
import "./CuotasModal.css";
import "./ModalPagoCuota.css";

const PERIODOS_MENSUALES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const ANUAL = 13;
const MATRICULA = 14;
const COBRADOR_PORCENTAJE = 15;
const MITAD_1 = 15;
const MITAD_2 = 16;
const H1_MONTHS = new Set([3, 4, 5, 6, 7]);
const H2_MONTHS = new Set([8, 9, 10, 11, 12]);

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
  if (period.pagado) return period.periodo_pago ? `Pagado por ${period.periodo_pago}` : "Pagado";
  if (period.motivo_bloqueo) return "No disponible por cobertura previa";
  return "Disponible";
};

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
  const [amounts, setAmounts] = useState({});
  const [matriculaGlobal, setMatriculaGlobal] = useState("");
  const [editingMatricula, setEditingMatricula] = useState(false);
  const [updatingMatricula, setUpdatingMatricula] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [freeAmount, setFreeAmount] = useState("");
  const [activePaymentTab, setActivePaymentTab] = useState("monthly");

  const periods = useMemo(() => context?.periodos || [], [context?.periodos]);
  const periodMap = useMemo(
    () => new Map(periods.map((item) => [Number(item.id_mes), item])),
    [periods],
  );

  // Los meses del año en curso usan la tarifa familiar VIGENTE para una
  // misma composición familiar. El histórico se conserva en la BD para
  // consultar pagos anteriores; no modifica los precios guardados.
  const tarifaFamiliarActual = useMemo(() => {
    if (Number(anio) !== new Date().getFullYear() || !context?.familia?.tiene_familia) return null;
    const candidatos = (context?.periodos || [])
      .filter((item) => PERIODOS_MENSUALES.has(Number(item.id_mes))
        && Number(item.cantidad_familia_elegible || 0) >= 2
        && Number(item.monto_sugerido || 0) > 0)
      .sort((a, b) => Number(b.id_mes) - Number(a.id_mes));
    const vigente = candidatos[0];
    if (!vigente) return null;
    return {
      importe: Number(vigente.monto_sugerido),
      integrantes: Number(vigente.cantidad_familia_elegible),
    };
  }, [anio, context?.periodos, context?.familia?.tiene_familia]);

  const montoSugeridoFormulario = (period) => {
    if (tarifaFamiliarActual && PERIODOS_MENSUALES.has(Number(period.id_mes))
      && Number(period.cantidad_familia_elegible || 0) === tarifaFamiliarActual.integrantes
      && Number(period.monto_sugerido || 0) > 0) {
      return tarifaFamiliarActual.importe;
    }
    return Number(period.monto_sugerido || 0);
  };

  useEffect(() => {
    if (!open) return;
    setFecha(today());
    setAnio(String(initialYear || new Date().getFullYear()));
    setSelected(initialPeriod ? [Number(initialPeriod)] : []);
    setMedio("");
    setFamily(Boolean(context?.familia?.tiene_familia && context?.familia?.integrantes_activos > 0));
    setAmounts({});
    setEditingMatricula(false);
    setMatriculaGlobal("");
    setFreeMode(false);
    setFreeAmount("");
    setActivePaymentTab([ANUAL, MATRICULA, MITAD_1, MITAD_2].includes(Number(initialPeriod)) ? "special" : "monthly");
  }, [open, alumno?.id_alumno, initialYear, initialPeriod, context?.familia?.tiene_familia, context?.familia?.integrantes_activos]);

  useEffect(() => {
    if (!open || !context) return;
    const defaults = {};
    (context.periodos || []).forEach((item) => {
      defaults[String(item.id_mes)] = String(montoSugeridoFormulario(item));
    });
    setAmounts(defaults);
    const registration = (context.periodos || []).find((item) => Number(item.id_mes) === MATRICULA);
    setMatriculaGlobal(String(Number(registration?.monto_sugerido || 0)));
  }, [context, open, tarifaFamiliarActual]);

  const years = useMemo(() => {
    const all = new Set((catalogos?.anios || []).map(String));
    all.add(String(initialYear || new Date().getFullYear()));
    all.add(String(new Date().getFullYear() + 1));
    return Array.from(all).sort((a, b) => Number(b) - Number(a));
  }, [catalogos?.anios, initialYear]);

  // Los meses anteriores al ingreso no generan deuda ni muestran casilla;
  // si existe un pago/condonación heredado, su casilla permanece visible.
  const monthly = periods.filter((item) =>
    PERIODOS_MENSUALES.has(Number(item.id_mes)) && !item.ocultar_por_ingreso);
  const rangoMensual = monthly.length
    ? `${monthly[0].nombre} a ${monthly[monthly.length - 1].nombre}`
    : "Sin cuotas mensuales aplicables";
  const special = {
    anual: periodMap.get(ANUAL),
    mitad1: periodMap.get(MITAD_1),
    mitad2: periodMap.get(MITAD_2),
    matricula: periodMap.get(MATRICULA),
  };

  const canSelect = (period) => Boolean(period?.puede_pagar);
  const selectedSet = new Set(selected.map(Number));
  const monthBlockedBySelection = (id) =>
    selectedSet.has(ANUAL)
    || (selectedSet.has(MITAD_1) && H1_MONTHS.has(Number(id)))
    || (selectedSet.has(MITAD_2) && H2_MONTHS.has(Number(id)));

  const toggle = (id) => {
    const numeric = Number(id);
    const period = periodMap.get(numeric);
    if (!canSelect(period)) return;

    setSelected((current) => {
      const has = current.includes(numeric);
      if (has) return current.filter((value) => value !== numeric);

      const next = [...current];
      if (PERIODOS_MENSUALES.has(numeric)) {
        const blocked = next.includes(ANUAL)
          || (next.includes(MITAD_1) && H1_MONTHS.has(numeric))
          || (next.includes(MITAD_2) && H2_MONTHS.has(numeric));
        return blocked ? current : [...next, numeric];
      }

      if (numeric === ANUAL) {
        return [...next.filter((value) => !PERIODOS_MENSUALES.has(Number(value)) && value !== MITAD_1 && value !== MITAD_2), ANUAL];
      }

      if (numeric === MITAD_1 || numeric === MITAD_2) {
        const other = numeric === MITAD_1 ? MITAD_2 : MITAD_1;
        const range = numeric === MITAD_1 ? H1_MONTHS : H2_MONTHS;
        const cleaned = next.filter((value) => value !== ANUAL && !(PERIODOS_MENSUALES.has(Number(value)) && range.has(Number(value))));
        // Igual que el sistema anterior: elegir las dos mitades equivale al anual completo.
        if (cleaned.includes(other) && canSelect(periodMap.get(ANUAL))) {
          return [...cleaned.filter((value) => value !== other), ANUAL];
        }
        return [...cleaned, numeric];
      }

      return [...next, numeric];
    });
  };

  const availableMonthly = monthly.filter((item) => canSelect(item) && !monthBlockedBySelection(item.id_mes)).map((item) => Number(item.id_mes));
  const allMonthlySelected = availableMonthly.length > 0 && availableMonthly.every((id) => selectedSet.has(id));
  const selectedMonthly = monthly.filter((period) => selectedSet.has(Number(period.id_mes)));
  const toggleAllMonthly = () => {
    if (allMonthlySelected) {
      setSelected((current) => current.filter((id) => !availableMonthly.includes(Number(id))));
      return;
    }
    setSelected((current) => Array.from(new Set([...current, ...availableMonthly])));
  };

  // Vista previa por alumno y por período: la comisión se calcula sobre lo
  // realmente cobrado a cada alumno marcado como cobrador, nunca sobre el total
  // de toda la familia. El backend recalcula al confirmar dentro de la transacción.
  const estimaciones = condoning ? [] : selected.map((periodId) => {
    const period = periodMap.get(Number(periodId));
    const amount = Math.max(0, Number(amounts[String(periodId)] || 0));
    const principalId = Number(alumno?.id_alumno || alumno?.id_socio || context?.alumno?.id_alumno);
    const roster = family && context?.familia?.tiene_familia
      ? (context.familia.integrantes || []).filter((m) => m.activo)
      : [{ id_alumno: principalId, es_cobrador: Boolean(context?.alumno?.es_cobrador ?? alumno?.es_cobrador) }];
    // En las cuotas mensuales se excluyen hermanos que no habían ingresado.
    const applicableIds = new Set((period?.ids_familia_aplicable || []).map(Number));
    const targets = roster.filter((member) => {
      const id = Number(member.id_alumno || member.id_socio);
      if (family && PERIODOS_MENSUALES.has(Number(periodId)) && !applicableIds.has(id)) return false;
      const state = String(member.periodos?.[periodId] || 'DEUDOR').toUpperCase();
      return state === 'DEUDOR';
    });
    const useCurrentFamilyRate = Boolean(family && tarifaFamiliarActual && !freeMode
      && PERIODOS_MENSUALES.has(Number(periodId))
      && Number(period?.cantidad_familia_elegible || 0) === tarifaFamiliarActual.integrantes
      && Math.abs(amount - tarifaFamiliarActual.importe) < 0.01);
    const isFamilyDiscount = family && Boolean(period?.descuento_familiar_aplicado)
      && (Math.abs(amount - Number(period?.monto_sugerido || 0)) < 0.005 || useCurrentFamilyRate);
    const allocationIds = family
      ? (isFamilyDiscount ? (period?.ids_familia_reparto || []) : (period?.ids_familia_aplicable || []))
          .map(Number).sort((a, b) => a - b)
      : [principalId];
    const ids = allocationIds.length > 0 ? allocationIds : [principalId];
    const adjustedAmount = period?.mitad_parcial && Number(periodId) === ANUAL ? amount / 2 : amount;
    let totalGroup = Math.round(adjustedAmount * ids.length);
    if (useCurrentFamilyRate && ids.length > 1) {
      const roundedThousand = Math.round(totalGroup / 1000) * 1000;
      if (Math.abs(roundedThousand - totalGroup) <= Math.min(3, ids.length)) totalGroup = roundedThousand;
    }
    const quotient = Math.floor(totalGroup / ids.length);
    const remainder = totalGroup - quotient * ids.length;
    const distributedAmounts = new Map(ids.map((id, index) => [id, quotient + (index < remainder ? 1 : 0)]));
    const details = targets.map((member) => {
      const id = Number(member.id_alumno || member.id_socio);
      const gross = ids.length > 1 && distributedAmounts.has(id)
        ? distributedAmounts.get(id) : Math.round(adjustedAmount);
      const commission = member.es_cobrador ? Math.round(gross * COBRADOR_PORCENTAJE / 100) : 0;
      return { gross, commission };
    });
    return {
      id_mes: Number(periodId),
      gross: details.reduce((sum, item) => sum + item.gross, 0),
      commission: details.reduce((sum, item) => sum + item.commission, 0),
    };
  });
  const operationTotal = estimaciones.reduce((sum, item) => sum + item.gross, 0);
  const collectorTotal = estimaciones.reduce((sum, item) => sum + item.commission, 0);

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
      setSelected((current) => current.filter((id) => ![ANUAL, MITAD_1, MITAD_2].includes(Number(id))));
      if (freeAmount !== "") applyFreeAmount(freeAmount);
      return;
    }
    setAmounts((current) => {
      const next = { ...current };
      monthly.forEach((period) => {
        next[String(period.id_mes)] = String(montoSugeridoFormulario(period));
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
    (!condoning && selected.some((id) => Number(amounts[String(id)] || 0) <= 0));

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
      // La API revalida contra categoria_hermanos antes de aplicar esta marca.
      usar_tarifa_familiar_actual: Boolean(tarifaFamiliarActual && !freeMode && selected.some((id) => {
        const period = periodMap.get(Number(id));
        return period && PERIODOS_MENSUALES.has(Number(id))
          && Number(period.cantidad_familia_elegible || 0) === tarifaFamiliarActual.integrantes
          && Math.abs(Number(amounts[String(id)] || 0) - tarifaFamiliarActual.importe) < 0.01;
      })),
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

  const renderPeriodCard = (period, extraClass = "") => {
    if (!period) return null;
    const id = Number(period.id_mes);
    const active = selectedSet.has(id);
    const blockedBySpecial = PERIODOS_MENSUALES.has(id) && monthBlockedBySelection(id);
    const blockedByFreeMode = freeMode && [ANUAL, MITAD_1, MITAD_2].includes(id);
    const disabled = !canSelect(period) || blockedBySpecial || blockedByFreeMode;
    return (
      <article
        className={`cuotas-v2-period ${active ? "is-selected" : ""} ${disabled ? "is-disabled" : ""} ${period.pagado ? "is-paid" : ""} ${extraClass}`.trim()}
        key={id}
      >
        <button
          type="button"
          className="cuotas-v2-period__select"
          onClick={() => toggle(id)}
          disabled={disabled}
          aria-pressed={active}
        >
          <strong className="cuotas-v2-period__title">{period.nombre}</strong>
          <small className="cuotas-v2-period__year">{anio}</small>
          <small className={`cuotas-v2-period__status ${disabled ? "is-resolved" : ""}`}>
            {blockedBySpecial || blockedByFreeMode ? "Modalidad exclusiva" : active && !disabled ? "Seleccionado" : statusLabel(period)}
          </small>
        </button>
        {!condoning && !disabled && !PERIODOS_MENSUALES.has(id) ? (
          <label className="cuotas-v2-amount-field">
            <span>Monto</span>
            <input
              type="text"
              inputMode="decimal"
              value={amounts[String(id)] ?? ""}
              onChange={(event) =>
                setAmounts((current) => ({
                  ...current,
                  [String(id)]: amountInput(event.target.value),
                }))
              }
              disabled={!active}
            />
          </label>
        ) : null}
      </article>
    );
  };

  // La selección de meses y la edición de sus importes ocupan pestañas diferentes.
  // Ambos paneles comparten el estado para conservar los cambios al navegar.
  const renderMonthlyAmounts = () => condoning ? null : (
    <section className="cuotas-payment-date-card is-amounts-only cuotas-v2-monthly-amounts" aria-labelledby="cuotas-month-amounts-heading">
      <div className="cuotas-month-amount-editor">
        <div className="cuotas-month-amount-editor__title">
          <span id="cuotas-month-amounts-heading">Montos de las cuotas</span>
          <small>Modificá el importe de los meses seleccionados en la pestaña Cuotas.</small>
        </div>
        <div className={`cuotas-v2-free-amount ${freeMode ? "is-active" : ""}`}>
          <label>
            <input type="checkbox" checked={freeMode} onChange={(event) => toggleFreeMode(event.target.checked)} />
            <span>Usar <strong>monto libre por mes</strong></span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Monto libre por mes"
            placeholder="Monto libre"
            value={freeAmount}
            disabled={!freeMode}
            onChange={(event) => applyFreeAmount(event.target.value)}
          />
          <small>Aplica el mismo importe a los meses y deshabilita la modalidad anual o por mitades.</small>
        </div>
        {selectedMonthly.length > 0 ? (
          <div className="cuotas-month-amount-editor__list">
            {selectedMonthly.map((period) => {
              const id = String(period.id_mes);
              return (
                <div className="cuotas-month-amount-row cuotas-v2-monthly-amount-row" key={id}>
                  <div className="cuotas-month-amount-row__head">
                    <strong>{period.nombre} <small>{anio}</small></strong>
                    <span>{money(amounts[id])}</span>
                  </div>
                  <label className="cuotas-v2-monthly-amount-field">
                    <span>Monto a pagar</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Monto a pagar de ${period.nombre}`}
                      value={amounts[id] ?? ""}
                      onChange={(event) => setAmounts((current) => ({
                        ...current,
                        [id]: amountInput(event.target.value),
                      }))}
                    />
                  </label>
                  <small className="cuotas-v2-monthly-amount-suggested">Tarifa aplicada: {money(montoSugeridoFormulario(period))}{Math.abs(montoSugeridoFormulario(period) - Number(period.monto_sugerido || 0)) > 0.01 ? " (familiar actual; precio histórico conservado)" : ""}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cuotas-v2-monthly-amounts__empty">
            <p>Seleccioná al menos un mes en la pestaña Cuotas para modificar su monto.</p>
            <button type="button" className="mov-btn mov-btn--ghost" onClick={() => setActivePaymentTab("monthly")}>
              Ir a Cuotas
            </button>
          </div>
        )}
      </div>
    </section>
  );

  const renderPaymentToolbar = () => (
    <section className="cuotas-payment-date-card">
      <div className="cuotas-payment-date-card__header">
        <span>Datos del pago</span>
        <small>Completá la fecha y el medio de pago.</small>
      </div>
      <div className="cuotas-v2-payment-toolbar cuotas-v2-payment-toolbar--inside-tab">
      <label>
        <span><FontAwesomeIcon icon={faCalendarDays} /> Fecha</span>
        <input
          type="date"
          value={fecha}
          max={fechaMaxima}
          onChange={(event) => changeDate(event.target.value)}
        />
      </label>
      <label className="global-year-select-field">
        <span>Año</span>
        <select value={anio} onChange={(event) => changeYear(event.target.value)}>
          {years.map((year) => <option value={year} key={year}>{year}</option>)}
        </select>
      </label>
      {!condoning ? (
        <label>
          <span><FontAwesomeIcon icon={faCoins} /> Medio de pago</span>
          <select value={medio} onChange={(event) => setMedio(event.target.value)}>
            <option value="">Seleccionar...</option>
            {(catalogos?.medios_pago || []).map((item) => (
              <option value={item.id_medio_pago} key={item.id_medio_pago}>{item.nombre}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="cuotas-v2-condone-note">
          La condonación se guarda con importe $0 y sin medio de pago.
        </div>
      )}
      </div>
    </section>
  );

  const alumnoNombre = alumno?.denominacion || alumno?.nombre_completo || "Alumno";
  const alumnoDocumento = alumno?.documento || alumno?.dni || "—";
  const alumnoCurso = alumno?.curso || "Sin curso";
  const alumnoCategoria = alumno?.categoria || "Sin categoría";
  const alumnoInterno = String(alumnoCategoria).trim().toUpperCase() === "INTERNO";
  const alumnoFamilia = alumno?.familia || context?.familia?.nombre_familia || "Sin grupo familiar";

  return (
    <CrudModal
      open={open}
      title={condoning ? "Condonar cuota" : alumnoNombre}
      subtitle={<span className="cuotas-payment-header-meta"><span>DNI {alumnoDocumento}</span><span>{alumnoCurso}</span><span>Categoría {alumnoCategoria}</span><span>{alumnoFamilia}</span></span>}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      loading={loading}
      loadingLabel="Cargando cuotas..."
      submitLabel={condoning ? "Confirmar condonación" : "Registrar pago"}
      danger={condoning}
      submitDisabled={submitDisabled}
      wide
      modalClassName="cuotas-v2-payment-modal cuotas-modal--payment"
      footerStart={
        <div className="cuotas-v2-footer-totals">
          <div className="cuotas-payment-footer-total">
            <span>{condoning ? "Importe condonado" : "Total operación"}</span>
            <small>{selected.length} {selected.length === 1 ? "período seleccionado" : "períodos seleccionados"}</small>
            <strong>{money(operationTotal)}</strong>
          </div>
          {!condoning && collectorTotal > 0 ? (
            <div className="cuotas-v2-footer-collector-box" aria-label={`Comisión del cobrador del ${COBRADOR_PORCENTAJE} por ciento: ${money(collectorTotal)}`}>
              <span>Comisión del cobrador</span>
              <small>{COBRADOR_PORCENTAJE}% del total</small>
              <strong>{money(collectorTotal)}</strong>
            </div>
          ) : null}
        </div>
      }
    >
      <div className="cuotas-v2-payment-body">
        {context?.aviso ? <div className="cuotas-v2-warning">{context.aviso}</div> : null}

        <EntityTabs
          tabs={[
            {
              value: "monthly",
              label: "Cuotas",
              icon: faCalendarDays,
              badge: selected.filter((id) => PERIODOS_MENSUALES.has(Number(id))).length || null,
            },
            ...(!condoning ? [{
              value: "amounts",
              label: "Montos de las cuotas",
              icon: faPenToSquare,
              badge: selectedMonthly.length || null,
            }] : []),
            {
              value: "special",
              label: "Anual / especiales",
              icon: faCoins,
              badge: selected.filter((id) => [ANUAL, MATRICULA, MITAD_1, MITAD_2].includes(Number(id))).length || null,
            },
            {
              value: "family",
              label: "Familia",
              icon: faUsers,
              badge: Number(context?.familia?.integrantes_activos || 0) || null,
            },
          ]}
          value={activePaymentTab}
          onChange={setActivePaymentTab}
          idPrefix="cooperadora-payment-tab"
          ariaLabel="Secciones del pago"
          className="cuotas-v2-payment-tabs"
        />

        <div
          id={`cooperadora-payment-tab-${activePaymentTab}-panel`}
          className="cuotas-v2-payment-tab-panel"
          role="tabpanel"
          aria-labelledby={`cooperadora-payment-tab-${activePaymentTab}`}
        >
          {activePaymentTab === "monthly" ? (
            <section className="cuotas-v2-section cuotas-v2-section--monthly">
              {renderPaymentToolbar()}
              <div className="cuotas-period-group cuotas-period-selector">
              <header className="cuotas-v2-section__head">
                <div>
                  <h3>Cuotas mensuales</h3>
                  <p>{alumnoInterno ? `${rangoMensual}. Los alumnos internos no abonan diciembre.` : `${rangoMensual}. Podés seleccionar varios meses en una sola operación.`} {!condoning ? "Editá los importes desde la pestaña Montos de las cuotas." : ""}</p>
                </div>
                <button type="button" className="mov-btn mov-btn--ghost" onClick={toggleAllMonthly} disabled={!availableMonthly.length}>
                  {allMonthlySelected ? "Quitar disponibles" : "Seleccionar disponibles"}
                </button>
              </header>
              <div className="cuotas-v2-period-grid">
                {monthly.map((period) => renderPeriodCard(period))}
              </div>
              </div>
            </section>
          ) : null}

          {activePaymentTab === "amounts" && !condoning ? (
            <section className="cuotas-v2-section cuotas-v2-section--amounts">
              {renderMonthlyAmounts()}
            </section>
          ) : null}

          {activePaymentTab === "special" ? (
            <section className="cuotas-v2-section cuotas-v2-section--special">
              {renderPaymentToolbar()}
              <div className="cuotas-period-group cuotas-period-selector">
              <header className="cuotas-v2-section__head">
                <div>
                  <h3>Pagos especiales</h3>
                  <p>Seleccioná contado anual, mitades o matrícula.</p>
                </div>
              </header>
              <div className="cuotas-v2-special-grid">
                {renderPeriodCard(special.anual, "is-special")}
                {renderPeriodCard(special.mitad1, "is-special")}
                {renderPeriodCard(special.mitad2, "is-special")}
                <div className="cuotas-v2-registration-card">
                  {renderPeriodCard(special.matricula, "is-special")}
                  {!condoning && special.matricula ? (
                    <div className="cuotas-v2-registration-global">
                      <div>
                        <small>Monto global de matrícula</small>
                        <strong>{money(special.matricula.monto_sugerido)}</strong>
                      </div>
                      {editingMatricula ? (
                        <div className="cuotas-v2-registration-editor">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={matriculaGlobal}
                            onChange={(event) => setMatriculaGlobal(amountInput(event.target.value))}
                          />
                          <button type="button" className="mov-btn mov-btn--primary" disabled={updatingMatricula} onClick={saveGlobalRegistration}>
                            {updatingMatricula ? "Guardando..." : "Guardar global"}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="mov-btn mov-btn--ghost" onClick={() => setEditingMatricula(true)}>
                          <FontAwesomeIcon icon={faPenToSquare} /> Editar global
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
            </section>
          ) : null}

          {activePaymentTab === "family" ? (
            context?.familia?.tiene_familia ? (
              <section className="cuotas-v2-section cuotas-v2-family-section">
                <header className="cuotas-v2-section__head">
                  <div>
                    <h3><FontAwesomeIcon icon={faUsers} /> Grupo familiar</h3>
                    <p>
                      {context.familia.nombre_familia || "Familia"} · {context.familia.cantidad_total} integrante(s) cargado(s), {context.familia.integrantes_activos} activo(s).
                    </p>
                  </div>
                  <label className="cuotas-v2-family-toggle">
                    <input type="checkbox" checked={family} onChange={(event) => setFamily(event.target.checked)} />
                    <span>Aplicar al grupo familiar</span>
                  </label>
                </header>
                <div className="cuotas-v2-family-list">
                  {(context.familia.integrantes || []).map((member) => (
                    <div className={`cuotas-v2-family-member ${member.activo ? "" : "is-inactive"}`} key={member.id_alumno || member.id_socio}>
                      <FontAwesomeIcon icon={faIdCard} />
                      <span>{member.denominacion}</span>
                      <small>{member.curso || "Sin curso"}</small>
                      <b>{member.activo ? "ACTIVO" : "BAJA"}</b>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="cuotas-v2-section cuotas-v2-family-empty" aria-label="Alumno sin grupo familiar">
                <FontAwesomeIcon icon={faUsers} />
                <div>
                  <strong>Sin grupo familiar</strong>
                  <span>Este alumno no pertenece actualmente a una familia registrada.</span>
                </div>
              </section>
            )
          ) : null}
        </div>
      </div>
    </CrudModal>
  );
}
