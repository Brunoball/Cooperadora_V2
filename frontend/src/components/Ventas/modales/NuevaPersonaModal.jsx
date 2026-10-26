import React, { useEffect, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import ventasApi from "../api/ventasApi";
import { upper } from "../ventasUtils";

const soloDigitos = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 12);

/**
 * Alta rápida de una persona en ventas_personas desde el buscador de
 * Nueva / Editar venta. Se renderiza como hermano del modal de la venta
 * (no dentro de su <form>) para que su submit no dispare el de la venta.
 */
export default function NuevaPersonaModal({ open, initialName = "", initialDni = "", onClose, onCreated }) {
  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setNombre(upper(initialName, 160));
    setDni(soloDigitos(initialDni));
    setSaving(false);
    setError("");
  }, [open, initialName, initialDni]);

  const nombreValido = /[A-ZÁÉÍÓÚÜÑ]/i.test(nombre.trim());
  const dniValido = dni.length >= 6 && dni.length <= 12;
  const puedeGuardar = nombreValido && dniValido && !saving;

  const submit = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!puedeGuardar) {
      setError("Ingresá el nombre y apellido y un DNI de 6 a 12 números.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await ventasApi.crearPersona({ nombre_apellido: upper(nombre.trim(), 160), dni });
      if (!result?.persona?.id_persona) throw new Error("No se recibió la persona registrada.");
      onCreated(result.persona, result);
    } catch (err) {
      setError(err.message || "No se pudo registrar la persona.");
      setSaving(false);
    }
  };

  return (
    <CrudModal
      open={open}
      title="Agregar nueva persona"
      subtitle="Se guardará en las personas de Ventas para poder seleccionarla en esta y en próximas ventas."
      onClose={onClose}
      onSubmit={submit}
      noValidate
      saving={saving}
      showSavingEffect
      submitLabel="Agregar persona"
      submitDisabled={!puedeGuardar}
      modalClassName="ventas-modal ventas-persona-modal"
    >
      <div className="ventas-persona-modal__fields">
        <FloatingField label="Nombre y apellido" className="ventas-modal-field">
          <input value={nombre} maxLength={160} autoComplete="off" required autoFocus
            placeholder="Nombre y apellido completo"
            onChange={(e) => { setNombre(upper(e.target.value, 160)); setError(""); }} />
        </FloatingField>
        <FloatingField label="DNI" className="ventas-modal-field">
          <input value={dni} inputMode="numeric" maxLength={12} autoComplete="off" required
            placeholder="Solo números"
            onChange={(e) => { setDni(soloDigitos(e.target.value)); setError(""); }} />
        </FloatingField>
      </div>
      {error ? <div className="ventas-simple-error" role="alert">{error}</div> : null}
    </CrudModal>
  );
}
