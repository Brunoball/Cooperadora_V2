/** Cierre de Ventas en Cooperadora V2. No consulta ni modifica el bot WhatsApp. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { today, tomorrow, suffix } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

async function loadMessages() {
  const file = path.join(__dirname, "..", "src", "components", "Ventas", "ventaMensajes.js");
  const code = await fs.promises.readFile(file, "utf8");
  const executable = code.replace(/\bexport const /g, "const ");
  return vm.runInNewContext(`${executable}\n({mensajeRenderizado, actualizarMensajeVisual, MENSAJE_CANTIDAD_DEFECTO, MENSAJE_COMPRA_DEFECTO, precioUnitarioVenta, contarCaracteresMensaje, MENSAJE_MAX_CARACTERES})`);
}
const slots = [{ desde: "09:00", hasta: "12:00" }, { desde: "16:00", hasta: "19:00" }];
const sample = {
  nombre: "VENTA DE PAN DULCE", fecha_entrega: "2026-10-30", horarios_entrega: slots,
  cantidad_minima_persona: 3, ganancia_unidad_faltante: 1500, ganancia_total_sin_ventas: 8000,
};

// Contrato con la consulta de Ventas del bot (solo lectura del contrato: ningún archivo del bot se modifica).
test("Ventas: vista previa muestra el precio que se cobraría cuando precio_anticipada es cero", async () => {
  const u = await loadMessages();
  const cases = [
    [{ nombre: "COMBO", precio_anticipada: 0, precio: 3500 }, 3500],
    [{ nombre: "COMBO", precio_anticipada: "0.00", precio: "4200.00" }, 4200],
    [{ nombre: "COMBO", precio_anticipada: 3000, precio: 4200 }, 3000],
    [{ nombre: "COMBO", precio: 2000 }, 2000],
    [{ nombre: "COMBO", precio_anticipada: 0, precio: 0 }, 0],
  ];
  for (const [product, expected] of cases) {
    expect(u.precioUnitarioVenta(product)).toBe(expected);
    const displayed = u.mensajeRenderizado("Precio: {precio_unitario}", sample, product);
    expect(displayed).toContain(new Intl.NumberFormat("es-AR").format(expected));
  }
  const listing = await fs.promises.readFile(path.join(__dirname, "..", "src", "components", "Ventas", "secciones", "ConfiguracionVentas.jsx"), "utf8");
  const backend = await fs.promises.readFile(path.join(__dirname, "..", "backend", "modules", "ventas", "ventas_configuracion.php"), "utf8");
  expect(listing).toContain("precioUnitarioVenta(row)");
  expect(backend).toContain("p.precio, p.precio_anticipada");
});

test("Ventas: editor de WhatsApp preserva datos dinámicos cuando cambian las frases", async () => {
  const u = await loadMessages();
  const product = { nombre: "PAN DULCE", precio_anticipada: 0, precio: 3500 };
  let tpl = u.MENSAJE_CANTIDAD_DEFECTO;
  const original = u.mensajeRenderizado(tpl, sample, product);
  expect(original).toContain("$\u00a03.500");
  const updated = original.replace("Venta disponible", "Campaña especial").replace("Indicá la cantidad", "Elegí cuántos querés");
  tpl = u.actualizarMensajeVisual(tpl, updated, sample, product);
  expect(u.mensajeRenderizado(tpl, sample, product)).toBe(updated);
  for (const field of ["{venta}", "{producto}", "{precio_unitario}", "{detalle_objetivo}", "{opcion_ganancia}"]) {
    expect(tpl).toContain(field);
  }
  const next = u.mensajeRenderizado(tpl, { ...sample, nombre: "VENTA DE TALITAS", cantidad_minima_persona: 0 },
    { nombre: "TALITAS", precio_anticipada: 12000, precio: 12000 });
  expect(next).toContain("VENTA DE TALITAS");
  expect(next).toContain("12.000");
  expect(next).not.toContain("escribí 0");
  expect(next).not.toContain("PAN DULCE");
});

test("Ventas: al editar textos de comprobantes mantiene fecha, horarios y producto", async () => {
  const u = await loadMessages();
  const product = { nombre: "PAN DULCE", precio_anticipada: 3500 };
  const previous = u.mensajeRenderizado(u.MENSAJE_COMPRA_DEFECTO, sample, product);
  const edit = previous.replace("¡Gracias por tu compra!", "¡Tu compra fue registrada!");
  const template = u.actualizarMensajeVisual(u.MENSAJE_COMPRA_DEFECTO, edit, sample, product);
  expect(template).toContain("{fecha_entrega}");
  expect(template).toContain("{horarios_entrega}");
  expect(template).toContain("{producto}");
  expect(u.mensajeRenderizado(template, { ...sample, fecha_entrega: "2026-11-10" }, product)).toContain("10/11/2026");
  expect(u.mensajeRenderizado(template, { ...sample, horarios_entrega: [{ desde: "08:00", hasta: "09:00" }] }, product)).toContain("de 08:00 a 09:00");
  expect(u.actualizarMensajeVisual(template, "", sample, product)).toBe("");
});

test("Ventas: emojis se cuentan como un carácter y los mensajes largos no se recortan silenciosamente", async () => {
  const u = await loadMessages();
  expect(u.contarCaracteresMensaje("😀".repeat(1200))).toBe(u.MENSAJE_MAX_CARACTERES);
  expect(u.contarCaracteresMensaje("😀".repeat(1201))).toBe(1201);
  const modal = await fs.promises.readFile(path.join(__dirname, "..", "src", "components", "Ventas", "modales", "ConfiguracionVentaModal.jsx"), "utf8");
  expect(modal).toContain("contarCaracteresMensaje(valor) > MENSAJE_MAX_CARACTERES");
  expect(modal).toContain("ventas-message-count--error");
  expect(modal).not.toContain("maxLength={1200}");
});

test("Ventas: fechas históricas, horarios, importes y estados siguen protegidos en backend", async () => {
  const backend = await fs.promises.readFile(path.join(__dirname, "..", "backend", "modules", "ventas", "ventas_configuracion.php"), "utf8");
  expect(backend).toContain("VENTA_CAMPANIA_REGLA_HISTORICA");
  expect(backend).toContain("VENTA_CAMPANIAS_SUPERPUESTAS");
  expect(backend).toContain("VENTA_CAMPANIA_CERRADA");
  expect(backend).toContain("$ranges[$i]['desde'] < $ranges[$i - 1]['hasta']");
  expect(backend).toContain("preg_match_all('/./us', $value)");
  const modal = await fs.promises.readFile(path.join(__dirname, "..", "src", "components", "Ventas", "modales", "ConfiguracionVentaModal.jsx"), "utf8");
  expect(modal).toContain("disabled={hasSales}");
  expect(modal).toContain("Mensaje para la familia");
  expect(modal).toContain("Si paga solo la ganancia (0 productos)");
  expect(modal).toContain("Si compra uno o más productos");
});

test("Ventas API: guarda textos y emojis en una campaña aislada sin cambiarlos en otras", async ({ request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Requiere entorno E2E aislado autorizado.");
  const t = token(), marker = suffix();
  const product = await createSalesProduct(request, t, marker);
  const first = await createSalesCampaign(request, t, product, `${marker}A`, {
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(), horarios_entrega: slots,
    mensaje_indicaciones: "🛒 Venta {venta} {producto} por {precio_unitario}. Escribí la cantidad.",
    mensaje_pago_compra: "🎁 Retirá {producto} el {fecha_entrega} ({horarios_entrega}).",
    mensaje_pago_ganancia: "💚 Gracias por tu colaboración.",
  });
  const second = await createSalesCampaign(request, t, product, `${marker}B`, {
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(), horarios_entrega: slots,
    mensaje_indicaciones: "Otra campaña", mensaje_pago_compra: "Otra entrega",
  });
  const edit = await ok(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    id_campania: first.id_campania, nombre: first.nombre, id_producto_principal: product.id_producto,
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(),
    cantidad_minima_persona: 0, horarios_entrega: [...slots].reverse(),
    mensaje_indicaciones: "🎉".repeat(250) + " {producto}",
    mensaje_pago_compra: "Retirá {producto} el {fecha_entrega}", mensaje_pago_ganancia: "",
  } });
  expect(edit.item.mensaje_indicaciones).toContain("🎉".repeat(250));
  expect(edit.item.mensaje_pago_ganancia).toBe("");
  const list = await ok(request, "ventas_campanias", { token: t });
  const rows = list.items || [];
  const a = rows.find((row) => Number(row.id_campania) === Number(first.id_campania));
  const b = rows.find((row) => Number(row.id_campania) === Number(second.id_campania));
  expect(a.mensaje_pago_compra).toContain("{fecha_entrega}");
  expect(JSON.parse(a.horarios_entrega)).toEqual(slots);
  expect(b.mensaje_indicaciones).toBe("Otra campaña");
  expect(b.mensaje_pago_compra).toBe("Otra entrega");
});

test("Ventas API: rechaza mensajes que superan 1200 Unicode o tienen variables incompletas", async ({ request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Requiere entorno E2E aislado autorizado.");
  const t = token(), marker = suffix();
  const product = await createSalesProduct(request, t, marker);
  const base = { nombre: `PW E2E VTA CAMP ${marker}`, id_producto_principal: product.id_producto,
    fecha_inicio: today(), fecha_fin: today(), fecha_entrega: tomorrow(), activo: false, visible_menu: false,
    horarios_entrega: slots };
  const cases = [
    { mensaje_pago_compra: "👍".repeat(1201) },
    { mensaje_indicaciones: "Hola {producto" },
    { mensaje_pago_compra: "Gracias {contrasena_admin}" },
    { mensaje_pago_compra: "Texto {venta}}" },
    { horarios_entrega: [{ desde: "09:00", hasta: "11:00" }, { desde: "10:59", hasta: "12:00" }] },
  ];
  for (const invalid of cases) {
    const response = await apiFetch(request, "ventas_campania_guardar", {
      token: t, method: "POST", data: { ...base, ...invalid },
    });
    expect(response.status, JSON.stringify(invalid).slice(0, 120)).toBe(422);
  }
  const valid = await ok(request, "ventas_campania_guardar", { token: t, method: "POST", data: {
    ...base, mensaje_indicaciones: "🛒".repeat(1200),
  } });
  expect(Array.from(valid.item.mensaje_indicaciones).length).toBe(1200);
});
