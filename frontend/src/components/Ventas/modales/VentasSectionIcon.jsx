import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faReceipt, faUser, faBoxOpen, faBullseye, faCalculator, faCalendarDays, faTags, faLock } from "@fortawesome/free-solid-svg-icons";
import "./VentasSectionIcon.css";
const icons = { sale: faReceipt, person: faUser, product: faBoxOpen, objective: faBullseye, calculation: faCalculator, messages: faCalendarDays, prices: faTags, locked: faLock };
export default function VentasSectionIcon({ kind }) {
  return <FontAwesomeIcon icon={icons[kind] || faReceipt} className="ventas-section-icon" aria-hidden="true" />;
}
