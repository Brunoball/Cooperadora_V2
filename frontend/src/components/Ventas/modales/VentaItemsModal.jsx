import React, { useEffect, useMemo, useState } from "react";
import { faTrashCan } from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { ActionButton } from "../VentasUI";
import { blankItem, money, upper, yes } from "../ventasUtils";

export default function VentaItemsModal({ open, items, products, campaign, initialId, onClose, onApply }) {
  const [draft, setDraft] = useState([blankItem()]);

  useEffect(() => {
    if (!open) return;
    const source = Array.isArray(items) && items.length ? items : [blankItem()];
    setDraft(source.map((item) => ({ ...item })));
  }, [open, items]);

  const setDraftItem = (index, patch) => {
    setDraft((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const chooseDraftProduct = (index, id) => {
    const product = products.find((item) => String(item.id_producto) === String(id));
    if (!product) {
      setDraftItem(index, { id_producto: "" });
      return;
    }
    const current = draft[index];
    const type = current?.tipo_precio || "anticipada";
    const price = type === "puerta"
      ? product.precio_puerta
      : type === "normal"
        ? product.precio
        : product.precio_anticipada;
    setDraftItem(index, {
      id_producto: String(id),
      producto_nombre: product.nombre,
      precio_unitario: price,
    });
  };

  const chooseDraftPriceType = (index, type) => {
    const item = draft[index];
    const product = products.find((productItem) => String(productItem.id_producto) === String(item.id_producto));
    const price = product
      ? type === "puerta"
        ? product.precio_puerta
        : type === "normal"
          ? product.precio
          : type === "anticipada"
            ? product.precio_anticipada
            : item.precio_unitario
      : item.precio_unitario;
    setDraftItem(index, { tipo_precio: type, precio_unitario: price });
  };

  const isValidItem = (item) => (
    String(item.producto_nombre || "").trim().length > 0
    && item.precio_unitario !== ""
    && item.precio_unitario != null
    && Number(item.precio_unitario) >= 0
    && Number(item.cantidad || 0) >= 1
  );

  const canApply = draft.length > 0 && draft.every(isValidItem);
  const draftTotal = useMemo(
    () => draft.reduce((sum, item) => sum + (Number(item.cantidad || 0) * Number(item.precio_unitario || 0)), 0),
    [draft],
  );

  const apply = (event) => {
    event.preventDefault();
    if (!canApply) return;
    onApply(draft.map((item) => ({ ...item })));
    onClose();
  };

  return (
    <CrudModal
      open={open}
      title="Productos y conceptos"
      subtitle="Agregá los conceptos de la venta. El total y el stock se validan nuevamente al confirmar la operación."
      onClose={onClose}
      onSubmit={apply}
      submitLabel="Aplicar conceptos"
      submitDisabled={!canApply}
      wide
      modalClassName="ventas-modal ventas-concepts-modal"
      closeOnBackdrop={false}
    >
      <div className="ventas-concepts-editor">
        <div className="ventas-concepts-editor__top">
          <div>
            <strong>Detalle de la venta</strong>
            <small>Podés seleccionar un producto existente o cargar un concepto manual.</small>
          </div>
          <button
            type="button"
            className="mov-btn mov-btn--ghost"
            onClick={() => setDraft((current) => [...current, blankItem()])}
          >
            Agregar concepto
          </button>
        </div>

        <div className="ventas-items-editor">
          {draft.map((item, index) => (
            <div className="ventas-item-row" key={`draft-item-${index}`}>
              <FloatingField label="Producto" className="ventas-item-field">
                <select value={item.id_producto || ""} onChange={(e) => chooseDraftProduct(index, e.target.value)}>
                  <option value="">CONCEPTO MANUAL</option>
                  {products
                    .filter((product) => {
                      const productId = String(product.id_producto || "");
                      const principalId = String(campaign?.id_producto_principal || "");
                      const historicalCurrent = initialId && productId === String(item.id_producto || "");
                      return (principalId && productId === principalId) || historicalCurrent;
                    })
                    .map((product) => (
                      <option key={product.id_producto} value={product.id_producto}>
                        {upper(product.nombre, 150)}
                        {String(product.id_producto) === String(campaign?.id_producto_principal || "")
                          ? ""
                          : " · HISTÓRICO"}
                        {yes(product.activo) ? "" : " · INACTIVO"}
                        {product.stock == null ? "" : ` · STOCK ${product.stock}`}
                      </option>
                    ))}
                </select>
              </FloatingField>
              <FloatingField label="Concepto manual" className="ventas-item-field">
                <input
                  required
                  placeholder="Ej.: VENTA ESPECIAL O ADICIONAL"
                  maxLength={150}
                  value={item.producto_nombre || ""}
                  onChange={(e) => setDraftItem(index, { producto_nombre: upper(e.target.value, 150) })}
                />
              </FloatingField>
              <FloatingField label="Tipo de precio" className="ventas-item-field">
                <select value={item.tipo_precio || "personalizado"} onChange={(e) => chooseDraftPriceType(index, e.target.value)}>
                  <option value="anticipada">ANTICIPADA</option>
                  <option value="puerta">PUERTA</option>
                  <option value="normal">NORMAL</option>
                  <option value="personalizado">PERSONALIZADO</option>
                </select>
              </FloatingField>
              <FloatingField label="Precio unitario" className="ventas-item-field">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ej.: 3500"
                  value={item.precio_unitario ?? ""}
                  onChange={(e) => setDraftItem(index, { precio_unitario: e.target.value })}
                />
              </FloatingField>
              <FloatingField label="Cantidad" className="ventas-item-field">
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ej.: 1"
                  value={item.cantidad ?? 1}
                  onChange={(e) => setDraftItem(index, { cantidad: e.target.value })}
                />
              </FloatingField>
              <div className="ventas-item-total">
                <span>Subtotal</span>
                <strong>{money(Number(item.precio_unitario || 0) * Number(item.cantidad || 0))}</strong>
              </div>
              <div className="ventas-item-action">
                <ActionButton
                  icon={faTrashCan}
                  title="Quitar concepto"
                  tone="danger"
                  disabled={draft.length <= 1}
                  onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="ventas-order-total ventas-order-total--concepts">
          <span>Subtotal productos</span>
          <strong>{money(draftTotal)}</strong>
        </div>
      </div>
    </CrudModal>
  );
}
