/**
 * Vista de demostración exclusiva del servidor de desarrollo local.
 * No solicita tokens, no consulta bases reales y NUNCA llama a endpoints
 * productivos para crear/editar/eliminar campañas.
 */
export const isBotPanelLocalPreview = () =>
  process.env.NODE_ENV === "development" &&
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);

const todayScheduled = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  while ([0, 6].includes(d.getDay()) || [0, 1].includes(d.getMonth())) d.setDate(d.getDate() + 1);
  const part = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${part(d.getMonth() + 1)}-${part(d.getDate())} ${part(d.getHours())}:${part(d.getMinutes())}:00`;
};

const demoAlumnos = Array.from({ length: 268 }, (_, index) => {
  const id = index + 1;
  const valido = id <= 265;
  return {
    id_alumno: id,
    nombre: `Alumno ${id}`,
    apellido: "DEMO",
    nombre_completo: `ALUMNO DEMO ${id}`,
    telefono: valido ? `DEMO-${String(id).padStart(3, "0")}` : "",
    telefonos_normalizados: valido ? [`DEMO-${String(id).padStart(3, "0")}`] : [],
    tiene_telefono: valido,
    anio: String((index % 7) + 1),
    division: "A",
    categoria: "Interno",
    id_anio: (index % 7) + 1,
    id_division: 1,
    id_categoria: 1,
  };
});

const demoOptions = {
  anios: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, nombre: String(i + 1) })),
  divisiones: [{ id: 1, nombre: "A" }],
  categorias: [{ id: 1, nombre: "Interno" }],
};
let demoCampanias = [{
  id_campania: 1,
  estado: "programada",
  mensaje: "Recordatorio de ejemplo: reunión de familias.",
  programada_para: todayScheduled(),
  destinatarios_estimados: 265,
  anios_ids: [], divisiones_ids: [], categorias_ids: [],
  alumnos_seleccionados_ids: Array.from({ length: 265 }, (_, i) => i + 1),
  anios_nombres: [], divisiones_nombres: [], categorias_nombres: [],
  total_enviados: 0, total_pendientes: 0, total_errores: 0, total_omitidos: 0,
}];
let nextId = 2;
const idArray = (value) => Array.isArray(value) ? value.map(Number) : [];

const recipients = (params) => {
  const selected = [
    ["id_anios", "id_anio"], ["id_divisiones", "id_division"], ["id_categorias", "id_categoria"],
  ].map(([plural, singular]) => (params.get(plural) || params.get(singular) || "").split(",").map(Number).filter(Boolean));
  const matches = demoAlumnos.filter((a) =>
    (!selected[0].length || selected[0].includes(a.id_anio)) &&
    (!selected[1].length || selected[1].includes(a.id_division)) &&
    (!selected[2].length || selected[2].includes(a.id_categoria))
  );
  return {
    total_alumnos: matches.length,
    telefonos_unicos: matches.filter((a) => a.tiene_telefono).length,
    sin_telefono: matches.filter((a) => !a.tiene_telefono).length,
    alumnos: matches,
  };
};

export async function botPanelLocalPreviewRequest(url, options = {}) {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname.endsWith("/panel_reportes.php")) {
    const anio = parsed.searchParams.get("anio") || new Date().getFullYear();
    const mes = String(parsed.searchParams.get("mes") || (new Date().getMonth() + 1)).padStart(2, "0");
    return {
      success: true, demo_local: true,
      periodo: { clave: `${anio}-${mes}` },
      periodos_disponibles: [`${anio}-${mes}`],
      resumen: {}, actividad: { eventos: {} }, pagos: { detalle: [] },
      ventas: { comprobantes: {}, detalle: [] },
      costos_whatsapp: { totales: {}, detalle: [] }, advertencias: [],
    };
  }
  if (!parsed.pathname.endsWith("/panel_campanias_recordatorio.php")) {
    throw new Error("Este recurso no está disponible en la vista local de ejemplo.");
  }
  const method = String(options.method || "GET").toUpperCase();
  if (method === "GET") {
    const accion = parsed.searchParams.get("accion") || "listar";
    if (accion === "opciones") return { success: true, opciones: demoOptions, demo_local: true };
    if (accion === "destinatarios") return { success: true, destinatarios: recipients(parsed.searchParams), demo_local: true };
    if (accion === "detalle") {
      const campaign = demoCampanias.find((c) => c.id_campania === Number(parsed.searchParams.get("id_campania")));
      return { success: true, demo_local: true, detalle: campaign ? { campania: campaign, envios: [], omitidos: [] } : null };
    }
    if (accion === "listar") return {
      success: true, demo_local: true,
      campanias: demoCampanias.map((c) => ({ ...c })),
      cupo_24h: { limite: 250, usados: 82, disponibles: 168, periodo: "24_horas_moviles" },
      horario_envio: { desde: 9, hasta: 18 },
    };
    throw new Error("Acción de ejemplo no disponible.");
  }
  const body = JSON.parse(String(options.body || "{}"));
  if (body.accion === "eliminar") {
    demoCampanias = demoCampanias.filter((c) => c.id_campania !== Number(body.id_campania));
    return { success: true, demo_local: true };
  }
  if (!["crear", "editar"].includes(body.accion)) throw new Error("Acción inválida.");
  const ids = idArray(body.alumnos_seleccionados);
  const validIds = ids.filter((id) => demoAlumnos.some((a) => a.id_alumno === id && a.tiene_telefono));
  if (!validIds.length) throw new Error("Seleccioná al menos un alumno con teléfono válido.");
  const id = body.accion === "editar" ? Number(body.id_campania) : nextId++;
  const existing = demoCampanias.find((c) => c.id_campania === id);
  if (body.accion === "editar" && !existing) throw new Error("Campaña de ejemplo no encontrada.");
  const campaign = {
    ...(existing || {}), id_campania: id, estado: "programada",
    mensaje: String(body.mensaje || ""), programada_para: String(body.programada_para || ""),
    anios_ids: idArray(body.id_anios), divisiones_ids: idArray(body.id_divisiones),
    categorias_ids: idArray(body.id_categorias),
    alumnos_seleccionados_ids: validIds,
    anios_nombres: demoOptions.anios.filter((x) => idArray(body.id_anios).includes(x.id)).map((x) => x.nombre),
    divisiones_nombres: demoOptions.divisiones.filter((x) => idArray(body.id_divisiones).includes(x.id)).map((x) => x.nombre),
    categorias_nombres: demoOptions.categorias.filter((x) => idArray(body.id_categorias).includes(x.id)).map((x) => x.nombre),
    destinatarios_estimados: validIds.length,
    total_enviados: 0, total_pendientes: 0, total_errores: 0, total_omitidos: 0,
  };
  demoCampanias = [campaign, ...demoCampanias.filter((c) => c.id_campania !== id)];
  return { success: true, demo_local: true, id_campania: id, destinatarios_estimados: validIds.length };
}
