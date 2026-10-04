import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faCircleCheck,
  faClock,
  faHouse,
  faRotateRight,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { dashboardApi } from "./api/dashboardApi";
import "./Dashboard.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const EMPTY = {
  periodo: {},
  alumnos: {},
  familias: {},
  cuotas: {},
  contable: {},
  actividad: {},
  serie_cuotas: [],
  fuentes: {},
};

function MetricCard({ icon, title, value, detail, tone = "default", keepValueVisible = false }) {
  return (
    <article
      className={`admin-dashboard__metric is-${tone}${keepValueVisible ? " has-visible-value" : ""}`}
    >
      <div className="admin-dashboard__metricIcon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__metricBody">
        <span>{title}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function GeneralIndicator({ icon, label, value, detail, tone = "default" }) {
  return (
    <article className={`admin-dashboard__indicator is-${tone}`}>
      <div className="admin-dashboard__indicatorIcon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__indicatorBody">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function FeaturedGeneralIndicator({ icon, label, value, detail, tone = "default" }) {
  return (
    <article className={`admin-dashboard__indicator admin-dashboard__indicator--featured is-${tone}`}>
      <div className="admin-dashboard__indicatorIcon admin-dashboard__indicatorIcon--featured">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__indicatorBody admin-dashboard__indicatorBody--featured">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function PaymentChart({ items }) {
  const maximum = useMemo(
    () => Math.max(1, ...items.map((item) => Number(item.cubiertas || 0))),
    [items],
  );

  return (
    <div
      className="admin-dashboard__chart"
      role="img"
      aria-label="Cuotas cubiertas durante los últimos seis períodos de Cooperadora"
    >
      <div className="admin-dashboard__chartGrid" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="admin-dashboard__chartColumns">
        {items.map((item) => {
          const covered = Number(item.cubiertas || 0);
          const height = covered > 0 ? Math.max(5, (covered / maximum) * 100) : 0;
          return (
            <div className="admin-dashboard__chartMonth" key={item.periodo}>
              <strong className="admin-dashboard__chartValue">{covered}</strong>
              <div className="admin-dashboard__bars">
                <i
                  className="is-paid"
                  style={{ height: `${height}%` }}
                  title={`${covered} cuota${covered === 1 ? "" : "s"} cubierta${covered === 1 ? "" : "s"}`}
                />
              </div>
              <strong>{item.etiqueta}</strong>
              <small>{String(item.anio || "").slice(-2)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    dashboardApi
      .resumen({ signal: controller.signal })
      .then((response) => setSummary(response.resumen || EMPTY))
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          setError(
            requestError?.message ||
              "No se pudo cargar el panel de Cooperadora.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const {
    alumnos = {},
    familias = {},
    cuotas = {},
    contable = {},
    periodo = {},
  } = summary;

  const balance = Number(contable.saldo_mes || 0);
  const currentCompliance = Number(cuotas.cumplimiento_mes || 0);
  const feesEnabled = periodo.cuotas_habilitadas !== false;
  const covered = Number(cuotas.cubiertas_mes || 0);
  const expected = Number(cuotas.esperadas_mes || 0);

  const complianceDetail = feesEnabled
    ? `${covered} cubiertas de ${expected} esperadas`
    : "Enero y febrero no tienen cuota mensual programada";

  return (
    <section className="admin-dashboard">
      <header className="admin-dashboard__header">
        <div>
          <h1>Panel de gestión</h1>
          <p>Resumen actualizado de alumnos, cuotas y movimientos de Cooperadora.</p>
        </div>
        <div className="admin-dashboard__period">
          <FontAwesomeIcon icon={faCalendarDays} />
          <span>{periodo.mes_nombre || "MES ACTUAL"}</span>
          <strong>{periodo.anio || new Date().getFullYear()}</strong>
        </div>
      </header>

      {error ? (
        <div className="admin-dashboard__error" role="alert">
          <div>
            <strong>No se pudo cargar el dashboard</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <FontAwesomeIcon icon={faRotateRight} /> Reintentar
          </button>
        </div>
      ) : null}

      <div className={`admin-dashboard__body ${loading ? "is-loading" : ""}`}>
        <section className="admin-dashboard__metrics">
          <MetricCard
            icon={faUsers}
            title="Alumnos activos"
            value={Number(alumnos.activos || 0)}
            detail={`${Number(alumnos.bajas || 0)} de baja · ${Number(alumnos.egresados || 0)} egresados`}
          />
          <MetricCard
            icon={faCircleCheck}
            title="Cuotas cubiertas"
            value={covered}
            detail={
              feesEnabled
                ? `${Number(cuotas.pagadas_mes || 0)} pagadas · ${Number(cuotas.condonadas_mes || 0)} condonadas`
                : "Sin cuota mensual en este período"
            }
            tone="success"
          />
          <MetricCard
            icon={faClock}
            title="Cuotas pendientes"
            value={Number(cuotas.pendientes_mes || 0)}
            detail={feesEnabled ? `${currentCompliance}% de cumplimiento · ${expected} esperadas` : "Próximo período: marzo"}
            tone={feesEnabled && Number(cuotas.pendientes_mes || 0) > 0 ? "warning" : "success"}
          />
          <MetricCard
            icon={faWallet}
            title="Saldo del mes"
            value={money(contable.saldo_mes)}
            detail={`Ingresos ${money(contable.ingresos_mes)} · Egresos ${money(contable.egresos_mes)}`}
            tone={balance < 0 ? "danger" : "balance"}
            keepValueVisible
          />
        </section>

        <div className="admin-dashboard__mainGrid">
          <article className="admin-dashboard__panel admin-dashboard__panel--chart">
            <header className="admin-dashboard__panelHead">
              <div>
                <h2>Cuotas cubiertas</h2>
                <p>Alumnos con el período cubierto durante los últimos seis meses de cuota.</p>
              </div>
              <span className="admin-dashboard__statusChip is-complete">
                <FontAwesomeIcon icon={faCircleCheck} />
                {feesEnabled ? `${covered} cubiertas del período` : "Sin cuota este mes"}
              </span>
            </header>
            <PaymentChart items={summary.serie_cuotas || []} />
          </article>

          <aside className="admin-dashboard__panel admin-dashboard__panel--indicators">
            <header className="admin-dashboard__panelHead">
              <div>
                <h2>Indicadores generales</h2>
                <p>Estado actual del padrón y la cobranza mensual.</p>
              </div>
            </header>

            <div className="admin-dashboard__indicatorGrid">
              <FeaturedGeneralIndicator
                icon={faCircleCheck}
                label="Cumplimiento del mes"
                value={feesEnabled ? `${currentCompliance}%` : "—"}
                detail={complianceDetail}
                tone="quality"
              />

              <GeneralIndicator
                icon={faUsers}
                label="Alumnos activos"
                value={Number(alumnos.activos || 0)}
                detail="En el padrón actual"
                tone="people"
              />
              <GeneralIndicator
                icon={faClock}
                label="Alumnos de baja"
                value={Number(alumnos.bajas || 0)}
                detail="No incluye egresados"
                tone="muted"
              />
              <GeneralIndicator
                icon={faCircleCheck}
                label="Egresados"
                value={Number(alumnos.egresados || 0)}
                detail={`${Number(alumnos.egresados_mes || 0)} egresados este mes`}
                tone="success"
              />
              <GeneralIndicator
                icon={faHouse}
                label="Familias activas"
                value={Number(familias.activas || 0)}
                detail={`${Number(alumnos.con_familia || 0)} alumnos vinculados`}
                tone="category"
              />
            </div>
          </aside>
        </div>

        <footer className="admin-dashboard__footer">
          Desarrollado por{" "}
          <a href="https://3devsnet.com" target="_blank" rel="noopener noreferrer">
            3devs.solutions
          </a>
        </footer>
      </div>
    </section>
  );
}
