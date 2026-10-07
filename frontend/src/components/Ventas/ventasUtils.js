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
  aprobada: "APROBADA",
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
