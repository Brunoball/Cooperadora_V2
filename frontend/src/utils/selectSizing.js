/**
 * Ancho intrínseco e independiente de cada <select>.
 * El navegador mide un control nativo con la opción más larga seleccionada;
 * no se suman píxeles arbitrarios por flecha, padding o márgenes.
 */
const COMPACT_LABEL = /^(?:a[nñ]o|a[nñ]os|mes|meses|per[ií]odo|curso|divisi[oó]n|ciclo lectivo)(?:\b|$)/i;
const COMPACT_CLASS = /(?:^|[\s_-])(?:year|month|curso|anio|ano|mes|periodo|period|division|cycle)(?:[\s_-]|$)/i;
const SIZE_ATTR = 'data-global-select-sizing';
const WIDTH_VAR = '--global-select-option-width';
const CURRENT_VAR = '--global-select-current-width';
const PROBE_ATTR = 'data-global-select-probe';

function normalized(text = '') {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function floatingLabel(select, wrapper) {
  return (wrapper?.querySelector(':scope > .module-floatingLabel, :scope > .entity-floating-label, :scope > span')) ||
    select.parentElement?.querySelector(':scope > .module-floatingLabel, :scope > .entity-floating-label');
}

function optionText(option) {
  return (option.label || option.textContent || '').trim();
}

function measure(select, wrapper, probe, context) {
  const style = getComputedStyle(select);
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.font = font;
  if ('letterSpacing' in context) context.letterSpacing = style.letterSpacing;

  let longest = '';
  let length = 0;
  for (const option of select.options) {
    const value = optionText(option);
    const measured = context.measureText(value).width;
    if (measured > length) { longest = value; length = measured; }
  }
  if (!select.options.length) longest = select.getAttribute('aria-label') || '';

  // Medimos el ancho real del control de Chrome/Firefox (incluida su flecha)
  // con SOLO la opción más larga, sin reglas de ancho impuestas por módulos.
  // field-sizing:content mide el texto y el espacio intrínseco de la flecha.
  probe.style.font = font;
  probe.style.letterSpacing = style.letterSpacing;
  probe.style.border = `${style.borderLeftWidth} ${style.borderLeftStyle} transparent`;
  probe.style.borderRightWidth = style.borderRightWidth;
  probe.style.borderTopWidth = style.borderTopWidth;
  probe.style.borderBottomWidth = style.borderBottomWidth;
  probe.style.appearance = style.appearance;
  probe.style.padding = '0 0 0 6px';
  probe.style.setProperty('padding-right', '0px', 'important');
  probe.style.setProperty('width', 'max-content', 'important');
  probe.style.setProperty('min-width', '0', 'important');
  probe.style.setProperty('max-width', 'none', 'important');
  probe.style.setProperty('field-sizing', 'content', 'important');
  probe.options[0].textContent = longest || ' ';
  const intrinsicWidth = probe.getBoundingClientRect().width;
  // Por debajo de 1600 px los filtros extensos pueden reducirse, pero nunca
  // menos que el texto actualmente visible.
  const currentValue = optionText(select.selectedOptions?.[0] || { label: '' });
  probe.options[0].textContent = currentValue || ' ';
  const currentIntrinsicWidth = probe.getBoundingClientRect().width;

  // Los labels flotantes no deben quedar cortados por un borde estrecho.
  // Su tamaño se obtiene del propio label, sin utilizar la tipografía del select.
  const label = floatingLabel(select, wrapper);
  let labelWidth = 0;
  if (label) {
    const labelStyle = getComputedStyle(label);
    context.font = `${labelStyle.fontStyle} ${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`;
    if ('letterSpacing' in context) context.letterSpacing = labelStyle.letterSpacing;
    const left = (parseFloat(labelStyle.left) || 0) + (parseFloat(labelStyle.marginLeft) || 0);
    const padding = (parseFloat(labelStyle.paddingLeft) || 0) + (parseFloat(labelStyle.paddingRight) || 0);
    labelWidth = left + context.measureText(label.textContent.trim()).width + padding + 3;
  }

  // Para íconos CSS personalizados (appearance:none), el navegador no reserva
  // automáticamente espacio. Se mide el tamaño del fondo si está definido.
  let customArrow = 0;
  if (style.appearance === 'none' && style.backgroundImage !== 'none') {
    const bgWidth = parseFloat(style.backgroundSize) || 12;
    customArrow = Math.max(0, bgWidth) + 6;
  }

  const width = `${Math.ceil(Math.max(intrinsicWidth + customArrow + 1, labelWidth))}px`;
  const currentWidth = `${Math.ceil(Math.max(currentIntrinsicWidth + customArrow + 1, labelWidth))}px`;
  const semanticLabel = normalized(select.getAttribute('aria-label') || label?.textContent || select.name || select.id);
  const classes = [select.className, wrapper?.className].filter(v => typeof v === 'string').join(' ');
  const compact = COMPACT_LABEL.test(semanticLabel) || COMPACT_CLASS.test(classes) || length <= 110;
  return { kind: compact ? 'compact' : 'wide', width, currentWidth };
}

export function enableGlobalSelectSizing() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return () => {};

  const probe = document.createElement('select');
  probe.setAttribute(PROBE_ATTR, '');
  probe.appendChild(document.createElement('option'));
  probe.style.cssText = 'position:fixed!important;top:-10000px!important;left:-10000px!important;visibility:hidden!important;pointer-events:none!important;margin:0!important;box-sizing:border-box!important;display:block!important;height:44px!important;';

  let frame = null;
  let disposed = false;
  const pending = new Set();

  function update(select) {
    if (!select.isConnected || select.hasAttribute(PROBE_ATTR) || select.multiple || select.size > 1) return;
    const wrapper = select.closest('.module-filter--select, .mov-filter, .entity-floating-field');
    const { kind, width, currentWidth } = measure(select, wrapper, probe, context);
    if (select.getAttribute(SIZE_ATTR) !== kind) select.setAttribute(SIZE_ATTR, kind);
    if (select.style.getPropertyValue(WIDTH_VAR) !== width) select.style.setProperty(WIDTH_VAR, width);
    if (select.style.getPropertyValue(CURRENT_VAR) !== currentWidth) select.style.setProperty(CURRENT_VAR, currentWidth);
    // No reutilizar variables ni asignar anchos por índice/nth-child.
    // Cada contenedor recibe únicamente la medición de su propio select.
    if (wrapper && wrapper.querySelectorAll('select').length === 1) {
      if (wrapper.getAttribute(SIZE_ATTR) !== kind) wrapper.setAttribute(SIZE_ATTR, kind);
      if (wrapper.style.getPropertyValue(WIDTH_VAR) !== width) wrapper.style.setProperty(WIDTH_VAR, width);
      if (wrapper.style.getPropertyValue(CURRENT_VAR) !== currentWidth) wrapper.style.setProperty(CURRENT_VAR, currentWidth);
    }
  }
  function flush() {
    frame = null;
    if (disposed) return;
    document.body.appendChild(probe);
    try { pending.forEach(update); } finally { probe.remove(); pending.clear(); }
  }
  function queue(select) {
    if (!select || select.tagName !== 'SELECT' || select.hasAttribute(PROBE_ATTR)) return;
    pending.add(select);
    if (frame === null) frame = requestAnimationFrame(flush);
  }
  function queueWithin(node) {
    if (node.nodeType !== 1 || node.hasAttribute?.(PROBE_ATTR)) return;
    if (node.matches('select')) queue(node);
    node.querySelectorAll?.(`select:not([${PROBE_ATTR}])`).forEach(queue);
  }
  const queueAll = () => queueWithin(document.body);
  queueAll();
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.target === probe || probe.contains(mutation.target)) continue;
      if (mutation.type === 'characterData') queue(mutation.target.parentElement?.closest('select'));
      else {
        queue(mutation.target.closest?.('select'));
        mutation.addedNodes.forEach(queueWithin);
      }
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  document.fonts?.ready?.then(() => { if (!disposed) queueAll(); });
  const onChange = event => { if (event.target?.matches?.('select')) queue(event.target); };
  document.addEventListener('change', onChange, true);
  window.addEventListener('resize', queueAll);
  return () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('resize', queueAll);
    document.removeEventListener('change', onChange, true);
    if (frame !== null) cancelAnimationFrame(frame);
    pending.clear();
    probe.remove();
  };
}
