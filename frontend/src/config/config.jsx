const configuredUrl = String(
  process.env.REACT_APP_API_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

function defaultApiBaseUrl() {
  if (typeof window === "undefined") return "/api/routes";

  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);

  // Desarrollo local sin .env: PHP corre en :3001.
  if (isLoopback) return "http://localhost:3001/routes";

  // Producción: frontend y API comparten origen. Esto evita compilar una URL
  // localhost dentro del bundle productivo y funciona también si cambia el dominio.
  return `${String(window.location.origin || "").replace(/\/+$/, "")}/api/routes`;
}

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

// REACT_APP_API_URL siempre tiene prioridad (desarrollo, staging o Playwright).
// Sin variable, localhost usa :3001 y un build productivo usa /api/routes
// sobre el mismo dominio desde el que se abrió la aplicación.
const BASE_URL = configuredUrl || defaultApiBaseUrl();

export default BASE_URL;

// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// URL LOCAL= http://localhost:3001/routes
// URL PRODUCCIÓN= https://cooperadora.ipet50.edu.ar/api/routes


