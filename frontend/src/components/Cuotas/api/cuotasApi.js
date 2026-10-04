import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const cuotasApi = {
  listar: (params) => apiGet("cuotas_listar", params),
  totalesEstado: (params) => apiGet("cuotas_totales_estado", params),
  catalogos: (params) => apiGet("cuotas_catalogos", params),
  contextoPago: (params) => apiGet("cuotas_contexto_pago", params),
  contextosPago: (params) => apiGet("cuotas_contextos_pago", params),
  comprobante: (params) => apiGet("cuotas_comprobante", params),
  buscarPagoEliminar: (payload) =>
    apiPost("cuotas_buscar_pago_eliminar", payload),
  registrarPago: (payload) => apiPost("cuotas_registrar_pago", payload),
  registrarPagos: (payload) => apiPost("cuotas_registrar_pagos", payload),
  condonarPago: (payload) => apiPost("cuotas_condonar_pago", payload),
  eliminarPago: (payload) => apiPost("cuotas_eliminar_pago", payload),
  actualizarMatricula: (monto) =>
    apiPost("cuotas_actualizar_matricula", { monto }),
};
