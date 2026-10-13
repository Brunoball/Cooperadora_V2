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
      setNotification({ id: sequence.current, tipo, mensaje, duracion });
    };

    window.addEventListener(GLOBAL_TOAST_EVENT, onNotification);
    return () => window.removeEventListener(GLOBAL_TOAST_EVENT, onNotification);
  }, []);

  if (!notification) return null;

  return (
    <Toast
      key={notification.id}
      tipo={notification.tipo}
      mensaje={notification.mensaje}
      duracion={notification.duracion ?? (notification.tipo === "cargando" ? 12000 : notification.tipo === "exito" ? 2800 : 4200)}
      cerrarConInteraccion={false}
      onClose={() => setNotification((prev) => prev?.id === notification.id ? null : prev)}
    />
  );
}
