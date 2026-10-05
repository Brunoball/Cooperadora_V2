const HOSTINGER_URL = "http://localhost:3001/routes";

const configuredUrl = String(
  process.env.REACT_APP_API_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const isE2E = process.env.REACT_APP_E2E === "1";

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

// Uso normal (npm start / build): siempre usa Hostinger.
// Playwright: REACT_APP_E2E=1 habilita la URL seleccionada por el testing
// mediante REACT_APP_API_URL, ya sea LOCAL o HOSTINGER.
const BASE_URL =
  isE2E && configuredUrl
    ? configuredUrl
    : HOSTINGER_URL;

export default BASE_URL;

// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// URL LOCAL= http://localhost:3001/routes
// URL HOSTINGER= https://cooperadora.ipet50.edu.ar/api/routes

//npx playwright test --project=chromium --workers=1 --reporter=list






