import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export function ActionButton({ icon, title, tone = "", ...props }) {
  const toneClass = tone === "danger" ? "mov-iconBtn--danger" : "";
  return (
    <button
      type="button"
      className={`mov-iconBtn ${toneClass}`.trim()}
      title={title}
      aria-label={title}
      {...props}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

export function VentasCheckbox({
  checked,
  onChange,
  label = "",
  disabled = false,
  action = false,
  className = "",
  title,
  ariaLabel,
}) {
  const classes = [
    "ventas-check",
    action ? "ventas-check--action" : "ventas-check--field",
    className,
  ].filter(Boolean).join(" ");

  return (
    <label className={classes} title={title}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        aria-label={ariaLabel || label || title}
        onChange={(event) => onChange?.(event.target.checked, event)}
      />
      {label ? <span className="ventas-check__label">{label}</span> : null}
    </label>
  );
}
