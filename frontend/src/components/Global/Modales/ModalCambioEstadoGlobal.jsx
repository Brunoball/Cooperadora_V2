import React, { useEffect, useMemo, useState } from "react";
import {
  faArrowRightArrowLeft,
  faGraduationCap,
  faUserCheck,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import ModalEliminarGlobal from "./ModalEliminarGlobal";
import { FloatingField } from "../Formularios/TabbedForm";

const NORMALIZE_TYPE = (value) =>
  String(value || "BAJA").toUpperCase() === "EGRESO" ? "EGRESO" : "BAJA";

function fullCourse(row) {
  return [row?.nombre_anio, row?.nombre_division].filter(Boolean).join(" ") || "SIN CURSO";
}

/**
 * Modal global para cambios de estado de alumnos.
 *
 * - mode="salida": permite elegir BAJA o EGRESO y exige motivo.
 * - mode="reclasificar": confirma el traslado entre Bajas y Egresados.
 * - mode="reactivar": confirma el regreso del alumno al padrón activo.
 *
 * Reutiliza íntegramente la composición visual de ModalEliminarGlobal, por lo
 * que no necesita un CSS propio ni duplica estilos de modales.
 */
export default function ModalCambioEstadoGlobal({
  open,
  row = null,
  mode = "salida",
  initialType = "BAJA",
  loading = false,
  onClose,
  onConfirm,
  onToast,
}) {
  const [tipo, setTipo] = useState(NORMALIZE_TYPE(initialType));

  useEffect(() => {
    if (!open) return;
    setTipo(NORMALIZE_TYPE(initialType));
  }, [open, initialType, row?.id_alumno]);

  const isExit = mode === "salida";
  const isReactivate = mode === "reactivar";
  const isGraduate = tipo === "EGRESO";

  const copy = useMemo(() => {
    if (isReactivate) {
      return {
        title: "Reactivar alumno",
        message: "El alumno volverá al padrón activo sin perder pagos ni historial.",
        confirmLabel: "Reactivar alumno",
        loadingLabel: "Reactivando...",
        successMessage: "Alumno reactivado correctamente.",
        errorMessage: "No se pudo reactivar el alumno.",
        tone: "success",
        icon: faUserCheck,
      };
    }

    if (isExit) {
      return isGraduate
        ? {
            title: "Mover alumno a Egresados",
            message: "El alumno dejará de figurar entre los activos y pasará a Egresados.",
            confirmLabel: "Mover a Egresados",
            loadingLabel: "Moviendo...",
            successMessage: "Alumno movido a Egresados correctamente.",
            errorMessage: "No se pudo mover el alumno a Egresados.",
            tone: "primary",
            icon: faGraduationCap,
          }
        : {
            title: "Dar de baja alumno",
            message: "El alumno dejará de figurar entre los activos y pasará a Bajas.",
            confirmLabel: "Dar de baja",
            loadingLabel: "Procesando...",
            successMessage: "Alumno dado de baja correctamente.",
            errorMessage: "No se pudo dar de baja el alumno.",
            tone: "warning",
            icon: faUserSlash,
          };
    }

    return isGraduate
      ? {
          title: "Mover alumno a Egresados",
          message: "El alumno pasará de Bajas a Egresados sin perder pagos ni historial.",
          confirmLabel: "Mover a Egresados",
          loadingLabel: "Moviendo...",
          successMessage: "Alumno movido a Egresados correctamente.",
          errorMessage: "No se pudo mover el alumno a Egresados.",
          tone: "primary",
          icon: faArrowRightArrowLeft,
        }
      : {
          title: "Mover alumno a Bajas",
          message: "El alumno pasará de Egresados a Bajas sin perder pagos ni historial.",
          confirmLabel: "Mover a Bajas",
          loadingLabel: "Moviendo...",
          successMessage: "Alumno movido a Bajas correctamente.",
          errorMessage: "No se pudo mover el alumno a Bajas.",
          tone: "warning",
          icon: faArrowRightArrowLeft,
        };
  }, [isExit, isGraduate, isReactivate]);

  const details = useMemo(
    () => [
      { label: "Alumno", value: row?.nombre_completo || "—" },
      {
        label: "Documento",
        value: [row?.tipo_documento_sigla, row?.num_documento].filter(Boolean).join(" ") || "—",
      },
      { label: "Curso", value: fullCourse(row) },
      { label: "Destino", value: isReactivate ? "ACTIVOS" : isGraduate ? "EGRESADOS" : "BAJAS" },
    ],
    [isGraduate, isReactivate, row],
  );

  const warning = isReactivate
    ? "El alumno volverá a Activos conservando su información, pagos e historial."
    : isExit
      ? Number(row?.id_anio) === 7
        ? "En 7° se propone Egreso por defecto, pero podés elegir Baja si el alumno cambia de escuela antes de egresar."
        : "Los pagos y el historial del alumno se conservarán."
      : "Solo cambia la clasificación del alumno; no se eliminan pagos ni historial.";

  return (
    <ModalEliminarGlobal
      open={open}
      operacion="advertencia"
      row={row}
      loading={loading}
      onClose={onClose}
      onToast={onToast}
      title={copy.title}
      message={copy.message}
      warning={warning}
      confirmLabel={copy.confirmLabel}
      loadingLabel={copy.loadingLabel}
      loadingMessage={copy.loadingLabel}
      successMessage={copy.successMessage}
      errorMessage={copy.errorMessage}
      tone={copy.tone}
      icon={copy.icon}
      details={details}
      showReason={isExit}
      reasonRequired={isExit}
      reasonLabel={isGraduate ? "Motivo del egreso *" : "Motivo de baja *"}
      reasonPlaceholder={
        isGraduate
          ? "Ej.: finalización de estudios, promoción..."
          : "Ej.: cambio de escuela, traslado, otro motivo..."
      }
      extraContent={
        isExit ? (
          <FloatingField label="Destino" active wide className="alumnos-stateField">
            <select value={tipo} onChange={(event) => setTipo(NORMALIZE_TYPE(event.target.value))}>
              <option value="BAJA">Dar de baja</option>
              <option value="EGRESO">Mover a Egresados</option>
            </select>
          </FloatingField>
        ) : null
      }
      onConfirm={({ motivo }) =>
        onConfirm?.({
          row,
          mode,
          tipo,
          motivo,
        })
      }
    />
  );
}
