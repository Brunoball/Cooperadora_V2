import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ModuleFeedback from "../Global/ModuleFeedback";
import { canWrite } from "../_shared/auth/session";
import { useVentasFeedback } from "./hooks/useVentasFeedback";
import ConfiguracionVentas from "./secciones/ConfiguracionVentas";
import Planillas from "./secciones/Planillas";
import Productos from "./secciones/Productos";
import VentasRegistradas from "./secciones/VentasRegistradas";
import "./Ventas.css";

export default function Ventas() {
  const location = useLocation();
  const navigate = useNavigate();
  const writable = canWrite();
  const { feedbackState, showFeedback, clearFeedback } = useVentasFeedback();

  useEffect(() => {
    if (location.pathname === "/ventas") navigate("/ventas/registradas", { replace: true });
  }, [location.pathname, navigate]);

  const feedback = feedbackState ? (
    <ModuleFeedback
      type={feedbackState.type}
      message={feedbackState.message}
      onClose={clearFeedback}
    />
  ) : null;

  const sharedProps = { feedback, showFeedback };

  if (location.pathname.startsWith("/ventas/productos")) {
    return <Productos writable={writable} {...sharedProps} />;
  }
  if (location.pathname.startsWith("/ventas/configuracion")) {
    return <ConfiguracionVentas writable={writable} {...sharedProps} />;
  }
  if (location.pathname.startsWith("/ventas/planillas")) {
    return <Planillas {...sharedProps} />;
  }
  return <VentasRegistradas writable={writable} {...sharedProps} />;
}
