import { apiDownload, apiFormPost, apiGet, apiPost } from "../../_shared/api/apiClient";

export const alumnosApi = {
  listar: (params) => apiGet("alumnos_listar", params),
  listarEgresados: (params) => apiGet("alumnos_egresados_listar", params),
  obtener: (id) => apiGet("alumnos_obtener", { id }),
  historial: (id) => apiGet("alumnos_historial", { id }),
  guardar: (payload) => apiPost("alumnos_guardar", payload),
  darBaja: (payload) => apiPost("alumnos_eliminar", payload),
  eliminarDefinitivo: (payload) => apiPost("alumnos_eliminar_definitivo", payload),
  reactivar: (payload) =>
    apiPost("alumnos_reactivar", typeof payload === "object" ? payload : { id: payload }),
  reclasificar: (payload) => apiPost("alumnos_reclasificar", payload),
  previsualizarImportacion: (file) => {
    const formData = new FormData();
    formData.append("archivo", file);
    return apiFormPost("alumnos_importar_preview", formData);
  },
  importarExcel: (file, firmaPreview) => {
    const formData = new FormData();
    formData.append("archivo", file);
    formData.append("confirmar_sincronizacion", "1");
    formData.append("firma_preview", firmaPreview || "");
    return apiFormPost("alumnos_importar_excel", formData);
  },
  exportarExcel: () => apiDownload("alumnos_exportar_excel"),
};

export const familiasApi = {
  listar: (params) => apiGet("familias_listar", params),
  obtener: (id) => apiGet("familias_obtener", { id }),
  guardar: (payload) => apiPost("familias_guardar", payload),
  darBaja: (payload) =>
    apiPost("familias_eliminar", typeof payload === "object" ? payload : { id: payload }),
  eliminarDefinitivo: (payload) => apiPost("familias_eliminar_definitivo", payload),
  reactivar: (id) => apiPost("familias_reactivar", { id }),
};
