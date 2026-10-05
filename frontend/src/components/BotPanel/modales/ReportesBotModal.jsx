import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowTrendUp,
  faCalendarDays,
  faChartColumn,
  faCircleCheck,
  faComments,
  faCreditCard,
  faFileInvoiceDollar,
  faMessage,
  faMoneyBillTransfer,
  faReceipt,
  faSpinner,
  faTriangleExclamation,
  faUserPlus,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./ReportesBotModal.css";

const PANEL_API =
  process.env.REACT_APP_BOT_PANEL_URL ||
  "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/endpoints";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const formatNumber = (value) =>
  new Intl.NumberFormat("es-AR").format(Number(value || 0));

const formatMoneyArs = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const formatMoneyUsd = (value, digits = 4) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(Number(value));
};

const COST_FILTERS = [
  ["todos", "Todos"],
  ["inicio_mes", "Principio de mes"],
  ["deudores_mes", "Mitad de mes"],
  ["campania", "Campañas"],
];

const formatDate = (value) => {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const periodLabel = (value) => {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) return value || "";
  return `${MONTHS[month - 1]} ${year}`;
};

const normalizePeriod = (year, month) =>
  `${Number(year)}-${String(Number(month)).padStart(2, "0")}`;

const MetricCard = ({ icon, label, value, detail, tone = "normal" }) => (
  <div className={`wp-report-card is-${tone}`}>
    <div className="wp-report-card-icon" aria-hidden="true">
      <FontAwesomeIcon icon={icon} />
    </div>
    <div className="wp-report-card-body">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  </div>
);

const DetailRow = ({ label, value, hint, strong = false }) => (
  <div className={`wp-report-detail-row ${strong ? "is-strong" : ""}`}>
    <div>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </div>
    <b>{value}</b>
  </div>
);

const ReportesBotModal = ({ open, onClose }) => {
  const now = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState(() =>
    normalizePeriod(now.getFullYear(), now.getMonth() + 1)
  );
  const [tab, setTab] = useState("resumen");
  const [costFilter, setCostFilter] = useState("todos");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const periodMenuRef = useRef(null);
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);

  useModalEscapeStack(open, onClose);

  const fetchReport = useCallback(async (targetPeriod) => {
    const [anio, mes] = String(targetPeriod || "").split("-").map(Number);
    if (!anio || !mes) return;

    setLoading(true);
    setError("");
    try {
      const url = `${PANEL_API}/panel_reportes.php?anio=${encodeURIComponent(anio)}&mes=${encodeURIComponent(mes)}&_=${Date.now()}`;
      const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "include" });
      const response = await res.json().catch(() => null);
      if (!res.ok || !response || response.success === false) {
        throw new Error(response?.error || "No se pudo cargar el reporte");
      }
      setData(response);
    } catch (e) {
      setError("No se pudo cargar el resumen. Intentá nuevamente en unos momentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab("resumen");
    setCostFilter("todos");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetchReport(period);
  }, [open, period, fetchReport]);

  const periodOptions = useMemo(() => {
    const current = normalizePeriod(now.getFullYear(), now.getMonth() + 1);
    const raw = Array.isArray(data?.periodos_disponibles)
      ? data.periodos_disponibles
      : [];
    return [...new Set([current, period, ...raw].filter(Boolean))].sort().reverse();
  }, [data, now, period]);

  const togglePeriodMenu = useCallback(() => {
    if (loading) return;
    setPeriodMenuOpen((prev) => !prev);
  }, [loading]);

  const handlePeriodSelect = useCallback((nextPeriod) => {
    setPeriod(nextPeriod);
    setPeriodMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!periodMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (periodMenuRef.current?.contains(event.target)) return;
      setPeriodMenuOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setPeriodMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [periodMenuOpen]);

  useEffect(() => {
    if (!open) setPeriodMenuOpen(false);
  }, [open]);

  if (!open) return null;

  const resumen = data?.resumen || {};
  const actividad = data?.actividad || {};
  const eventos = actividad?.eventos || {};
  const pagos = data?.pagos || {};
  const ventas = data?.ventas || {};
  const comprobantes = ventas?.comprobantes || {};
  const costos = data?.costos_whatsapp || {};
  const costosTotales = costos?.totales || {};
  const costosDetalle = Array.isArray(costos?.detalle) ? costos.detalle : [];
  const costosFiltrados = costFilter === "todos"
    ? costosDetalle
    : costosDetalle.filter((item) => item?.tipo === costFilter);
  const warnings = Array.isArray(data?.advertencias) ? data.advertencias : [];

  return (
    <div className="wp-report-backdrop" role="dialog" aria-modal="true" aria-label="Resumen mensual del bot">
      <div className="wp-report-modal">
        <header className="wp-report-head">
          <div className="wp-report-head-title">
            <span className="wp-report-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faChartColumn} />
            </span>
            <div>
              <span className="wp-report-eyebrow">WhatsApp · Cooperadora</span>
              <h2>Resumen del Bot</h2>
              <p>Actividad, pagos y ventas gestionadas desde WhatsApp, agrupadas por mes.</p>
            </div>
          </div>

          <div className="wp-report-head-actions">
            <div
              className={`wp-report-period ${periodMenuOpen ? "is-open" : ""}`}
              ref={periodMenuRef}
            >
              <button
                type="button"
                className="wp-report-period-trigger"
                onClick={togglePeriodMenu}
                aria-label="Período del resumen"
                aria-haspopup="listbox"
                aria-expanded={periodMenuOpen}
                disabled={loading}
              >
                <span className="wp-report-period-trigger-inner">
                  <span className="wp-report-period-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faCalendarDays} />
                  </span>
                  <span className="wp-report-period-value">{periodLabel(period)}</span>
                  <span className="wp-report-period-chevron" aria-hidden="true" />
                </span>
              </button>

              {periodMenuOpen ? (
                <div className="wp-report-period-menu" role="listbox" aria-label="Opciones de período">
                  {periodOptions.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={`wp-report-period-option ${item === period ? "is-selected" : ""}`}
                      onClick={() => handlePeriodSelect(item)}
                      role="option"
                      aria-selected={item === period}
                    >
                      {periodLabel(item)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="wp-report-close"
              onClick={onClose}
              aria-label="Cerrar resumen"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </header>

        <nav className="wp-report-tabs" aria-label="Secciones del resumen">
          {[
            ["resumen", "Resumen"],
            ["actividad", "Actividad"],
            ["pagos", "Pagos"],
            ["ventas", "Ventas"],
            ["costos", "Mensajes y costos"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={tab === key ? "is-active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="wp-report-body">
          {error ? (
            <div className="wp-report-error">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <div>
                <b>No se pudo cargar el resumen</b>
                <span>{error}</span>
              </div>
            </div>
          ) : null}

          {loading && !data ? (
            <div className="wp-report-loading">
              <FontAwesomeIcon icon={faSpinner} spin />
              <span>Cargando métricas del bot…</span>
            </div>
          ) : null}

          {!error && data && warnings.length ? (
            <div className="wp-report-info-box is-warning">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <div>
                <b>El resumen se cargó parcialmente</b>
                <span>{warnings.join(" ")}</span>
              </div>
            </div>
          ) : null}

          {!error && data && tab === "resumen" ? (
            <div className="wp-report-section">
              <div className="wp-report-section-title">
                <div>
                  <h3>Resumen de {periodLabel(data?.periodo?.clave || period)}</h3>
                  <p>Los indicadores principales para entender qué pasó en el bot durante el mes.</p>
                </div>
              </div>

              <div className="wp-report-grid">
                <MetricCard
                  icon={faUsers}
                  label="Contactos acumulados"
                  value={formatNumber(resumen.contactos_total_fin_mes)}
                  detail="Total existente al cierre del período"
                />
                <MetricCard
                  icon={faUserPlus}
                  label="Contactos nuevos"
                  value={formatNumber(resumen.contactos_nuevos)}
                  detail="Se agregaron durante el mes"
                  tone="good"
                />
                <MetricCard
                  icon={faArrowTrendUp}
                  label="Contactos con actividad"
                  value={formatNumber(resumen.contactos_con_actividad)}
                  detail="Tuvieron al menos un mensaje"
                />
                <MetricCard
                  icon={faMessage}
                  label="Mensajes recibidos"
                  value={formatNumber(resumen.mensajes_recibidos)}
                  detail={`${formatNumber(resumen.personas_que_escribieron)} personas escribieron`}
                />
                <MetricCard
                  icon={faComments}
                  label="Mensajes enviados"
                  value={formatNumber(resumen.mensajes_enviados_bot)}
                  detail="Respuestas automáticas y desde el panel"
                />
                <MetricCard
                  icon={faMoneyBillTransfer}
                  label="Alumnos con pagos"
                  value={formatNumber(resumen.alumnos_pagaron_bot)}
                  detail={`${formatNumber(resumen.registros_pago_bot)} conceptos registrados`}
                  tone="good"
                />
              </div>

              <div className="wp-report-summary-strip">
                <div>
                  <span>Monto de pagos por WhatsApp</span>
                  <b>{formatMoneyArs(resumen.monto_pagos_bot)}</b>
                  <small>Pagos aprobados por Mercado Pago desde el bot</small>
                </div>
                <div>
                  <span>Ventas escolares aprobadas</span>
                  <b>{formatNumber(resumen.ventas_aprobadas_bot)}</b>
                  <small>{formatMoneyArs(resumen.monto_ventas_bot)} vendidos desde WhatsApp</small>
                </div>
                <div>
                  <span>Alertas del mes</span>
                  <b>{formatNumber(resumen.alertas_mes)}</b>
                  <small>Errores y advertencias generados durante el período</small>
                </div>
                <div>
                  <span>Costo de mensajes cobrables</span>
                  <b>{formatMoneyArs(resumen.costo_whatsapp_ars_total)}</b>
                  <small>{formatMoneyUsd(resumen.costo_whatsapp_usd)} · impuestos incluidos</small>
                </div>
              </div>
            </div>
          ) : null}

          {!error && data && tab === "actividad" ? (
            <div className="wp-report-section">
              <div className="wp-report-section-title">
                <div>
                  <h3>Actividad del bot</h3>
                  <p>Volumen de conversación, consultas y alertas registradas durante el período.</p>
                </div>
              </div>

              <div className="wp-report-grid is-activity">
                <MetricCard icon={faComments} label="Mensajes totales" value={formatNumber(actividad.mensajes_total)} />
                <MetricCard icon={faMessage} label="Recibidos" value={formatNumber(actividad.mensajes_recibidos)} tone="good" />
                <MetricCard icon={faChartColumn} label="Enviados" value={formatNumber(actividad.mensajes_enviados_bot)} />
                <MetricCard icon={faUsers} label="Personas que escribieron" value={formatNumber(actividad.personas_que_escribieron)} />
                <MetricCard icon={faTriangleExclamation} label="Prioridad alta" value={formatNumber(actividad.prioridad_alta)} tone="warn" />
                <MetricCard icon={faCircleCheck} label="Consultas atendidas" value={`${formatNumber(actividad.consultas_atendidas)} / ${formatNumber(actividad.consultas)}`} tone="good" />
              </div>

              <div className="wp-report-panel">
                <h4>Lectura rápida</h4>
                <DetailRow label="Contactos con alguna actividad" value={formatNumber(actividad.contactos_con_actividad)} />
                <DetailRow label="Personas que iniciaron interacción" value={formatNumber(actividad.personas_que_escribieron)} />
                <DetailRow label="Errores generados" value={formatNumber(eventos.errores)} />
                <DetailRow label="Advertencias generadas" value={formatNumber(eventos.warnings)} />
                <DetailRow label="Consultas marcadas como atendidas" value={formatNumber(actividad.consultas_atendidas)} strong />
              </div>
            </div>
          ) : null}

          {!error && data && tab === "pagos" ? (
            <div className="wp-report-section is-payments-tab">
              <div className="wp-report-section-title">
                <div>
                  <h3>Pagos gestionados desde WhatsApp</h3>
                  <p>Pagos aprobados por Mercado Pago desde WhatsApp durante el período.</p>
                </div>
              </div>

              <div className="wp-report-grid is-payments">
                <MetricCard
                  icon={faUsers}
                  label="Alumnos que pagaron"
                  value={formatNumber(pagos.alumnos_pagaron)}
                  detail={`${formatNumber(pagos.registros)} conceptos acreditados por Mercado Pago`}
                  tone="good"
                />
                <MetricCard
                  icon={faCreditCard}
                  label="Conceptos registrados"
                  value={formatNumber(pagos.registros)}
                  detail="Cuotas, matrícula o períodos especiales"
                />
                <MetricCard
                  icon={faMoneyBillTransfer}
                  label="Monto registrado"
                  value={formatMoneyArs(pagos.monto_total)}
                  detail="Total aprobado y registrado por Mercado Pago"
                  tone="good"
                />
              </div>

              <div className="wp-report-panel">
                <h4>Medio utilizado</h4>
                <DetailRow label="Mercado Pago" value={formatNumber(pagos.mercado_pago_registros)} hint="Conceptos aprobados y registrados por el bot" strong />
              </div>

              {Array.isArray(pagos.detalle) && pagos.detalle.length ? (
                <div className="wp-report-payment-history">
                  <div className="wp-report-payment-history-head">
                    <div>
                      <h4>Detalle de pagos del mes</h4>
                      <span>Cada fila agrupa los conceptos de un alumno abonados el mismo día.</span>
                    </div>
                    <b>{formatNumber(pagos.detalle.length)}</b>
                  </div>

                  <div className="wp-report-payment-list">
                    {pagos.detalle.map((pago, index) => {
                      const periods = Array.isArray(pago.periodos) ? pago.periodos : [];
                      return (
                        <div className="wp-report-payment-item" key={`${pago.id_alumno || "pago"}-${pago.fecha || index}-${pago.medio || ""}`}>
                          <div className="wp-report-payment-main">
                            <div className="wp-report-payment-person">
                              <strong>{pago.alumno || "Alumno"}</strong>
                              <span>
                                {formatDate(pago.fecha)} · {pago.medio || "Medio de pago"}
                                {pago.dni ? ` · DNI ${pago.dni}` : ""}
                              </span>
                            </div>
                            <div className="wp-report-payment-periods">
                              {periods.map((item, periodIndex) => <span key={`${item}-${periodIndex}`}>{item}</span>)}
                            </div>
                          </div>
                          <div className="wp-report-payment-side">
                            <strong>{formatMoneyArs(pago.monto)}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="wp-report-info-box">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  <div>
                    <b>Sin pagos registrados desde el bot en este período</b>
                    <span>No hay pagos aprobados por Mercado Pago desde el bot para el mes seleccionado.</span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!error && data && tab === "costos" ? (
            <div className="wp-report-section is-costs-tab">
              <div className="wp-report-section-title">
                <div>
                  <h3>Mensajes programados y costos de WhatsApp</h3>
                  <p>Recordatorios y campañas enviados en producción, con tarifa Meta, dólar del día e impuestos.</p>
                </div>
              </div>

              <div className="wp-report-grid is-costs">
                <MetricCard
                  icon={faCircleCheck}
                  label="Entregados / cobrables"
                  value={formatNumber(costosTotales.facturables)}
                  detail={`${formatNumber(costosTotales.aceptados)} aceptados · ${formatNumber(costosTotales.sin_cargo)} sin cargo`}
                  tone="good"
                />
                <MetricCard
                  icon={faComments}
                  label="Pendientes de entrega"
                  value={formatNumber(costosTotales.pendientes)}
                  detail={`${formatNumber(costosTotales.fallidos)} fallidos`}
                />
                <MetricCard
                  icon={faFileInvoiceDollar}
                  label="Costo Meta"
                  value={formatMoneyUsd(costosTotales.costo_usd)}
                  detail="Sólo mensajes confirmados como entregados"
                />
                <MetricCard
                  icon={faMoneyBillTransfer}
                  label="Pesos antes de impuestos"
                  value={formatMoneyArs(costosTotales.costo_ars_base)}
                  detail="Conversión con dólar oficial venta del día"
                />
                <MetricCard
                  icon={faReceipt}
                  label="Impuestos / percepción"
                  value={formatMoneyArs(costosTotales.impuestos_ars)}
                  detail={`${Number(costos.impuesto_pct_default || 0).toLocaleString("es-AR")} % configurado`}
                />
                <MetricCard
                  icon={faCreditCard}
                  label="Costo final estimado"
                  value={formatMoneyArs(costosTotales.costo_ars_total)}
                  detail="Meta + conversión + impuestos"
                  tone="good"
                />
              </div>

              <div className="wp-report-cost-rates">
                <div>
                  <span>Recordatorios · Utility</span>
                  <b>{formatMoneyUsd(costos?.tarifas_actuales?.utility_usd, 5)} / mensaje</b>
                </div>
                <div>
                  <span>Campañas · Marketing</span>
                  <b>{formatMoneyUsd(costos?.tarifas_actuales?.marketing_usd, 5)} / mensaje</b>
                </div>
                <div>
                  <span>Criterio de costo</span>
                  <b>Entregados por Meta</b>
                </div>
              </div>

              <div className="wp-report-cost-filters" role="tablist" aria-label="Tipo de mensaje">
                {COST_FILTERS.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={costFilter === key ? "is-active" : ""}
                    onClick={() => setCostFilter(key)}
                    role="tab"
                    aria-selected={costFilter === key}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {costosFiltrados.length ? (
                <div className="wp-report-cost-history">
                  <div className="wp-report-cost-history-head">
                    <div>
                      <h4>Detalle por fecha de envío</h4>
                      <span>Se conserva la tarifa, la cotización usada y el porcentaje de impuestos de cada envío.</span>
                    </div>
                    <b>{formatNumber(costosFiltrados.length)}</b>
                  </div>

                  <div className="wp-report-cost-list">
                    {costosFiltrados.map((item, index) => (
                      <article
                        className="wp-report-cost-item"
                        key={`${item.fecha || "fecha"}-${item.tipo || "tipo"}-${item.template_name || index}-${index}`}
                      >
                        <div className="wp-report-cost-item-head">
                          <div>
                            <strong>{item.tipo_label || "Mensaje"}</strong>
                            <span>
                              {formatDateTime(item.primer_envio_en || item.fecha)}
                              {item.ultimo_envio_en && item.ultimo_envio_en !== item.primer_envio_en
                                ? ` → ${formatDateTime(item.ultimo_envio_en)}`
                                : ""}
                              {` · ${item.categoria || "—"}`}
                            </span>
                          </div>
                          <div className="wp-report-cost-item-total">
                            <span>Total con impuestos</span>
                            <b>{formatMoneyArs(item.costo_ars_total)}</b>
                          </div>
                        </div>

                        <div className="wp-report-cost-item-grid">
                          <div><span>Entregados</span><b>{formatNumber(item.facturables)}</b></div>
                          <div><span>Aceptados</span><b>{formatNumber(item.aceptados)}</b></div>
                          <div><span>Pendientes</span><b>{formatNumber(item.pendientes)}</b></div>
                          <div><span>Fallidos</span><b>{formatNumber(item.fallidos)}</b></div>
                          <div><span>Entregados sin cargo</span><b>{formatNumber(item.sin_cargo)}</b></div>
                          <div><span>Tarifa unitaria</span><b>{formatMoneyUsd(item.precio_unitario_usd, 5)}</b></div>
                          <div><span>Costo USD</span><b>{formatMoneyUsd(item.costo_usd, 5)}</b></div>
                          <div><span>Dólar usado</span><b>{item.cotizacion_usd_ars ? formatMoneyArs(item.cotizacion_usd_ars) : "Pendiente"}</b></div>
                          <div><span>Base en pesos</span><b>{formatMoneyArs(item.costo_ars_base)}</b></div>
                          <div><span>Impuestos ({Number(item.impuesto_pct || 0).toLocaleString("es-AR")} %)</span><b>{formatMoneyArs(item.impuestos_ars)}</b></div>
                        </div>

                        <div className="wp-report-cost-item-foot">
                          <span className="wp-report-cost-template">{item.template_name || "Plantilla"}</span>
                          <span>
                            Cotización: {item.fecha_cotizacion ? formatDate(item.fecha_cotizacion) : "pendiente"}
                            {item.fuente_cotizacion && item.fuente_cotizacion !== "sin_cotizacion"
                              ? ` · ${item.fuente_cotizacion}`
                              : ""}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="wp-report-info-box">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  <div>
                    <b>Sin mensajes cobrables de este tipo en el período</b>
                    <span>Cuando Meta confirme entregas de recordatorios o campañas, aparecerán aquí con su costo.</span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!error && data && tab === "ventas" ? (
            <div className="wp-report-section">
              <div className="wp-report-section-title">
                <div>
                  <h3>Ventas escolares desde WhatsApp</h3>
                  <p>Órdenes aprobadas por el bot y estado de comprobantes de transferencia recibidos.</p>
                </div>
              </div>

              <div className="wp-report-grid is-payments">
                <MetricCard
                  icon={faReceipt}
                  label="Órdenes aprobadas"
                  value={formatNumber(ventas.ordenes_aprobadas)}
                  detail="Ventas originadas en el bot"
                  tone="good"
                />
                <MetricCard
                  icon={faUsers}
                  label="Compradores"
                  value={formatNumber(ventas.compradores)}
                  detail="Personas distintas con ventas aprobadas"
                />
                <MetricCard
                  icon={faFileInvoiceDollar}
                  label="Monto vendido"
                  value={formatMoneyArs(ventas.monto_total)}
                  detail="Total de órdenes aprobadas"
                  tone="good"
                />
              </div>

              <div className="wp-report-panel">
                <h4>Comprobantes de transferencia recibidos</h4>
                <DetailRow label="Recibidos en el mes" value={formatNumber(comprobantes.total)} />
                <DetailRow label="Confirmados" value={formatNumber(comprobantes.confirmados)} />
                <DetailRow label="Revisados" value={formatNumber(comprobantes.revisados)} />
                <DetailRow label="Pendientes de revisión" value={formatNumber(comprobantes.pendientes)} />
                <DetailRow label="Descartados" value={formatNumber(comprobantes.descartados)} />
              </div>

              {Array.isArray(ventas.detalle) && ventas.detalle.length ? (
                <div className="wp-report-payment-history">
                  <div className="wp-report-payment-history-head">
                    <div>
                      <h4>Detalle de ventas aprobadas</h4>
                      <span>Comprador, campaña, fecha, orden y total.</span>
                    </div>
                    <b>{formatNumber(ventas.detalle.length)}</b>
                  </div>

                  <div className="wp-report-payment-list">
                    {ventas.detalle.map((venta, index) => (
                      <div className="wp-report-payment-item" key={`${venta.id_orden || "venta"}-${index}`}>
                        <div className="wp-report-payment-main">
                          <div className="wp-report-payment-person">
                            <strong>{venta.persona || "Comprador"}</strong>
                            <span>
                              {formatDateTime(venta.fecha)}
                              {venta.dni ? ` · DNI ${venta.dni}` : ""}
                              {venta.codigo ? ` · ${venta.codigo}` : ""}
                            </span>
                          </div>
                          {venta.campania ? (
                            <div className="wp-report-payment-periods">
                              <span>{venta.campania}</span>
                            </div>
                          ) : null}
                        </div>
                        <div className="wp-report-payment-side">
                          <strong>{formatMoneyArs(venta.monto)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="wp-report-info-box">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  <div>
                    <b>Sin ventas escolares aprobadas en este período</b>
                    <span>No se registraron órdenes aprobadas originadas desde WhatsApp para el mes seleccionado.</span>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReportesBotModal;
