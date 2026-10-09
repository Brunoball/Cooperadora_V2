const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Ventas", () => {
  test("venta aprobada descuenta stock, retiro reversible y anulación restaura stock", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const product = await createSalesProduct(request, t, marker, { stock: 20 });
    const campaign = await createSalesCampaign(request, t, product, marker);
    const catalogs = await ok(request, "ventas_catalogos", { token: t });
    const medio = catalogs.medios_pago?.[0];
    expect(medio).toBeTruthy();

    const sale = await ok(request, "ventas_orden_guardar", {
      token: t, method: "POST",
      data: {
        id_campania: campaign.id_campania,
        id_medio_pago: medio.id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        dni: testDni(),
        nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
        observacion: `PW E2E VTA ORDEN ${marker}`,
        items: [{
          id_producto: product.id_producto,
          producto_nombre: product.nombre,
          cantidad: 2,
          tipo_precio: "anticipada",
          precio_unitario: 100,
        }],
      },
    });
    const order = sale.item;
    expect(order.id_orden).toBeTruthy();

    const productsAfterSale = await ok(request, "ventas_productos_listar", {
      token: t, query: { buscar: `PW E2E VTA PROD ${marker}` },
    });
    const current = (productsAfterSale.items || []).find((x) => Number(x.id_producto) === Number(product.id_producto));
    expect(Number(current.stock)).toBe(18);

    await ok(request, "ventas_orden_retiro", {
      token: t, method: "POST", data: { id_orden: order.id_orden, retirado: true },
    });
    await ok(request, "ventas_orden_retiro", {
      token: t, method: "POST", data: { id_orden: order.id_orden, retirado: false },
    });
    await ok(request, "ventas_orden_eliminar", {
      token: t, method: "POST", data: { id_orden: order.id_orden, motivo: "PW E2E" },
    });

    const productsAfterCancel = await ok(request, "ventas_productos_listar", {
      token: t, query: { buscar: `PW E2E VTA PROD ${marker}` },
    });
    const restored = (productsAfterCancel.items || []).find((x) => Number(x.id_producto) === Number(product.id_producto));
    expect(Number(restored.stock)).toBe(20);
  });

  test("backend rechaza campaña inactiva en venta nueva", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const product = await createSalesProduct(request, t, marker);
    const campaign = await createSalesCampaign(request, t, product, marker);
    await ok(request, "ventas_campania_estado", {
      token: t, method: "POST", data: { id_campania: campaign.id_campania, activo: false },
    });
    const catalogs = await ok(request, "ventas_catalogos", { token: t });
    const r = await apiFetch(request, "ventas_orden_guardar", {
      token: t, method: "POST",
      data: {
        id_campania: campaign.id_campania,
        id_medio_pago: catalogs.medios_pago[0].id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        observacion: `PW E2E VTA ORDEN ${marker}`,
        items: [{
          id_producto: product.id_producto,
          producto_nombre: product.nombre,
          cantidad: 1,
          tipo_precio: "puerta",
          precio_unitario: 120,
        }],
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("VENTA_CAMPANIA_INACTIVA");
  });

  test("producto ajeno a la campaña no puede entrar en una venta nueva, aunque esté inactivo", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const principal = await createSalesProduct(request, t, `${marker}-A`);
    const extra = await createSalesProduct(request, t, `${marker}-B`);
    const campaign = await createSalesCampaign(request, t, principal, marker);
    await ok(request, "ventas_producto_estado", {
      token: t, method: "POST", data: { id_producto: extra.id_producto, activo: false },
    });
    const catalogs = await ok(request, "ventas_catalogos", { token: t });
    const r = await apiFetch(request, "ventas_orden_guardar", {
      token: t, method: "POST",
      data: {
        id_campania: campaign.id_campania,
        id_medio_pago: catalogs.medios_pago[0].id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        observacion: `PW E2E VTA ORDEN ${marker}`,
        items: [{
          id_producto: principal.id_producto, producto_nombre: principal.nombre,
          cantidad: 1, tipo_precio: "puerta", precio_unitario: 120,
        }, {
          id_producto: extra.id_producto, producto_nombre: extra.nombre,
          cantidad: 1, tipo_precio: "puerta", precio_unitario: 120,
        }],
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("VENTA_PRODUCTO_CAMPANIA_INVALIDO");
  });
});
