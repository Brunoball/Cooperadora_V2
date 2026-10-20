/** Plantillas por campaña: SOLO cuerpo de "Venta disponible" y avisos opcionales del PDF.
 * La identidad, resumen y flujo del bot existente permanecen intactos.
 */
export const MENSAJE_CANTIDAD_ANTERIOR = "Indicá la cantidad que querés comprar.{opcion_ganancia}";
export const MENSAJE_CANTIDAD_DEFECTO = `🛒 *Venta disponible:* {venta}
*Producto:* {producto}
*Precio unitario:* {precio_unitario}
{detalle_objetivo}
*Indicá cuántas unidades vendiste hoy.*{opcion_ganancia}`;
export const MENSAJE_GANANCIA_DEFECTO = "¡Gracias por colaborar con la cooperadora! Tu aporte quedó registrado.";
export const MENSAJE_MAX_CARACTERES = 1200;
export const contarCaracteresMensaje = (value) => Array.from(String(value ?? "")).length;
export const MENSAJE_COMPRA_DEFECTO = "¡Gracias por tu compra! Retirá {producto} el {fecha_entrega} {horarios_entrega}.";

// Unicamente los modelos antiguos EXACTOS se actualizan al abrir/guardar una
// campaña. Los mensajes personalizados de la cooperadora se respetan.
const MENSAJES_COMPRA_ANTERIORES = new Set([
  "¡Gracias por tu compra! Retirá {producto} el {fecha_entrega}, {horarios_entrega}. Presentá este comprobante.",
  "¡Gracias por tu compra! Pasá a retirar {producto} el {fecha_entrega}, {horarios_entrega}. Presentá este comprobante.",
]);
// Convertir exclusivamente los rótulos agregados automáticamente por la
// versión anterior; no reinterpretar indicaciones personalizadas.
const normalizarEtiquetasRetiroAnteriores = (plantilla) => {
  const original = String(plantilla);
  const etiquetas = /(?:^|\n)\s*(?:(?:📅|🕒)\s*)?\*(?:Fecha de entrega|Horarios de entrega):\*\s*\{(?:fecha_entrega|horarios_entrega)\}\s*(?=\n|$)/gu;
  if (!etiquetas.test(original)) return original;
  const sinEtiquetas = original.replace(new RegExp(etiquetas.source, 'gu'), '').trimEnd();
  const frase = "Retirá {producto} el {fecha_entrega} {horarios_entrega}.";
  const antigua = /(?:Retir[aá]|Pas[aá] a retirar)\s+\{producto\}[^\n.!?]*(?:[.]|$)/iu;
  if (antigua.test(sinEtiquetas)) return sinEtiquetas.replace(antigua, frase);
  return sinEtiquetas ? `${sinEtiquetas}\n${frase}` : frase;
};
export const mensajeCompraInicial = (valor) => {
  if (valor == null || MENSAJES_COMPRA_ANTERIORES.has(String(valor).trim())) {
    return MENSAJE_COMPRA_DEFECTO;
  }
  return normalizarEtiquetasRetiroAnteriores(valor);
};

// El editor anterior solo guardaba una indicación breve. Al reabrir campañas
// con ESE valor exacto, ofrecer la nueva plantilla completa sin pisar mensajes
// personalizados que los responsables ya hayan escrito.
export const mensajeVentaInicial = (valor) => {
  if (valor == null || valor === MENSAJE_CANTIDAD_ANTERIOR) return MENSAJE_CANTIDAD_DEFECTO;
  // Reemplazo puntual del aviso anterior; no modifica el resto del texto que
  // haya redactado el usuario. Se mantiene la variable para futuras campañas.
  return String(valor).replace(/Para pagar solo la ganancia,?\s*escrib[ií]\s*\*?0\*?\.?/giu,
    "Si todavía no vendiste, escribí *0* (sin cargo).");
};

// Admitidas por el sistema/API para sustituir datos al integrar el bot.
// No es necesario mostrar este catálogo técnico en los modales.
export const VARIABLES_MENSAJE_VENTA = [
  { variable: "venta", label: "Nombre de la venta" },
  { variable: "producto", label: "Producto principal" },
  { variable: "precio_unitario", label: "Precio por unidad" },
  { variable: "cantidad_minima", label: "Objetivo en unidades" },
  { variable: "detalle_objetivo", label: "Detalle del objetivo, si existe" },
  { variable: "opcion_ganancia", label: "Opción 0 sin cobro" },
  { variable: "ganancia_unidad", label: "Ganancia por faltante" },
  { variable: "ganancia_sin_ventas", label: "Ganancia con 0 unidades" },
  { variable: "fecha_entrega", label: "Fecha de entrega" },
  { variable: "horarios_entrega", label: "Horarios de retiro" },
  { variable: "cantidad", label: "Cantidad comprada" },
  { variable: "nombre", label: "Nombre del comprador" },
];

export const parseHorariosEntrega = (value) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return Array.isArray(parsed) ? parsed.map(({ desde, hasta }) => ({ desde: desde || "", hasta: hasta || "" })) : [];
  } catch { return []; }
};

export const fechaLegible = (date) => {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "(fecha por definir)";
};

export const horariosLegibles = (ranges) => {
  const valid = parseHorariosEntrega(ranges).filter((r) => r.desde && r.hasta).sort((a, b) => a.desde.localeCompare(b.desde));
  return valid.length ? valid.map((r) => `de ${r.desde} a ${r.hasta}`).join(" y ") : "(horarios por definir)";
};

// Coincide con el precio efectivo que utiliza la consulta de venta del bot:
// COALESCE(NULLIF(precio_anticipada, 0), precio, 0).
// Un precio anticipado en 0 usa el precio general; evita mostrar $0 en el editor.
export const precioUnitarioVenta = (producto = {}) => {
  const anticipada = Number(producto?.precio_anticipada);
  const general = Number(producto?.precio);
  if (Number.isFinite(anticipada) && anticipada > 0) return anticipada;
  return Number.isFinite(general) && general > 0 ? general : 0;
};

const pesos = (value) => new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(Number(value || 0));

/** Datos que se completan solos para cada campaña. Los marcadores internos no se
 * muestran en los campos de edición que utiliza la cooperadora.
 */
const datosParaMensaje = (form = {}, product = {}, example = {}) => {
  const minimo = Number(form.cantidad_minima_persona || 0);
  const detalle = minimo > 0 ? [
    `🎯 *Objetivo mínimo:* ${minimo} unidades por persona.`,
    `*Ganancia por faltante al cierre:* ${pesos(form.ganancia_unidad_faltante)}.`,
    `*Si no vende ninguna al cierre:* ${pesos(form.ganancia_total_sin_ventas)} en total.`,
    `Las ganancias se liquidan después de la fecha de fin.`,
  ].join("\n") : "";
  return {
    venta: form.nombre || "(venta)",
    producto: product?.nombre || "(producto)",
    precio_unitario: pesos(precioUnitarioVenta(product)),
    cantidad_minima: String(form.cantidad_minima_persona ?? 0),
    detalle_objetivo: detalle,
    opcion_ganancia: "\nSi todavía no vendiste, escribí 0 (sin cargo).",
    ganancia_unidad: pesos(form.ganancia_unidad_faltante),
    ganancia_sin_ventas: pesos(form.ganancia_total_sin_ventas),
    fecha_entrega: fechaLegible(form.fecha_entrega),
    horarios_entrega: horariosLegibles(form.horarios_entrega),
    cantidad: String(example.cantidad ?? "(cantidad comprada)"),
    nombre: String(example.nombre ?? "(nombre del alumno)"),
  };
};

const MARCADOR_INTERNO = /\{(venta|producto|precio_unitario|cantidad_minima|detalle_objetivo|opcion_ganancia|ganancia_unidad|ganancia_sin_ventas|fecha_entrega|horarios_entrega|cantidad|nombre)\}/g;

/** Se guarda una plantilla adaptable por campaña, pero se edita exactamente el
 * texto visible. El mapa de tramos permite conservar los datos dinámicos que el
 * usuario no haya editado, aun cuando cambie o borre el texto de alrededor.
 */
const renderConTramos = (plantilla, form, product, example) => {
  const original = String(plantilla ?? "");
  const datos = datosParaMensaje(form, product, example);
  const chars = [];
  const tokens = [];
  let ultimo = 0;
  let encontrado;
  const agregar = (texto) => {
    for (let i = 0; i < texto.length; i++) chars.push(texto[i]);
  };
  const expresion = new RegExp(MARCADOR_INTERNO.source, "g");
  while ((encontrado = expresion.exec(original))) {
    agregar(original.slice(ultimo, encontrado.index));
    const comienzo = chars.length;
    agregar(String(datos[encontrado[1]]));
    tokens.push({ marcador: encontrado[0], inicioCrudo: comienzo, finCrudo: chars.length });
    ultimo = encontrado.index + encontrado[0].length;
  }
  agregar(original.slice(ultimo));

  // Idéntica normalización que el texto final de WhatsApp: se compactan saltos
  // excesivos y se quitan los espacios de los extremos, sin alterar las líneas.
  const compactado = [];
  const posiciones = [0];
  let saltos = 0;
  for (const char of chars) {
    saltos = char === "\n" ? saltos + 1 : 0;
    if (saltos <= 2) compactado.push(char);
    posiciones.push(compactado.length);
  }
  let inicial = 0;
  let final = compactado.length;
  while (inicial < final && /\s/u.test(compactado[inicial])) inicial += 1;
  while (final > inicial && /\s/u.test(compactado[final - 1])) final -= 1;
  const ubicar = (indice) => Math.max(0, Math.min(final - inicial, posiciones[indice] - inicial));
  return {
    texto: compactado.slice(inicial, final).join(""),
    tokens: tokens.map(({ marcador, inicioCrudo, finCrudo }) => ({
      marcador, inicio: ubicar(inicioCrudo), fin: ubicar(finCrudo),
    })),
  };
};

/** El texto que verá la familia o que irá al comprobante PDF. */
export const mensajeRenderizado = (plantilla, form = {}, product = {}, example = {}) =>
  renderConTramos(plantilla, form, product, example).texto;

/** Editor visual: al escribir se preservan los marcadores internos de datos
 * cuyos valores mostrados NO fueron modificados. Si la persona sustituye el
 * valor concreto de un dato, respeta su elección y lo convierte a texto libre.
 * No se exponen llaves, tokens ni instrucciones técnicas en el formulario.
 */
export const actualizarMensajeVisual = (plantilla, textoEditado, form = {}, product = {}, example = {}) => {
  const previo = renderConTramos(plantilla, form, product, example);
  const actual = String(textoEditado ?? "");
  if (actual === previo.texto) return String(plantilla ?? "");
  const anterior = previo.texto;
  let prefijo = 0;
  while (prefijo < anterior.length && prefijo < actual.length && anterior[prefijo] === actual[prefijo]) prefijo++;
  let sufijo = 0;
  while (sufijo < anterior.length - prefijo && sufijo < actual.length - prefijo &&
    anterior[anterior.length - 1 - sufijo] === actual[actual.length - 1 - sufijo]) sufijo++;
  const desplazamiento = actual.length - anterior.length;
  const conservados = [];
  let siguienteBusqueda = prefijo;
  for (const tramo of previo.tokens) {
    const anteriorAlCambio = tramo.fin <= prefijo;
    const posteriorAlCambio = tramo.inicio >= anterior.length - sufijo;
    let inicio;
    let fin;
    if (anteriorAlCambio) {
      inicio = tramo.inicio;
      fin = tramo.fin;
    } else if (posteriorAlCambio) {
      inicio = tramo.inicio + desplazamiento;
      fin = tramo.fin + desplazamiento;
    } else {
      // Pegar un mensaje con VARIAS frases modificadas no debe congelar
      // el precio, producto, fechas, etc. Reencontramos por orden los valores
      // automáticos que siguen presentes dentro de la zona editada.
      const visible = anterior.slice(tramo.inicio, tramo.fin);
      if (!visible) continue;
      const encontrado = actual.indexOf(visible, siguienteBusqueda);
      if (encontrado < 0 || encontrado + visible.length > actual.length - sufijo) continue;
      inicio = encontrado;
      fin = encontrado + visible.length;
    }
    // Cuando el dato aún no tiene contenido (ej.: opción de ganancia con
    // objetivo 0), conservarlo al final aunque se agregue texto detrás.
    if (tramo.inicio === tramo.fin && tramo.inicio === anterior.length && actual.length > anterior.length && prefijo === anterior.length) {
      inicio = actual.length;
      fin = actual.length;
    }
    conservados.push({ ...tramo, inicio, fin });
    siguienteBusqueda = Math.max(siguienteBusqueda, fin);
  }
  conservados.sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  let resultado = "";
  let cursor = 0;
  for (const tramo of conservados) {
    if (tramo.inicio < cursor || tramo.fin > actual.length) continue;
    resultado += actual.slice(cursor, tramo.inicio) + tramo.marcador;
    cursor = tramo.fin;
  }
  return resultado + actual.slice(cursor);
};

/** Restaura fecha/horarios como variables para que cambien con la campaña.
 * En el comprobante se conservan en una sola frase, sin rótulos técnicos:
 * «Retirá PRODUCTO el DD/MM/AAAA de HH:MM a HH:MM».
 * No se altera ninguna plantilla que ya conserve ambos datos automáticos.
 */
export const reponerDatoEntrega = (plantilla, campo, tipo = "venta") => {
  const variable = campo === "fecha_entrega" ? "fecha_entrega" :
    campo === "horarios_entrega" ? "horarios_entrega" : null;
  let texto = String(plantilla ?? "");
  if (!variable || texto.includes(`{${variable}}`)) return texto;

  const fecha = "{fecha_entrega}";
  const horario = "{horarios_entrega}";
  if (tipo === "compra") {
    // Si queda una frase de retiro, reconstruirla completa: también resuelve
    // las comas y palabras sueltas que pueden quedar tras un borrado manual.
    const fraseRetiro = /(?:Retir[aá]|Pas[aá] a retirar)\s+\{producto\}[^\n.!?]*(?:[.]|$)/iu;
    if (fraseRetiro.test(texto)) {
      return texto.replace(fraseRetiro, `Retirá {producto} el ${fecha} ${horario}.`);
    }
    // Si se borró incluso la frase de retiro, no reescribir otros textos de la
    // cooperadora: incorporar una indicación de entrega breve al final.
    const nuevaFrase = `Retirá {producto} el ${fecha} ${horario}.`;
    return texto.trimEnd() ? `${texto.trimEnd()}\n${nuevaFrase}` : nuevaFrase;
  }

  // En el mensaje general (venta disponible), usar una frase sencilla y no
  // «Horarios de retiro» ni «Fecha de entrega» como etiquetas separadas.
  if (texto.includes(fecha) && !texto.includes(horario)) {
    return texto.replace(fecha, `${fecha} ${horario}`);
  }
  if (texto.includes(horario) && !texto.includes(fecha)) {
    return texto.replace(horario, `el ${fecha} ${horario}`);
  }
  const linea = `Entrega el ${fecha} ${horario}.`;
  return texto.trimEnd() ? `${texto.trimEnd()}\n${linea}` : linea;
};
