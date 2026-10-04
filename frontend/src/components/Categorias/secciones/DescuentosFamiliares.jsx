import React from "react";
import CategoriasModule from "./CategoriasModule";

// Se conserva el nombre/ruta histórica para no romper navegación existente.
// La pantalla administra los valores reales por cantidad de hermanos.
export default function DescuentosFamiliares() {
  return <CategoriasModule section="descuentos" />;
}
