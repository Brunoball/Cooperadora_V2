import BASE_URL from "../../config/config";
import { getSession } from "../_shared/auth/session";

// Campañas y reportes SIEMPRE consultan los datos reales del panel de Hostinger.
// Una sesión del backend local NO es válida en la base de sesiones de producción.
// Al iniciar sesión en Cooperadora se abre, silenciosamente, una sesión real
// adicional usando las credenciales que el usuario acaba de ingresar.
// No existen tokens públicos/fijos, accesos sin autenticar ni datos ficticios.
const HOSTINGER_ORIGIN = "https://cooperadora.ipet50.edu.ar";
const HOSTINGER_LOGIN_URL = `${HOSTINGER_ORIGIN}/api/routes/api.php?action=auth_login`;
const HOSTINGER_SESSION_KEY = "cooperadora_bot_panel_hostinger_session";
const REMEMBERED_ACCOUNT_KEY = "cooperadora_recordar_cuenta";

const getMainToken = () => getSession()?.token || "";

function usesHostingerBackend() {
  try {
    return new URL(BASE_URL, window.location.origin).origin === HOSTINGER_ORIGIN;
  } catch {
    return false;
  }
}

function needsSeparateSession() {
  // Playwright no debe intentar autenticar contra producción durante las pruebas.
  return process.env.REACT_APP_E2E !== "1" && !usesHostingerBackend();
}

function getHostingerSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(HOSTINGER_SESSION_KEY) || "null");
    const parentToken = getMainToken();
    // Nunca compartir la sesión de Hostinger entre cuentas de Cooperadora.
    if (!stored?.token || !parentToken || stored.parentToken !== parentToken) {
      sessionStorage.removeItem(HOSTINGER_SESSION_KEY);
      return null;
    }
    if (!Number.isFinite(Date.parse(stored.expira_en || "")) || Date.parse(stored.expira_en) <= Date.now()) {
      sessionStorage.removeItem(HOSTINGER_SESSION_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function clearHostingerSession() {
  try { sessionStorage.removeItem(HOSTINGER_SESSION_KEY); } catch { /* storage bloqueado */ }
}

function authError(message) {
  const error = new Error(message);
  error.hostingerAuthRequired = true;
  return error;
}

// Un solo intento concurrente para no duplicar sesiones por abrir varios modales.
let connectionPromise = null;
let connectionParentToken = "";
let refusedParentToken = "";

async function createHostingerSession(usuario, contrasena, parentToken) {
  const response = await fetch(HOSTINGER_LOGIN_URL, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, contrasena }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.exito || !data?.token) {
    throw new Error("Hostinger no aceptó las mismas credenciales del login local.");
  }
  const expires = Date.parse(data.expira_en || "");
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    throw new Error("Hostinger devolvió una sesión inválida.");
  }
  // Si se cerró o cambió la sesión local mientras autenticábamos, no guardar
  // un token perteneciente a la sesión anterior.
  if (getMainToken() !== parentToken) return false;
  sessionStorage.setItem(HOSTINGER_SESSION_KEY, JSON.stringify({
    token: data.token,
    expira_en: data.expira_en,
    parentToken,
  }));
  return true;
}

/**
 * La pantalla de login principal llama a esto con las credenciales YA ingresadas.
 * No guarda la contraseña ni solicita un segundo formulario.
 * Errores de la conexión secundaria no invalidan el login principal local.
 */
export function botPanelPrimeHostingerSession(usuario, contrasena) {
  if (!needsSeparateSession()) return Promise.resolve(false);
  const parentToken = getMainToken();
  const login = String(usuario || "").trim();
  if (!parentToken || !login || !contrasena) return Promise.resolve(false);
  if (connectionPromise && connectionParentToken === parentToken) return connectionPromise;

  // Un nuevo login local puede reintentar aunque antes fallara.
  refusedParentToken = "";
  clearHostingerSession();
  connectionParentToken = parentToken;
  const promise = createHostingerSession(login, contrasena, parentToken)
    .catch(() => {
      if (getMainToken() === parentToken) refusedParentToken = parentToken;
      return false;
    })
    .finally(() => {
      if (connectionPromise === promise) connectionPromise = null;
    });
  connectionPromise = promise;
  return promise;
}

// Permite recuperar la sesión sin otro formulario para usuarios que ya tenían
// iniciada la sesión local y marcaron previamente "Recordar cuenta".
// Sólo reutilizamos las credenciales si podemos cotejar el nombre de usuario.
function rememberedCredentialsForCurrentUser() {
  try {
    const sessionUser = getSession()?.usuario;
    const name = String(sessionUser?.usuario || sessionUser?.username || sessionUser?.nombre_usuario || "").trim();
    if (!name) return null;
    const remembered = JSON.parse(localStorage.getItem(REMEMBERED_ACCOUNT_KEY) || "null");
    if (name.toLowerCase() !== String(remembered?.usuario || "").trim().toLowerCase()) return null;
    if (!remembered?.contrasena) return null;
    return { usuario: name, contrasena: remembered.contrasena };
  } catch {
    return null;
  }
}

async function getTokenForPanel() {
  const mainToken = getMainToken();
  if (!mainToken) throw authError("Iniciá sesión en Cooperadora para consultar el panel.");
  if (!needsSeparateSession()) return mainToken;

  // Si el usuario abrió el panel inmediatamente después de iniciar sesión,
  // esperar el login silencioso que ya está en curso.
  if (connectionPromise && connectionParentToken === mainToken) await connectionPromise;
  const hostinger = getHostingerSession();
  if (hostinger?.token) return hostinger.token;

  // Con un login anterior, intentar la conexión automáticamente si recordó
  // su cuenta, sin reutilizar credenciales de otro usuario.
  if (refusedParentToken !== mainToken) {
    const remembered = rememberedCredentialsForCurrentUser();
    if (remembered) {
      await botPanelPrimeHostingerSession(remembered.usuario, remembered.contrasena);
      const connected = getHostingerSession();
      if (connected?.token) return connected.token;
    }
  }

  throw authError(
    "No se pudo conectar automáticamente con Hostinger. Cerrá sesión e ingresá nuevamente en Cooperadora con el mismo usuario y contraseña que usás en producción. No necesitás iniciar sesión otra vez dentro del panel."
  );
}

/** Todas las operaciones consultan Hostinger; nunca se simula la respuesta. */
export async function botPanelRequest(url, options = {}) {
  const token = await getTokenForPanel();
  let response;
  try {
    response = await fetch(url, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "X-Cooperadora-Session": token,
      },
    });
  } catch {
    throw new Error("No se pudo conectar con el panel real de Hostinger. Revisá la conexión o CORS.");
  }
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Hostinger devolvió una respuesta no válida (HTTP ${response.status}).`);
  }

  if (response.status === 401) {
    if (needsSeparateSession()) {
      clearHostingerSession();
      refusedParentToken = getMainToken();
    }
    throw authError("Hostinger rechazó la sesión del panel. Cerrá sesión e ingresá nuevamente en Cooperadora para renovar el acceso automáticamente.");
  }
  if (response.status === 403) {
    throw new Error(data?.error || "Tu cuenta no tiene permisos para esta operación en Hostinger.");
  }
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || data?.mensaje || `Error del panel de Hostinger (HTTP ${response.status}).`);
  }
  return data;
}
