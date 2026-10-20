/** Nueva configuración de mensajes y retiros: datos E2E aislados PW E2E. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, today, tomorrow } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

// Cargar la utilidad dentro del test, no al importar la suite en el explorador
// de VS Code. La lectura asíncrona evita el aviso sobre la lectura síncrona.
// Se evalúa el módulo real (sin duplicar las funciones de producción).
async function cargarMensajesVentas() {
  const archivo = path.join(__dirname, "..", "src", "components", "Ventas", "ventaMensajes.js");
  let codigo;
  try {
    codigo = await fs.promises.readFile(archivo, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Falta frontend/src/components/Ventas/ventaMensajes.js. Copiá el archivo src/ventaMensajes.js incluido en el ZIP a su ruta original.", { cause: error });
    }
    throw error;
  }
  const codigoEvaluable = codigo.replace(/\bexport const /g, "const ");
  return vm.runInNewContext(`${codigoEvaluable}\n({ parseHorariosEntrega, fechaLegible, horariosLegibles, mensajeRenderizado, mensajeVentaInicial, MENSAJE_CANTIDAD_DEFECTO, MENSAJE_CANTIDAD_ANTERIOR, MENSAJE_COMPRA_DEFECTO, actualizarMensajeVisual, VARIABLES_MENSAJE_VENTA })`);
}

const horarios = [{ desde: "09:00", hasta: "11:00" }, { desde: "15:00", hasta: "17:00" }];
const mensajes = {
  mensaje_indicaciones: "Indicá la cantidad (0 si solo pagás ganancia).",
  mensaje_pago_ganancia: "Gracias por colaborar con la cooperadora.",
  mensaje_pago_compra: "Gracias por comprar {producto}. Retirá el {fecha_entrega}, {horarios_entrega}.",
};

test("mensajes: tres plantillas configurables usan valores de su campaña y horarios reales", async () => {
  const util = await cargarMensajesVentas();
  const form = { ...mensajes, nombre: "VENTA DE PAN DULCE Y DURAZNO", fecha_entrega: "2026-10-30", horarios_entrega: horarios,
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000, ganancia_total_sin_ventas: 9000 };
  const producto = { nombre: "PAN DULCE + DURAZNO", precio_anticipada: 8000 };
  const compra = util.mensajeRenderizado("{venta}: {producto}, {precio_unitario}. Retirá el {fecha_entrega}, {horarios_entrega}.", form, producto);
  expect(compra).toContain("VENTA DE PAN DULCE Y DURAZNO");
  expect(compra).toContain("PAN DULCE + DURAZNO");
  expect(compra).toContain("8.000");
  expect(compra).toContain("30/10/2026");
  expect(compra).toContain("de 09:00 a 11:00 y de 15:00 a 17:00");
  expect(util.mensajeRenderizado("Objetivo: {cantidad_minima}, faltante {ganancia_unidad}, cero {ganancia_sin_ventas}", form, producto))
    .toContain("9.000");
  expect(util.mensajeRenderizado(mensajes.mensaje_pago_ganancia, form, producto)).not.toContain("Retirá");
  expect(util.VARIABLES_MENSAJE_VENTA.map(({ variable }) => variable)).toContain("precio_unitario");
  expect(util.VARIABLES_MENSAJE_VENTA.map(({ variable }) => variable)).toContain("detalle_objetivo");
  // El único mensaje editable del flujo incluye la venta disponible completa.
  const disponible = util.mensajeRenderizado(util.MENSAJE_CANTIDAD_DEFECTO, form, producto);
  expect(disponible).toContain("Venta disponible:");
  expect(disponible).toContain("VENTA DE PAN DULCE Y DURAZNO");
  expect(disponible).toContain("PAN DULCE + DURAZNO");
  expect(disponible).toContain("8.000");
  expect(disponible).toContain("3 unidades por persona");
  expect(disponible).toContain("3.000");
  expect(disponible).toContain("9.000");
  expect(disponible).toContain("escribí 0");
  expect(disponible).not.toContain("Persona confirmada");
  const disponibleSinObjetivo = util.mensajeRenderizado(util.MENSAJE_CANTIDAD_DEFECTO,
    { ...form, cantidad_minima_persona: 0 }, producto);
  expect(disponibleSinObjetivo).not.toContain("Objetivo:");
  expect(disponibleSinObjetivo).not.toContain("escribí 0");
  expect(disponibleSinObjetivo).not.toContain("{detalle_objetivo}");
  expect(util.mensajeVentaInicial(util.MENSAJE_CANTIDAD_ANTERIOR)).toBe(util.MENSAJE_CANTIDAD_DEFECTO);
  expect(util.mensajeVentaInicial("Mensaje propio del cliente")).toBe("Mensaje propio del cliente");
  expect(util.mensajeRenderizado("", form, producto)).toBe("");
  expect(util.mensajeRenderizado("Cantidad.{opcion_ganancia}", form, producto)).toContain("escribí 0");
  expect(util.mensajeRenderizado("Cantidad.{opcion_ganancia}", { ...form, cantidad_minima_persona: 0 }, producto)).toBe("Cantidad.");
  // Cambiar de campaña no cambia una cadena fija: todas las variables se recalculan.
  const otra = util.mensajeRenderizado("{venta}: {producto} ({precio_unitario})", { ...form, nombre: "BAILABLE" },
    { nombre: "ENTRADA GENERAL", precio_anticipada: 12000 });
  expect(otra).toContain("BAILABLE: ENTRADA GENERAL");
  expect(otra).toContain("12.000");
  expect(otra).not.toContain("PAN DULCE");
});

test("interfaz: solo edita venta disponible y dos avisos opcionales de PDF", async () => {
  const modal = await fs.promises.readFile(path.join(__dirname, "..", "src", "components", "Ventas", "modales", "ConfiguracionVentaModal.jsx"), "utf8");
  expect(modal).toContain('label: "Datos de la venta"');
  expect(modal).toContain('label: "Mensajes WhatsApp"');
  expect(modal).toContain('active={activeTab === "datos"}');
  expect(modal).toContain('active={activeTab === "mensajes"}');
  expect(modal).toContain('setActiveTab("datos")');
  expect(modal).toContain('value={mensajeRenderizado(form.mensaje_indicaciones, form, currentProduct)}');
  expect(modal).toContain('value={mensajeRenderizado(form.mensaje_pago_ganancia, form, currentProduct)}');
  expect(modal).toContain('value={mensajeRenderizado(form.mensaje_pago_compra, form, currentProduct)}');
  expect(modal).toContain('actualizarMensajeVisual(form.mensaje_indicaciones, e.target.value');
  expect(modal).toContain('actualizarMensajeVisual(form.mensaje_pago_compra, e.target.value');
  expect(modal).toContain("Mensajes importantes para el PDF");
  expect(modal).toContain("Mensaje para la familia");
  expect(modal).toContain("Si paga solo la ganancia (0 productos)");
  expect(modal).toContain("Si compra uno o más productos");
  expect(modal).toContain("mensajeVentaInicial(initial?.mensaje_indicaciones)");
  expect(modal).toContain("initial?.mensaje_pago_ganancia ?? MENSAJE_GANANCIA_DEFECTO");
  expect(modal).not.toContain("Variables automáticas disponibles");
  expect(modal).not.toContain("ventas-message-variables");
  expect(modal).not.toContain("ventaMensajeCorto");
  expect(modal).not.toContain("Los datos entre llaves");
  expect(modal).not.toContain("Así se verá en WhatsApp");
  expect(modal).not.toContain("Esta pantalla solo guarda la configuración");
  expect(modal).not.toContain('className="ventas-message-preview"');
});

test("editor visual: permite escribir directamente y mantiene los datos que se actualizan solos", async () => {
  const util = await cargarMensajesVentas();
  const producto = { nombre: "DURAZNO Y PAN DULCE", precio_anticipada: 3500 };
  const campania = {
    nombre: "VENTA DE DURAZNO Y PAN DULCE", cantidad_minima_persona: 3,
    ganancia_unidad_faltante: 1500, ganancia_total_sin_ventas: 8000,
    fecha_entrega: "2026-10-30", horarios_entrega: horarios,
  };
  let guardado = util.MENSAJE_CANTIDAD_DEFECTO;
  let visible = util.mensajeRenderizado(guardado, campania, producto);
  expect(visible).not.toContain("{producto}");
  expect(visible).toContain("DURAZNO Y PAN DULCE");
  // Cada edición simula una escritura normal, conservando los demás datos.
  for (const [anterior, nuevo] of [
    ["Venta disponible", "Compra escolar disponible"],
    ["Indicá la cantidad", "Elegí la cantidad"],
  ]) {
    const editado = visible.replace(anterior, nuevo);
    guardado = util.actualizarMensajeVisual(guardado, editado, campania, producto);
    visible = util.mensajeRenderizado(guardado, campania, producto);
    expect(visible).toBe(editado);
  }
  expect(guardado).toContain("{producto}");
  expect(guardado).toContain("{venta}");
  expect(guardado).toContain("{precio_unitario}");
  expect(guardado).toContain("{detalle_objetivo}");
  const nuevaCampania = { ...campania, nombre: "EL BAILABLE", ganancia_unidad_faltante: 3000 };
  const nuevoProducto = { nombre: "ENTRADA GENERAL", precio_anticipada: 12000 };
  const nuevoMensaje = util.mensajeRenderizado(guardado, nuevaCampania, nuevoProducto);
  expect(nuevoMensaje).toContain("EL BAILABLE");
  expect(nuevoMensaje).toContain("ENTRADA GENERAL");
  expect(nuevoMensaje).toContain("12.000");
  expect(nuevoMensaje).toContain("3.000");
  expect(nuevoMensaje).toContain("Compra escolar disponible");
  // Modificar un valor concreto respeta el texto escrito, sin alterar otros valores.
  const modificado = util.actualizarMensajeVisual(guardado,
    visible.replace("DURAZNO Y PAN DULCE\n*Precio", "COMBO PERSONALIZADO\n*Precio"), campania, producto);
  expect(util.mensajeRenderizado(modificado, campania, producto)).toContain("COMBO PERSONALIZADO");
  expect(modificado).toContain("{precio_unitario}");
});

test("editor visual: avisos de PDF editables, opcionales y con fecha/horario dinámicos", async () => {
  const util = await cargarMensajesVentas();
  const form = { nombre: "VENTA", cantidad_minima_persona: 3, fecha_entrega: "2026-10-30", horarios_entrega: horarios };
  const producto = { nombre: "COMBO DE DURAZNO", precio_anticipada: 8000 };
  const previo = util.mensajeRenderizado(util.MENSAJE_COMPRA_DEFECTO, form, producto);
  const editado = previo.replace("¡Gracias por tu compra!", "¡Muchas gracias por participar!");
  const guardado = util.actualizarMensajeVisual(util.MENSAJE_COMPRA_DEFECTO, editado, form, producto);
  expect(util.mensajeRenderizado(guardado, form, producto)).toBe(editado);
  expect(guardado).toContain("{fecha_entrega}");
  expect(guardado).toContain("{horarios_entrega}");
  expect(util.mensajeRenderizado(guardado, { ...form, fecha_entrega: "2026-11-04" }, producto))
    .toContain("04/11/2026");
  expect(util.actualizarMensajeVisual(guardado, "", form, producto)).toBe("");
  expect(util.actualizarMensajeVisual("Gracias por colaborar.", "", form, producto)).toBe("");
});

test("campaña: horarios y mensajes persisten sin alterar flujo legado del bot", async ({ request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Requiere entorno E2E aislado autorizado.");
  const t = token(), marker = suffix();
  const producto = await createSalesProduct(request, t, marker);
  const campaña = await createSalesCampaign(request, t, producto, marker, {
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(),
    horarios_entrega: horarios, ...mensajes,
  });
  expect(campaña.mensaje_indicaciones).toBe(mensajes.mensaje_indicaciones);
  expect(campaña.mensaje_pago_ganancia).toBe(mensajes.mensaje_pago_ganancia);
  expect(campaña.mensaje_pago_compra).toBe(mensajes.mensaje_pago_compra);
  expect(JSON.parse(campaña.horarios_entrega)).toEqual(horarios);
  // El backend conserva los valores legados aunque el helper E2E envíe textos PW E2E.
  expect(campaña.mensaje_inicio).toBe("Indicá la cantidad que querés comprar.");
  expect(campaña.mensaje_aprobado).toBe("Pago aprobado. Te enviamos el comprobante.");
  const cambios = await ok(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    id_campania: campaña.id_campania, nombre: campaña.nombre,
    id_producto_principal: producto.id_producto, fecha_inicio: today(), fecha_fin: today(),
    fecha_entrega: tomorrow(), cantidad_minima_persona: 0,
    horarios_entrega: [...horarios].reverse(),
    mensaje_pago_compra: "{venta}: {producto} ({precio_unitario}), retiralo el {fecha_entrega}, {horarios_entrega}.",
  } });
  expect(JSON.parse(cambios.item.horarios_entrega)).toEqual(horarios);
  expect(cambios.item.mensaje_pago_compra).toContain("{precio_unitario}");
  expect(cambios.item.mensaje_inicio).toBe(campaña.mensaje_inicio);
  expect(cambios.item.mensaje_aprobado).toBe(campaña.mensaje_aprobado);
  // Los avisos PDF son opcionales: cadena vacía debe sobrevivir guardar y consultar.
  const sinAvisos = await ok(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    id_campania: campaña.id_campania, nombre: campaña.nombre,
    id_producto_principal: producto.id_producto, fecha_inicio: today(), fecha_fin: today(),
    fecha_entrega: tomorrow(), cantidad_minima_persona: 0,
    mensaje_pago_ganancia: "", mensaje_pago_compra: "",
  } });
  expect(sinAvisos.item.mensaje_pago_ganancia).toBe("");
  expect(sinAvisos.item.mensaje_pago_compra).toBe("");
  const consultada = await ok(request, "ventas_campanias", { token: t });
  const recargada = consultada.items.find((item) => String(item.id_campania) === String(campaña.id_campania));
  expect(recargada.mensaje_pago_ganancia).toBe("");
  expect(recargada.mensaje_pago_compra).toBe("");
});

test("campaña: rechaza rangos superpuestos y variables desconocidas", async ({ request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Requiere entorno E2E aislado autorizado.");
  const t = token(), marker = suffix();
  const producto = await createSalesProduct(request, t, marker);
  const base = { nombre: `PW E2E VTA CAMP ${marker}`, id_producto_principal: producto.id_producto,
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(), activo: false, visible_menu: false };
  const badTime = await apiFetch(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    ...base, horarios_entrega: [{ desde: "09:00", hasta: "11:30" }, { desde: "11:00", hasta: "12:00" }],
  } });
  expect(badTime.status).toBe(422);
  const badToken = await apiFetch(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    ...base, mensaje_pago_compra: "Retirá {contrasena_admin}",
  } });
  expect(badToken.status).toBe(422);
});

test("una campaña con ventas deja editar entrega y textos, pero mantiene bloqueado su objetivo", async ({ request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Requiere entorno E2E aislado autorizado.");
  const { argentinaDate, testDni } = require("./helpers/data.helper");
  const t = token(), marker = suffix();
  const producto = await createSalesProduct(request, t, marker);
  const campaña = await createSalesCampaign(request, t, producto, marker, {
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(),
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000, ganancia_total_sin_ventas: 9000,
    horarios_entrega: horarios, ...mensajes,
  });
  const medios = await ok(request, "ventas_catalogos", { token: t });
  const medio = medios.medios_pago?.[0]?.id_medio_pago;
  expect(medio).toBeTruthy();
  await ok(request, "ventas_orden_guardar", { token: t, method: "POST", data: {
    id_campania: campaña.id_campania, fecha_venta: today(), estado: "aprobada",
    dni: testDni(), nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
    id_medio_pago: medio,
    items: [{ id_producto: producto.id_producto, producto_nombre: producto.nombre,
      cantidad: 1, tipo_precio: "anticipada", precio_unitario: 100 }],
  } });
  const cambio = {
    id_campania: campaña.id_campania, nombre: campaña.nombre,
    id_producto_principal: producto.id_producto, fecha_inicio: today(), fecha_fin: today(),
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000, ganancia_total_sin_ventas: 9000,
    fecha_entrega: argentinaDate(2), horarios_entrega: [{ desde: "16:00", hasta: "19:00" }],
    mensaje_pago_compra: "Entrega {fecha_entrega} {horarios_entrega}",
  };
  const editado = await ok(request, "ventas_campania_guardar", { token: t, method: "POST", data: cambio });
  expect(editado.item.fecha_entrega).toBe(argentinaDate(2));
  expect(JSON.parse(editado.item.horarios_entrega)).toEqual([{ desde: "16:00", hasta: "19:00" }]);
  const invalido = await apiFetch(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    ...cambio, cantidad_minima_persona: 4,
  } });
  expect(invalido.status).toBe(409);
  expect(invalido.body.codigo).toBe("VENTA_CAMPANIA_REGLA_HISTORICA");
});
