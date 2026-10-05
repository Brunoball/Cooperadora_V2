import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBroom, faEllipsisVertical, faEnvelope, faEnvelopeOpen, faImages, faPen, faTag, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import "./ChatOptionsMenu.css";

const MENU_W = 218;
const GAP = 8;

const ChatOptionsMenu = ({
  open,
  onOpen,
  onClose,

  onEditarNombre,
  onCambiarEtiqueta,
  onVaciarChat,
  onEliminarContacto,
  onMarcarNoLeido,
  onMarcarLeido,
  isUnread = false,

  onVerGaleria, // ✅ NUEVO
}) => {
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const calcPos = () => {
    const b = btnRef.current;
    if (!b) return;

    const r = b.getBoundingClientRect();
    let top = r.bottom + GAP;
    let left = r.right - MENU_W;

    const maxLeft = window.innerWidth - MENU_W - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;

    const menuH = 302; // ✅ más alto por galería + marcar leído/no leído
    const maxTop = window.innerHeight - menuH - 8;
    if (top > maxTop) top = Math.max(8, r.top - menuH - GAP);

    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;

    calcPos();

    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) onClose?.();
    };

    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    const onRecalc = () => calcPos();

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onRecalc);
    window.addEventListener("scroll", onRecalc, true);

    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onRecalc);
      window.removeEventListener("scroll", onRecalc, true);
    };
  }, [open, onClose]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (open) return onClose?.();
    calcPos();
    onOpen?.();
  };

  return (
    <div
      className="chatopts chatopts--header"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        className={`chatopts-btn ${open ? "is-open" : ""}`}
        title="Opciones del chat"
        aria-label="Opciones del chat"
        onClick={toggle}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>

      {open ? (
        <div className="chatopts-menu" role="menu" aria-label="Opciones del chat" style={{ top: pos.top, left: pos.left, width: MENU_W }}>
          <button
            type="button"
            className="chatopts-item"
            onClick={() => {
              onClose?.();
              onEditarNombre?.();
            }}
          >
            <span className="chatopts-item-ico"><FontAwesomeIcon icon={faPen} /></span>
            <span>Editar nombre</span>
          </button>

          <button
            type="button"
            className="chatopts-item"
            onClick={() => {
              onClose?.();
              onCambiarEtiqueta?.();
            }}
          >
            <span className="chatopts-item-ico"><FontAwesomeIcon icon={faTag} /></span>
            <span>Cambiar etiqueta</span>
          </button>

          {/* ✅ NUEVO */}
          <button
            type="button"
            className="chatopts-item chatopts-item--gallery"
            onClick={() => {
              onClose?.();
              onVerGaleria?.();
            }}
          >
            <span className="chatopts-item-ico"><FontAwesomeIcon icon={faImages} /></span>
            <span>Ver galería</span>
          </button>


          <button
            type="button"
            className={`chatopts-item ${isUnread ? "chatopts-item--read" : "chatopts-item--unread"}`}
            onClick={() => {
              onClose?.();
              if (isUnread) onMarcarLeido?.();
              else onMarcarNoLeido?.();
            }}
          >
            <span className="chatopts-item-ico">
              <FontAwesomeIcon icon={isUnread ? faEnvelopeOpen : faEnvelope} />
            </span>
            <span>{isUnread ? "Marcar como leído" : "Marcar como no leído"}</span>
          </button>

          <button
            type="button"
            className="chatopts-item"
            onClick={() => {
              onClose?.();
              onVaciarChat?.();
            }}
          >
            <span className="chatopts-item-ico"><FontAwesomeIcon icon={faBroom} /></span>
            <span>Vaciar chat</span>
          </button>

          <button
            type="button"
            className="chatopts-item chatopts-item--danger"
            onClick={() => {
              onClose?.();
              onEliminarContacto?.();
            }}
          >
            <span className="chatopts-item-ico"><FontAwesomeIcon icon={faTrashCan} /></span>
            <span>Eliminar contacto</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default ChatOptionsMenu;
