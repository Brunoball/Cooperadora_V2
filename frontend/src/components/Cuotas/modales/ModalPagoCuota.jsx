import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faCheck,
  faCoins,
  faIdCard,
  faPenToSquare,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import { EntityTabs } from "../../Global/Formularios/TabbedForm";
import "./CuotasModal.css";

const PERIODOS_MENSUALES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const ANUAL = 13;
const MATRICULA = 14;
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
      defaults[String(item.id_mes)] = String(Number(item.monto_sugerido || 0));
    });
    setAmounts(defaults);
    const registration = (context.periodos || []).find((item) => Number(item.id_mes) === MATRICULA);
    setMatriculaGlobal(String(Number(registration?.monto_sugerido || 0)));
  }, [context, open]);

  const years = useMemo(() => {
    const all = new Set((catalogos?.anios || []).map(String));
    all.add(String(initialYear || new Date().getFullYear()));
    all.add(String(new Date().getFullYear() + 1));
    return Array.from(all).sort((a, b) => Number(b) - Number(a));
  }, [catalogos?.anios, initialYear]);

  const monthly = periods.filter((item) => PERIODOS_MENSUALES.has(Number(item.id_mes)));
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
  const toggleAllMonthly = () => {
    if (allMonthlySelected) {
      setSelected((current) => current.filter((id) => !availableMonthly.includes(Number(id))));
      return;
    }
    setSelected((current) => Array.from(new Set([...current, ...availableMonthly])));
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
      setSelected((current) => current.filter((id) => ![ANUAL, MITAD_1, MITAD_2].includes(Number(id))));
      if (freeAmount !== "") applyFreeAmount(freeAmount);
      return;
    }
    setAmounts((current) => {
      const next = { ...current };
      monthly.forEach((period) => {
        next[String(period.id_mes)] = String(Number(period.monto_sugerido || 0));
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
        className={`cuotas-v2-period ${active ? "is-selected" : ""} ${disabled ? "is-disabled" : ""} ${extraClass}`.trim()}
        key={id}
      >
        <button
          type="button"
          className="cuotas-v2-period__select"
          onClick={() => toggle(id)}
          disabled={disabled}
        >
          <span className="cuotas-v2-period__check">
            {active ? <FontAwesomeIcon icon={faCheck} /> : null}
          </span>
          <span className="cuotas-v2-period__title">{period.nombre}</span>
          <small className={`cuotas-v2-period__status ${disabled ? "is-resolved" : ""}`}>
            {statusLabel(period)}
          </small>
        </button>
        {!condoning && !disabled ? (
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

  const renderPaymentToolbar = () => (
    <section className="cuotas-v2-payment-toolbar cuotas-v2-payment-toolbar--inside-tab">
      <label>
        <span><FontAwesomeIcon icon={faCalendarDays} /> Fecha</span>
        <input
          type="date"
          value={fecha}
          max={fechaMaxima}
          onChange={(event) => changeDate(event.target.value)}
        />
      </label>
      <label>
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
    </section>
  );

  const alumnoNombre = alumno?.denominacion || alumno?.nombre_completo || "Alumno";
  const alumnoDocumento = alumno?.documento || alumno?.dni || "—";
  const alumnoCurso = alumno?.curso || "Sin curso";
  const alumnoCategoria = alumno?.categoria || "Sin categoría";
  const alumnoFamilia = alumno?.familia || context?.familia?.nombre_familia || "Sin grupo familiar";
  const subtitle = `${alumnoNombre} · DNI ${alumnoDocumento} · ${alumnoCurso} · ${alumnoCategoria} · ${alumnoFamilia}`;

  return (
    <CrudModal
      open={open}
      title={condoning ? "Condonar cuota" : "Registrar pago"}
      subtitle={subtitle}
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
        <div className="cuotas-v2-footer-total">
          <small>{condoning ? "Importe condonado" : "Total operación"}</small>
          <strong>{money(operationTotal)}</strong>
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
              <header className="cuotas-v2-section__head">
                <div>
                  <h3>Cuotas mensuales</h3>
                  <p>Marzo a diciembre. Podés seleccionar varios meses en una sola operación.</p>
                </div>
                <button type="button" className="mov-btn mov-btn--ghost" onClick={toggleAllMonthly} disabled={!availableMonthly.length}>
                  {allMonthlySelected ? "Quitar disponibles" : "Seleccionar disponibles"}
                </button>
              </header>
              {!condoning ? (
                <div className={`cuotas-v2-free-amount ${freeMode ? "is-active" : ""}`}>
                  <label>
                    <input type="checkbox" checked={freeMode} onChange={(event) => toggleFreeMode(event.target.checked)} />
                    <span>Usar <strong>monto libre por mes</strong></span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Monto libre"
                    value={freeAmount}
                    disabled={!freeMode}
                    onChange={(event) => applyFreeAmount(event.target.value)}
                  />
                  <small>Al activarlo, el mismo importe se aplica a los meses seleccionados y se deshabilita el anual/mitades.</small>
                </div>
              ) : null}
              <div className="cuotas-v2-period-grid">
                {monthly.map((period) => renderPeriodCard(period))}
              </div>
            </section>
          ) : null}

          {activePaymentTab === "special" ? (
            <section className="cuotas-v2-section cuotas-v2-section--special">
              {renderPaymentToolbar()}
              <header className="cuotas-v2-section__head">
                <div>
                  <h3>Pagos especiales</h3>
                  <p>Contado anual, mitades y matrícula mantienen exactamente la cobertura del sistema anterior.</p>
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
