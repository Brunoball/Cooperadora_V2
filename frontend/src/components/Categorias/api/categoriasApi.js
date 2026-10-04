import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const categoriasApi = {
  listar: (params) => apiGet("categorias_listar", params),
  obtener: (id) => apiGet("categorias_obtener", { id }),
  guardar: (payload) => apiPost("categorias_guardar", payload),
  eliminar: (id) => apiPost("categorias_eliminar", { id }),
  historial: (id) => apiGet("categorias_historial", { id }),

  listarHermanos: (params) => apiGet("categorias_hermanos_listar", params),
  guardarHermanos: (payload) => apiPost("categorias_hermanos_guardar", payload),
  desactivarHermanos: (id) =>
    apiPost("categorias_hermanos_desactivar", { id }),
  reactivarHermanos: (id) =>
    apiPost("categorias_hermanos_reactivar", { id }),
  historialHermanos: (id) =>
    apiGet("categorias_hermanos_historial", { id }),
};
