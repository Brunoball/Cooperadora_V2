import React, { useEffect, useRef, useState } from "react";
import Toast from "./Toast";
import { GLOBAL_TOAST_EVENT } from "./notifications";

// Vive en App, fuera de las rutas y los modales. Cada operación reemplaza la
// notificación anterior y reinicia su tiempo, aun con el mismo mensaje.
export default function GlobalToastHost() {
  const [notification, setNotification] = useState(null);
  const sequence = useRef(0);

  useEffect(() => {
    const onNotification = (event) => {
      const { tipo = "exito", mensaje, duracion } = event.detail || {};
      if (!mensaje) return;
      sequence.current += 1;
      const inVentas = window.location.pathname === "/ventas" || window.location.pathname.startsWith("/ventas/");
      const persistentWarning = ["error", "advertencia", "alerta", "warning"].includes(tipo);
      setNotification({
        id: sequence.current, tipo, mensaje, duracion,
        dismissFromVentasModal: inVentas && persistentWarning,
      });
    };

    window.addEventListener(GLOBAL_TOAST_EVENT, onNotification);
    return () => window.removeEventListener(GLOBAL_TOAST_EVENT, onNotification);
  }, []);

  useEffect(() => {
    if (!notification?.dismissFromVentasModal) return undefined;

    // El Escape se captura ANTES del manejador del modal global, que frena
    // la propagación: así se descarta el error aunque también cierre el modal.
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      setNotification((current) => current?.id === notification.id ? null : current);
    };
    const onModalButton = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]');
      if (!button || !button.closest('[role="dialog"]')) return;
      setNotification((current) => current?.id === notification.id ? null : current);
    };
    window.addEventListener("keydown", onEscape, true);
    document.addEventListener("click", onModalButton, true);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("click", onModalButton, true);
    };
  }, [notification]);

  if (!notification) return null;

  return (
    <Toast
      key={notification.id}
      tipo={notification.tipo}
      mensaje={notification.mensaje}
      duracion={notification.duracion ?? (notification.tipo === "cargando" ? 12000 : ["exito", "success", "ok"].includes(notification.tipo) ? 2800 : 4200)}
      cerrarConInteraccion={false}
      onClose={() => setNotification((prev) => prev?.id === notification.id ? null : prev)}
    />
  );
}
