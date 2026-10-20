import { getSession } from "../_shared/auth/session";

/**
 * Campañas y Reportes usan la sesión del sistema, pero sus errores NO deben
 * cerrar el login de Cooperadora. Solo la API principal gestiona clearSession().
 */
export async function botPanelRequest(url, options = {}) {
  const token = getSession()?.token;
  if (!token) {
    throw new Error("No hay una sesión activa en Cooperadora. Iniciá sesión nuevamente.");
  }

  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
      // Authorization se mantiene por compatibilidad. Algunos servidores
      // Apache/FastCGI no lo entregan a PHP; este segundo header sí llega.
      Authorization: `Bearer ${token}`,
      "X-Cooperadora-Session": token,
    },
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    throw new Error(`El panel devolvió una respuesta no válida (HTTP ${response.status}). Tu sesión en Cooperadora sigue activa.`);
  }

  if (response.status === 401) {
    // No llamar clearSession() acá. El panel no es la autoridad que gestiona
    // la sesión principal: un 401 suyo no significa que el login expiró.
    throw new Error(data?.error || "El panel del bot no pudo validar la sesión. Tu sesión en Cooperadora sigue activa.");
  }
  if (response.status === 403) {
    throw new Error(data?.error || "No tenés permisos para esta operación en el panel del bot.");
  }
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || data?.mensaje || `Error del panel (HTTP ${response.status})`);
  }
  return data;
}
