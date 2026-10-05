import React, { useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Inicio from "./components/Login/Inicio";
import Principal from "./components/Principal/Principal";
import Dashboard from "./components/Dashboard/Dashboard";
import Alumnos from "./components/Alumnos/Alumnos";
import Familias from "./components/Alumnos/secciones/Familias";
import Cuotas from "./components/Cuotas/Cuotas";
import Categorias from "./components/Categorias/Categorias";
import DescuentosFamiliares from "./components/Categorias/secciones/DescuentosFamiliares";
import Ingresos from "./components/Contable/secciones/Ingresos";
import Egresos from "./components/Contable/secciones/Egresos";
import Resumen from "./components/Contable/secciones/Resumen";
import Configuracion from "./components/Configuracion/Configuracion";
import Usuarios from "./components/Configuracion/secciones/Usuarios";
import CatalogosConfiguracion from "./components/Configuracion/secciones/CatalogosConfiguracion";
import Ventas from "./components/Ventas/Ventas";
import BotPanel from "./components/BotPanel/BotPanel";
import notificationSound from "./components/BotPanel/notificacion/notificacion.mp3";
import { BOT_PANEL_URL } from "./config/config";
import {
  AUTH_SESSION_CHANGED_EVENT,
  isAuthenticated,
} from "./components/_shared/auth/session";

const toNum = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const countUrgentBotQueries = (rows) => {
  const chats = Array.isArray(rows) ? rows : [];

  return chats.reduce((total, chat) => {
    const pending = Math.max(
      0,
      toNum(chat?.consultas_pendientes || chat?.pending_consultas || 0),
    );
    return total + pending;
  }, 0);
};

function GlobalUrgentBotNotifier() {
  const location = useLocation();
  const audioRef = useRef(null);
  const previousUrgentRef = useRef(0);
  const firstLoadRef = useRef(true);
  const interactedRef = useRef(false);

  useEffect(() => {
    const unlock = () => {
      interactedRef.current = true;
    };

    window.addEventListener("click", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });

    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const playSound = () => {
      if (!interactedRef.current) return;

      const audio = audioRef.current;
      if (!audio) return;

      try {
        audio.pause();
        audio.currentTime = 0;
        const playback = audio.play();
        if (playback && typeof playback.catch === "function") {
          playback.catch(() => {});
        }
      } catch {
        // El navegador puede bloquear audio hasta la primera interacción.
      }
    };

    const tick = async () => {
      if (!isAuthenticated() || location.pathname === "/") return;

      try {
        const response = await fetch(
          `${BOT_PANEL_URL}/panel_chats.php?_=${Date.now()}`,
          { method: "GET", cache: "no-store" },
        );
        const data = await response.json().catch(() => null);
        if (!alive || !response.ok || !data?.success) return;

        const urgent = countUrgentBotQueries(data.chats);

        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          previousUrgentRef.current = urgent;
          return;
        }

        if (urgent > previousUrgentRef.current) playSound();
        previousUrgentRef.current = urgent;
      } catch {
        // El notificador no debe interferir con el resto del sistema.
      }
    };

    tick();
    const interval = window.setInterval(tick, 2000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [location.pathname]);

  return <audio ref={audioRef} preload="auto" src={notificationSound} />;
}

function ProtectedLayout() {
  return isAuthenticated() ? <Principal /> : <Navigate to="/" replace />;
}

function ProtectedPage({ children }) {
  return isAuthenticated() ? children : <Navigate to="/" replace />;
}

export default function App() {
  const [, setAuthRevision] = useState(0);

  useEffect(() => {
    const refreshAuthState = () => setAuthRevision((revision) => revision + 1);
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refreshAuthState);
    return () =>
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refreshAuthState);
  }, []);

  return (
    <BrowserRouter>
      <GlobalUrgentBotNotifier />

      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated() ? <Navigate to="/panel" replace /> : <Inicio />
          }
        />

        <Route
          path="/bot/panel"
          element={
            <ProtectedPage>
              <BotPanel />
            </ProtectedPage>
          }
        />

        <Route element={<ProtectedLayout />}>
          <Route path="/panel" element={<Dashboard />} />

          <Route
            path="/socios"
            element={<Navigate to="/alumnos/listado" replace />}
          />
          <Route path="/socios/personas" element={<Navigate to="/alumnos/listado" replace />} />
          <Route path="/socios/familias" element={<Navigate to="/alumnos/familias" replace />} />
          <Route path="/socios/egresados" element={<Navigate to="/alumnos/listado" replace />} />
          <Route path="/alumnos" element={<Navigate to="/alumnos/listado" replace />} />
          <Route path="/alumnos/listado" element={<Alumnos />} />
          <Route path="/alumnos/familias" element={<Familias />} />
          <Route path="/alumnos/egresados" element={<Navigate to="/alumnos/listado" replace />} />

          <Route path="/cuotas" element={<Cuotas />} />
          <Route path="/categorias" element={<Categorias />} />
          <Route
            path="/categorias/descuentos"
            element={<DescuentosFamiliares />}
          />

          <Route
            path="/contable"
            element={<Navigate to="/contable/ingresos" replace />}
          />
          <Route path="/contable/ingresos" element={<Ingresos />} />
          <Route path="/contable/egresos" element={<Egresos />} />
          <Route path="/contable/resumen" element={<Resumen />} />

          <Route path="/ventas" element={<Navigate to="/ventas/registradas" replace />} />
          <Route path="/ventas/registradas" element={<Ventas />} />
          <Route path="/ventas/productos" element={<Ventas />} />
          <Route path="/ventas/configuracion" element={<Ventas />} />
          <Route path="/ventas/planillas" element={<Ventas />} />

          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/configuracion/usuarios" element={<Usuarios />} />
          <Route
            path="/configuracion/catalogos"
            element={<CatalogosConfiguracion />}
          />
          <Route
            path="/configuracion/contable"
            element={<Navigate to="/configuracion/catalogos?lista=contable_categoria" replace />}
          />
        </Route>

        <Route path="*" element={<Navigate to="/panel" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
