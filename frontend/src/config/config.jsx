
const HOSTINGER_API_URL = "https://cooperadora.ipet50.edu.ar/api/routes";

const isTesting = process.env.REACT_APP_E2E === "1" || process.env.NODE_ENV === "test";
const testingApiUrl = isTesting
  ? String(process.env.REACT_APP_API_URL || "").trim().replace(/\/+$/, "")
  : "";

function defaultApiBaseUrl() {
  // npm run build: siempre publica un frontend que llama a Hostinger.
  // Esta condición se resuelve al compilar (NODE_ENV=production).
  if (process.env.NODE_ENV === "production") return HOSTINGER_API_URL;

  if (typeof window === "undefined") return "http://localhost:3001/routes";

  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);

  // CAMBIÁ SOLO ESTA URL para alternar el backend durante npm start:
  // Local:     http://localhost:3001/routes
  // Hostinger: https://cooperadora.ipet50.edu.ar/api/routes
  if (isLoopback) return "http://localhost:3001/routes";

  // Si el frontend se ejecuta en otro servidor de desarrollo,
  // mantenemos el comportamiento anterior (API en el mismo origen).
  return `${String(window.location.origin || "").replace(/\/+$/, "")}/api/routes`;
}

// El panel de WhatsApp continúa conectado al servicio existente de Hostinger.
// Es independiente del backend principal y no cambia con la URL anterior.
export const BOT_PANEL_URL = String(
  process.env.REACT_APP_BOT_PANEL_URL ||
    "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/endpoints"
)
  .trim()
  .replace(/\/+$/, "");

export const BOT_PANEL_PUNTOS_URL = String(
  process.env.REACT_APP_BOT_PANEL_PUNTOS_URL ||
    "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/puntos"
)
  .trim()
  .replace(/\/+$/, "");

const BASE_URL = testingApiUrl || defaultApiBaseUrl();
export default BASE_URL;


// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// URL LOCAL= http://localhost:3001/routes
// URL PRODUCCIÓN= https://cooperadora.ipet50.edu.ar/api/routes

// npx playwright test --project=chromium --workers=1 --reporter=list
