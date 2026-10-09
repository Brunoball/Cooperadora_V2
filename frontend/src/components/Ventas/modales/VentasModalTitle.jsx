import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxOpen, faReceipt, faList, faGear } from "@fortawesome/free-solid-svg-icons";
import "./VentasModalTitle.css";

const icons = {
  producto: faBoxOpen,
  venta: faReceipt,
  conceptos: faList,
  configuracion: faGear,
};

export default function VentasModalTitle({ kind, children }) {
  return (
    <span>
      <FontAwesomeIcon
        icon={icons[kind]}
        className="ventas-modal-title-icon"
        aria-hidden="true"
      />
      {children}
    </span>
  );
}
