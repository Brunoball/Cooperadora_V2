import React, { useMemo } from "react";

export function getGlobalPaginationItems(currentPage, totalPages) {
  const safeTotal = Math.max(0, Number(totalPages || 0));
  const safeCurrent = Math.min(Math.max(1, Number(currentPage || 1)), Math.max(1, safeTotal));

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  const items = [1];
  if (safeCurrent > 4) items.push("ellipsis-left");

  const from = Math.max(2, safeCurrent - 1);
  const to = Math.min(safeTotal - 1, safeCurrent + 1);
  for (let page = from; page <= to; page += 1) items.push(page);

  if (safeCurrent < safeTotal - 3) items.push("ellipsis-right");
  items.push(safeTotal);
  return items;
}

/**
 * Paginación global inspirada en RH.
 * Centraliza estructura, pestañas numéricas, elipsis, estados de carga y resumen.
 * Los módulos solo aportan sus datos y, si hace falta, acciones laterales.
 */
export default function GlobalPagination({
  currentPage = 1,
  totalPages = 0,
  totalRecords = 0,
  from = 0,
  to = 0,
  onPageChange,
  loading = false,
  itemLabel = "registros",
  ariaLabel = "Paginación",
  loadingLabel = "Cargando página...",
  leftContent = null,
  rightContent = null,
  className = "",
  showSummary = true,
  showControls = true,
  showWhenEmpty = false,
}) {
  const records = Math.max(0, Number(totalRecords || 0));
  const pages = Math.max(0, Number(totalPages || 0));
  const page = Math.min(Math.max(1, Number(currentPage || 1)), Math.max(1, pages));
  const first = records ? Math.max(1, Number(from || 0)) : 0;
  const last = records ? Math.max(first, Number(to || 0)) : 0;
  const pageItems = useMemo(() => getGlobalPaginationItems(page, pages), [page, pages]);
  const hasRecords = records > 0;
  const hasLeft = Boolean(leftContent) || (showSummary && (hasRecords || showWhenEmpty));
  const hasRight = Boolean(rightContent) || (showControls && hasRecords);

  if (!hasLeft && !hasRight && !showWhenEmpty) return null;

  const goTo = (nextPage) => {
    if (loading || typeof onPageChange !== "function") return;
    const bounded = Math.min(Math.max(1, Number(nextPage || 1)), Math.max(1, pages));
    if (bounded !== page) onPageChange(bounded);
  };

  return (
    <footer className={`global-pagination ${className}`.trim()}>
      <div className="global-pagination__left">
        {leftContent}
        {showSummary && (hasRecords || showWhenEmpty) ? (
          <p className="global-pagination__summary">
            {hasRecords ? (
              <>
                Mostrando <strong>{first}</strong>–<strong>{last}</strong> de <strong>{records}</strong> {itemLabel}
              </>
            ) : (
              <><strong>0</strong> {itemLabel}</>
            )}
            {loading ? <span>{loadingLabel}</span> : null}
          </p>
        ) : null}
      </div>

      <div className="global-pagination__right">
        {showControls && hasRecords ? (
          <nav className="global-pagination__controls" aria-label={ariaLabel}>
            <button
              type="button"
              onClick={() => goTo(page - 1)}
              disabled={loading || page <= 1}
            >
              Anterior
            </button>

            {pageItems.map((item) =>
              typeof item === "number" ? (
                <button
                  type="button"
                  key={item}
                  className={item === page ? "is-active" : ""}
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => goTo(item)}
                  disabled={loading}
                >
                  {item}
                </button>
              ) : (
                <span className="global-pagination__ellipsis" key={item} aria-hidden="true">…</span>
              ),
            )}

            <button
              type="button"
              onClick={() => goTo(page + 1)}
              disabled={loading || pages === 0 || page >= pages}
            >
              Siguiente
            </button>
          </nav>
        ) : null}
        {rightContent}
      </div>
    </footer>
  );
}
