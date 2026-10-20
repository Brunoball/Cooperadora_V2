import React, { useState } from "react";
import { botPanelLoginHostinger } from "../botPanelRequest";
import "./BotPanelHostingerAuth.css";

/** Aparece solo cuando la API real rechaza el token de la sesión local. */
export default function BotPanelHostingerAuth({ onConnected }) {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await botPanelLoginHostinger(usuario, contrasena);
      setContrasena("");
      onConnected?.();
    } catch (e) {
      setError(e?.message || "No fue posible conectar con Hostinger.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="wp-hostinger-auth" onSubmit={submit} aria-label="Conectar panel con Hostinger">
      <strong>Conectar el panel con Hostinger</strong>
      <p>Los datos y las campañas son reales. Como iniciaste sesión en otro servidor, confirmá tu acceso a Cooperadora en Hostinger para verlos o modificarlos.</p>
      <div className="wp-hostinger-auth-fields">
        <label>Usuario de Hostinger
          <input type="text" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} disabled={loading} required />
        </label>
        <label>Contraseña
          <input type="password" autoComplete="current-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} disabled={loading} required />
        </label>
      </div>
      {error ? <p className="wp-hostinger-auth-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={loading}>{loading ? "Conectando…" : "Conectar con Hostinger"}</button>
      <small>Se inicia sesión directamente por HTTPS. La contraseña no se guarda. Los cambios realizados en campañas afectarán a producción.</small>
    </form>
  );
}
