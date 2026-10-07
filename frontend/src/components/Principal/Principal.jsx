import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faChartLine,
  faCashRegister,
  faGear,
  faReceipt,
  faRightFromBracket,
  faRobot,
  faTags,
  faUsers,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { clearSession, getSession } from "../_shared/auth/session";
import { apiPost } from "../_shared/api/apiClient";
import ModalPerfil from "../Perfil/ModalPerfil";
import logoRh from "../../imagenes/Escudo_ipet50.png";
import { BOT_PANEL_URL } from "../../config/config";
import "./principal.css";
import useGlobalModalEscape from "../Global/Modales/useGlobalModalEscape";

const NAV_ITEMS = [
  {
    key: "administracion",
    label: "Administración",
    path: "/panel",
    icon: faChartLine,
  },
  {
    key: "alumnos",
    label: "Alumnos",
    path: "/alumnos",
    defaultPath: "/alumnos/listado",
    icon: faUsers,
    children: [
      { key: "alumnos-listado", label: "Alumnos", path: "/alumnos/listado" },
      { key: "alumnos-ingresantes", label: "Ingresantes", path: "/alumnos/ingresantes" },
      { key: "alumnos-familias", label: "Familias", path: "/alumnos/familias" },
    ],
  },
  { key: "cuotas", label: "Cuotas", path: "/cuotas", icon: faReceipt },
  {
    key: "ventas",
    label: "Ventas",
    path: "/ventas",
    defaultPath: "/ventas/registradas",
    icon: faCashRegister,
    children: [
      { key: "ventas-registradas", label: "Ventas registradas", path: "/ventas/registradas" },
      { key: "ventas-productos", label: "Productos", path: "/ventas/productos" },
      { key: "ventas-configuracion", label: "Configuración", path: "/ventas/configuracion" },
      { key: "ventas-planillas", label: "Planillas", path: "/ventas/planillas" },
    ],
  },
  {
    key: "categorias",
    label: "Categorías",
    path: "/categorias",
    defaultPath: "/categorias",
    icon: faTags,
    children: [
      { key: "categorias-listado", label: "Categorías", path: "/categorias" },
      {
        key: "categorias-descuentos",
        label: "Valores por hermanos",
        path: "/categorias/descuentos",
      },
    ],
  },
  {
    key: "contable",
    label: "Contabilidad",
    path: "/contable",
    defaultPath: "/contable/ingresos",
    icon: faWallet,
    children: [
      { key: "contable-ingresos", label: "Ingresos", path: "/contable/ingresos" },
      { key: "contable-egresos", label: "Egresos", path: "/contable/egresos" },
      { key: "contable-resumen", label: "Resumen", path: "/contable/resumen" },
    ],
  },
];

const toNum = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const formatBotBadge = (value) => {
  const number = Math.max(0, toNum(value));
  if (number <= 0) return "";
  return number > 99 ? "99+" : String(number);
};

const calculateBotBadges = (rows) => {
  const chats = Array.isArray(rows) ? rows : [];
  let normal = 0;
  let urgent = 0;
  let approval = 0;

  for (const chat of chats) {
    const unread = Math.max(0, toNum(chat?.unread || 0));
    const pendingQueries = Math.max(
      0,
      toNum(chat?.consultas_pendientes || chat?.pending_consultas || 0),
    );
    const pendingApprovals = Math.max(
      0,
      toNum(chat?.comprobantes_pendientes || chat?.pending_comprobantes || 0),
    );

    const priority = String(
      chat?.prioridad || chat?.notificacion_tipo || chat?.tipo_notificacion || "",
    ).toLowerCase();

    const isApprovalAlert =
      priority === "aprobacion_comprobante" ||
      priority === "comprobante_pendiente" ||
      priority.includes("comprobante");

    const approvalsForChat =
      pendingApprovals > 0
        ? pendingApprovals
        : isApprovalAlert
          ? Math.max(1, Math.min(unread, 1))
          : 0;

    const urgentForChat = Math.min(unread, pendingQueries);
    const classifiedForChat = Math.min(
      unread,
      urgentForChat + Math.min(unread, approvalsForChat),
    );
    const normalForChat = Math.max(0, unread - classifiedForChat);

    urgent += urgentForChat;
    approval += approvalsForChat;
    normal += normalForChat;
  }

  return { normal, urgent, approval };
};

const getGroupKeyForPath = (pathname) =>
  NAV_ITEMS.find(
    (item) =>
      item.children &&
      (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  )?.key || null;

function LogoutModal({ open, onClose, onConfirm }) {
  useGlobalModalEscape(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className="pp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-logout-modal-title"
    >
      <div className="pp-modal pp-modal--danger">
        <div className="pp-modal__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faRightFromBracket} />
        </div>
        <h3 id="pp-logout-modal-title" className="pp-modal__title">
          Confirmar cierre de sesión
        </h3>
        <p className="pp-modal__text">
          ¿Estás seguro de que deseas cerrar la sesión?
        </p>
        <div className="pp-modal__actions">
          <button className="pp-btn pp-btn--ghost" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="pp-btn pp-btn--danger"
            type="button"
            onClick={onConfirm}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RhMark({ className = "" }) {
  return (
    <img
      className={`rh-brand-mark ${className}`.trim()}
      src={logoRh}
      alt=""
      aria-hidden="true"
    />
  );
}

export default function Principal() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const writable = session?.usuario?.rol === "admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [openGroupKey, setOpenGroupKey] = useState(() =>
    getGroupKeyForPath(location.pathname),
  );
  const groupClickTimer = useRef(null);
  const logoutInProgress = useRef(false);
  const [normalUnread, setNormalUnread] = useState(0);
  const [urgentUnread, setUrgentUnread] = useState(0);
  const [approvalUnread, setApprovalUnread] = useState(0);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!getSession()) return;

      try {
        const response = await fetch(
          `${BOT_PANEL_URL}/panel_chats.php?_=${Date.now()}`,
          { method: "GET", cache: "no-store" },
        );
        const data = await response.json().catch(() => null);
        if (!alive || !response.ok || !data?.success) return;

        const { normal, urgent, approval } = calculateBotBadges(data.chats);
        setNormalUnread(Math.max(0, toNum(normal)));
        setUrgentUnread(Math.max(0, toNum(urgent)));
        setApprovalUnread(Math.max(0, toNum(approval)));
      } catch {
        // El estado del bot no debe bloquear la navegación principal.
      }
    };

    tick();
    const interval = window.setInterval(tick, 2000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!writable && location.pathname.startsWith("/configuracion")) {
      navigate("/panel", { replace: true });
    }
  }, [location.pathname, navigate, writable]);

  useEffect(() => {
    setDrawerOpen(false);
    setOpenGroupKey(getGroupKeyForPath(location.pathname));
  }, [location.pathname]);

  useEffect(
    () => () => {
      if (groupClickTimer.current) clearTimeout(groupClickTimer.current);
    },
    [],
  );

  const activeLabel = useMemo(() => {
    for (const item of NAV_ITEMS) {
      const child = item.children?.find(
        (entry) =>
          location.pathname === entry.path ||
          location.pathname.startsWith(`${entry.path}/`),
      );
      if (child) return child.label;
      if (
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`)
      ) {
        return item.label;
      }
    }

    if (location.pathname.startsWith("/configuracion")) return "Configuración";
    return "Cooperadora";
  }, [location.pathname]);

  const clearGroupClickTimer = () => {
    if (!groupClickTimer.current) return;
    clearTimeout(groupClickTimer.current);
    groupClickTimer.current = null;
  };

  const toggleGroup = (item, event) => {
    clearGroupClickTimer();

    // El segundo clic pertenece al doble clic: la navegación se resuelve
    // exclusivamente en handleGroupDoubleClick.
    if (event.detail > 1) return;

    groupClickTimer.current = setTimeout(() => {
      setOpenGroupKey((currentKey) =>
        currentKey === item.key ? null : item.key,
      );
      groupClickTimer.current = null;
    }, 0);
  };

  const handleGroupDoubleClick = (item, event) => {
    event.preventDefault();
    clearGroupClickTimer();
    setOpenGroupKey(item.key);
    setDrawerOpen(false);
    navigate(item.defaultPath || item.path);
  };

  const closeOpenGroup = () => {
    clearGroupClickTimer();
    setOpenGroupKey(null);
  };

  const openBotPanel = () => {
    navigate("/bot/panel");
  };

  const logout = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;

    try {
      await apiPost("auth_logout", {});
    } catch {
      // Aunque el backend ya haya invalidado o vencido la sesión,
      // la copia local se elimina para completar el cierre en la SPA.
    } finally {
      clearSession();
      setLogoutOpen(false);
      logoutInProgress.current = false;
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="pp-shell">
      <header className="mov-topbar">
        <div className="mov-topbar__left">
          <button
            className="pp-burger"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
          >
            <FontAwesomeIcon icon={faBars} />
          </button>
          <div className="mov-topbar__logo mov-topbar__appBrand">
            <span className="mov-topbar__appBrandMark mov-topbar__appBrandMark--image">
              <RhMark />
            </span>
            <span className="mov-topbar__brandText">
              <strong>Cooperadora</strong>
              <small>IPET N° 50</small>
            </span>
          </div>
        </div>

        <div className="mov-topbar__right">
          <div className="mov-topbar__section">{activeLabel}</div>
          {writable ? (
            <button
              className={`pp-topbarConfig ${location.pathname.startsWith("/configuracion") ? "is-active" : ""}`}
              type="button"
              onClick={() => navigate("/configuracion")}
              title="Configuración"
              aria-label="Abrir configuración"
            >
              <FontAwesomeIcon icon={faGear} />
            </button>
          ) : null}
          <button
            className="mov-topbar__usericon has-logo"
            type="button"
            onClick={() => setPerfilOpen(true)}
            title="Perfil"
            aria-label="Abrir perfil"
          >
            <img
              className="mov-topbar__userlogo"
              src={logoRh}
              alt=""
              aria-hidden="true"
            />
          </button>
          <button
            className="pp-topbarLogout"
            type="button"
            onClick={() => setLogoutOpen(true)}
            title="Cerrar sesión"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
          </button>
        </div>
      </header>

      <div
        className={`pp-drawerOverlay ${drawerOpen ? "is-open" : ""}`}
        onMouseDown={() => setDrawerOpen(false)}
      />

      <aside className={`pp-sidebar ${drawerOpen ? "is-drawerOpen" : ""}`}>
        <div className="pp-drawerHeader">
          <div
            className="pp-drawerBrand"
            onClick={() => navigate("/panel")}
            role="button"
            tabIndex={0}
          >
            <div className="pp-drawerBrand__mark pp-drawerBrand__mark--image">
              <RhMark />
            </div>
            <div className="pp-drawerBrand__txt">
              <div className="pp-drawerBrand__t">Cooperadora</div>
              <div className="pp-drawerBrand__s">IPET N° 50</div>
            </div>
          </div>
          <button
            className="pp-drawerClose"
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar menú"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div
          className="pp-brand panel_contable"
          onClick={() => navigate("/panel")}
          role="button"
          tabIndex={0}
        >
          <div className="pp-brand__mark pp-brand__mark--image">
            <RhMark />
          </div>
          <div className="pp-brand__text">
            <div className="pp-brand__title">Cooperadora</div>
            <div className="pp-brand__subtitle">IPET N° 50</div>
          </div>
        </div>

        <nav className="pp-nav" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const active =
              location.pathname === item.path ||
              location.pathname.startsWith(`${item.path}/`);
            const groupOpen = Boolean(
              item.children && openGroupKey === item.key,
            );

            return (
              <div
                className={`pp-navGroup ${item.children ? "has-sub" : ""} ${groupOpen ? "is-open" : ""}`}
                key={item.key}
              >
                {item.children ? (
                  <button
                    className={`pp-nav__item ${active ? "is-active" : ""}`}
                    type="button"
                    aria-expanded={groupOpen}
                    onClick={(event) => toggleGroup(item, event)}
                    onDoubleClick={(event) => handleGroupDoubleClick(item, event)}
                    title="Un clic para desplegar; doble clic para ingresar"
                  >
                    <span className="pp-nav__icon">
                      <FontAwesomeIcon icon={item.icon} />
                    </span>
                    <span className="pp-nav__label">{item.label}</span>
                  </button>
                ) : (
                  <NavLink
                    className={({ isActive }) =>
                      `pp-nav__item ${isActive ? "is-active" : ""}`
                    }
                    to={item.path}
                    onClick={closeOpenGroup}
                  >
                    <span className="pp-nav__icon">
                      <FontAwesomeIcon icon={item.icon} />
                    </span>
                    <span className="pp-nav__label">{item.label}</span>
                  </NavLink>
                )}

                {item.children ? (
                  <div className="pp-navSub" aria-hidden={!groupOpen}>
                    {item.children.map((child) => (
                      <NavLink
                        end
                        className={({ isActive }) =>
                          `pp-navSub__item ${isActive ? "is-active" : ""}`
                        }
                        to={child.path}
                        key={child.key}
                      >
                        <span className="pp-navSub__dot" />
                        <span className="pp-navSub__label">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="pp-navGroup" key="bot-whatsapp">
            <button
              className={`pp-nav__item ${location.pathname.startsWith("/bot/panel") ? "is-active" : ""}`}
              type="button"
              onClick={() => {
                closeOpenGroup();
                setDrawerOpen(false);
                openBotPanel();
              }}
              title="Panel interno del Bot (WhatsApp)"
              aria-label="Abrir panel interno del bot"
            >
              <span className="pp-nav__icon pp-nav__icon--bot">
                <FontAwesomeIcon icon={faRobot} />

                {approvalUnread > 0 ? (
                  <span
                    className="pp-navBotBadge pp-navBotBadge--approval"
                    aria-label={`Comprobantes pendientes de aprobación: ${approvalUnread}`}
                    title={`Comprobantes para aprobar: ${approvalUnread}`}
                  >
                    {formatBotBadge(approvalUnread)}
                  </span>
                ) : null}

                {normalUnread > 0 ? (
                  <span
                    className="pp-navBotBadge pp-navBotBadge--normal"
                    aria-label={`Notificaciones normales: ${normalUnread}`}
                    title={`Normales: ${normalUnread}`}
                  >
                    {formatBotBadge(normalUnread)}
                  </span>
                ) : null}

                {urgentUnread > 0 ? (
                  <span
                    className="pp-navBotBadge pp-navBotBadge--urgent"
                    aria-label={`Notificaciones urgentes: ${urgentUnread}`}
                    title={`Urgentes: ${urgentUnread}`}
                  >
                    {formatBotBadge(urgentUnread)}
                  </span>
                ) : null}
              </span>

              <span className="pp-nav__label">Bot WhatsApp</span>
            </button>
          </div>
        </nav>
      </aside>

      <main className="pp-content">
        <div className="pp-content__inner">
          <Outlet />
        </div>
      </main>

      <ModalPerfil
        open={perfilOpen}
        onClose={() => setPerfilOpen(false)}
        usuario={session?.usuario}
        onConfigRequest={
          writable
            ? () => {
                setPerfilOpen(false);
                navigate("/configuracion");
              }
            : undefined
        }
      />

      <LogoutModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </div>
  );
}
