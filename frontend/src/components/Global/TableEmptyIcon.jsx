import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInbox } from "@fortawesome/free-solid-svg-icons";
import "./TableEmptyIcon.css";

export default function TableEmptyIcon() {
  return <FontAwesomeIcon icon={faInbox} className="global-table-empty-icon" aria-hidden="true" />;
}
