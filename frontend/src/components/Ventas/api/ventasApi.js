import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const ventasApi = {
  resumen: () => apiGet("ventas_resumen"),
  campanias: () => apiGet("ventas_campanias_listar"),
  guardarCampania: (payload) => apiPost("ventas_campania_guardar", payload),
  estadoCampania: (payload) => apiPost("ventas_campania_estado", payload),
  eliminarCampania: (payload) => apiPost("ventas_campania_eliminar", payload),

  productos: (params) => apiGet("ventas_productos_listar", params),
  guardarProducto: (payload) => apiPost("ventas_producto_guardar", payload),
  estadoProducto: (payload) => apiPost("ventas_producto_estado", payload),
  eliminarProducto: (payload) => apiPost("ventas_producto_eliminar", payload),

  catalogos: () => apiGet("ventas_catalogos"),
  buscarPersonas: (params) => apiGet("ventas_personas_buscar", params),
  guardarPersona: (payload) => apiPost("ventas_persona_guardar", payload),

  ordenes: (params) => apiGet("ventas_ordenes_listar", params),
  detalleOrden: (params) => apiGet("ventas_orden_detalle", params),
  guardarOrden: (payload) => apiPost("ventas_orden_guardar", payload),
  retiroOrden: (payload) => apiPost("ventas_orden_retiro", payload),
  eliminarOrden: (payload) => apiPost("ventas_orden_eliminar", payload),

  planillasOpciones: () => apiGet("ventas_planillas_opciones"),
  planillasDatos: (params) => apiGet("ventas_planillas_datos", params),
};

export default ventasApi;
