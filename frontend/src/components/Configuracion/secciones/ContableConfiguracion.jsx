import React from "react";
import { Navigate } from "react-router-dom";

/**
 * Compatibilidad con la pantalla contable antigua.
 *
 * Cooperadora V2 administra categorías, descripciones y proveedores desde la
 * única fuente real de datos: Configuración > Tablas auxiliares. Mantener una
 * segunda UI para los mismos catálogos generaba contratos distintos de API y
 * acciones de baja lógica que estas tablas históricas no soportan.
 */
export default function ContableConfiguracion() {
  return (
    <Navigate
      to="/configuracion/catalogos?lista=contable_categoria"
      replace
    />
  );
}
