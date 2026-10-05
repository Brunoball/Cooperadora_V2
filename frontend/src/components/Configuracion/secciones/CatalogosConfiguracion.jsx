import React from "react";
import { Navigate } from "react-router-dom";
import { canWrite } from "../../_shared/auth/session";
import ConfiguracionModule from "./ConfiguracionModule";

export default function CatalogosConfiguracion() {
  if (!canWrite()) return <Navigate to="/panel" replace />;
  return <ConfiguracionModule group="catalogos" />;
}
