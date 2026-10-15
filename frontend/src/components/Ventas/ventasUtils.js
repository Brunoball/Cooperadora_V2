export const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const yes = (value) => Number(value) === 1 || value === true || value === "1";
export const upper = (value, max = 3000) => String(value ?? "").toLocaleUpperCase("es-AR").slice(0, max);
export const asId = (value) => (value === "" || value == null ? "" : String(value));

export const stateLabel = (state) => ({
  pendiente: "PENDIENTE",
  aprobada: "PAGADO",
  cancelada: "CANCELADA",
  fallida: "FALLIDA",
  vencida: "VENCIDA",
}[state] || upper(state || "—", 80));

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[char]));

export const blankItem = () => ({
  id_producto: "",
  producto_nombre: "",
  tipo_precio: "anticipada",
  precio_unitario: "",
  cantidad: 1,
});

const MESES_VENTA = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

export const campaniaPeriodo = (campaign) => {
  const date = String(campaign?.fecha_inicio || campaign?.fecha_referencia || campaign?.fecha_fin || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return "SIN FECHA";
  const i = Number(match[2]) - 1;
  return `${MESES_VENTA[i] || match[2]} ${match[1]}`;
};

export const campaniaOpcion = (campaign) =>
  `${campaniaPeriodo(campaign)} · ${upper(campaign?.nombre || "VENTA", 150)}${campaign?.estado_cierre === "cerrada" ? " · CERRADA" : ""}`;

export const ordenarCampanias = (campaigns = []) => [...campaigns].sort((a, b) => {
  const da = String(a.fecha_inicio || a.fecha_referencia || a.fecha_fin || "");
  const db = String(b.fecha_inicio || b.fecha_referencia || b.fecha_fin || "");
  return db.localeCompare(da) || Number(b.id_campania || 0) - Number(a.id_campania || 0);
});
