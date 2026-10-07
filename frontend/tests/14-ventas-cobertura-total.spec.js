const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const {
  createSalesProduct,
  createSalesCampaign,
  createStudent,
} = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function salesFixture(request, options = {}) {
  const t = token();
  const marker = suffix();
  const product = await createSalesProduct(request, t, marker, {
    stock: options.stock ?? 20,
    precio_anticipada: 100,
    precio_puerta: 120,
  });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    activo: options.active ?? true,
    visible_menu: options.visible ?? false,
  });
  const catalogs = await ok(request, "ventas_catalogos", { token: t });
  const medio = catalogs.medios_pago?.[0];
  if (!medio) throw new Error("Ventas no tiene medios de pago configurados.");
  return { t, marker, product, campaign, medio };
}

async function createOrder(request, f, overrides = {}) {
  const type = overrides.tipo_precio || "anticipada";
  const isDoor = type === "puerta";
  return ok(request, "ventas_orden_guardar", {
    token: f.t,
    method: "POST",
    data: {
      id_campania: f.campaign.id_campania,
      id_medio_pago: f.medio.id_medio_pago,
      estado: overrides.estado || "aprobada",
      fecha_venta: "2026-10-05",
      dni: isDoor ? "" : (overrides.dni || testDni()),
      nombre_apellido: isDoor ? "" : `PW E2E VTA PERSONA ${f.marker}`,
      referencia_pago: "PW-E2E-REF",
      observacion: `PW E2E VTA ORDEN ${f.marker}${overrides.sufijo || ""}`,
      items: overrides.items || [{
        id_producto: f.product.id_producto,
        producto_nombre: f.product.nombre,
        cantidad: overrides.cantidad ?? 1,
        tipo_precio: type,
        precio_unitario: type === "puerta" ? 120 : 100,
      }],
    },
  });
}

test.describe("Ventas - cobertura extendida", () => {
  test("aliases de lectura y medios de pago conservan compatibilidad", async ({ request }) => {
    const t = token();
    const actions = ["ventas_dashboard", "ventas_campanias", "ventas_productos", "ventas_ordenes", "ventas_medios_pago"];
    for (const action of actions) {
      const body = await ok(request, action, { token: t, query: { pagina: 1, por_pagina: 5 } });
      expect(body).toBeTruthy();
    }
  });

  test("persona manual se guarda y se encuentra por DNI/nombre", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const dni = testDni();
    const name = `PW E2E VTA PERSONA ${marker}`;
    const saved = await ok(request, "ventas_persona_guardar", {
      token: t,
      method: "POST",
      data: { dni, nombre_apellido: name, telefono: "3492999999" },
    });
    expect(saved.id_persona).toBeTruthy();

    const byDni = await ok(request, "ventas_personas_buscar", { token: t, query: { buscar: dni } });
    expect((byDni.items || []).some((x) => Number(x.id_persona) === Number(saved.id_persona))).toBeTruthy();
    const byName = await ok(request, "ventas_personas_buscar", { token: t, query: { buscar: marker } });
    expect((byName.items || []).some((x) => Number(x.id_persona) === Number(saved.id_persona))).toBeTruthy();
  });

  test("orden pendiente pasa a aprobada, recalcula total y expone detalle", async ({ request }) => {
    const f = await salesFixture(request, { stock: 10 });
    const pending = await createOrder(request, f, { estado: "pendiente", cantidad: 2 });
    expect(pending.item.estado).toBe("pendiente");

    const approved = await ok(request, "ventas_orden_guardar", {
      token: f.t,
      method: "POST",
      data: {
        id_orden: pending.item.id_orden,
        id_campania: f.campaign.id_campania,
        id_medio_pago: f.medio.id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        dni: pending.item.dni || testDni(),
        nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
        observacion: `PW E2E VTA ORDEN ${f.marker}-EDIT`,
        total: 999999,
        items: [{
          id_producto: f.product.id_producto,
          producto_nombre: f.product.nombre,
          cantidad: 2,
          tipo_precio: "anticipada",
          precio_unitario: 100,
          subtotal: 999999,
        }],
      },
    });
    expect(approved.item.estado).toBe("aprobada");
    expect(Number(approved.item.total)).toBeCloseTo(200, 2);

    const detail = await ok(request, "ventas_orden_detalle", {
      token: f.t,
      query: { id: approved.item.id_orden },
    });
    expect(Number(detail.item.id_orden)).toBe(Number(approved.item.id_orden));
    expect(detail.item.items).toHaveLength(1);
  });

  test("venta en puerta puede registrarse sin persona", async ({ request }) => {
    const f = await salesFixture(request);
    const sale = await createOrder(request, f, { tipo_precio: "puerta", cantidad: 1 });
    expect(sale.item.id_orden).toBeTruthy();
    expect(Number(sale.item.total)).toBeCloseTo(120, 2);
  });

  test("venta anticipada sin persona es rechazada", async ({ request }) => {
    const f = await salesFixture(request);
    const r = await apiFetch(request, "ventas_orden_guardar", {
      token: f.t,
      method: "POST",
      data: {
        id_campania: f.campaign.id_campania,
        id_medio_pago: f.medio.id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        observacion: `PW E2E VTA ORDEN ${f.marker}-NOPERSONA`,
        items: [{
          id_producto: f.product.id_producto,
          producto_nombre: f.product.nombre,
          cantidad: 1,
          tipo_precio: "anticipada",
          precio_unitario: 100,
        }],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe("VALIDATION_ERROR");
  });

  test("stock insuficiente bloquea venta sin dejar stock negativo", async ({ request }) => {
    const f = await salesFixture(request, { stock: 1 });
    const r = await apiFetch(request, "ventas_orden_guardar", {
      token: f.t,
      method: "POST",
      data: {
        id_campania: f.campaign.id_campania,
        id_medio_pago: f.medio.id_medio_pago,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        dni: testDni(),
        nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
        observacion: `PW E2E VTA ORDEN ${f.marker}-STOCK`,
        items: [{
          id_producto: f.product.id_producto,
          producto_nombre: f.product.nombre,
          cantidad: 2,
          tipo_precio: "anticipada",
          precio_unitario: 100,
        }],
      },
    });
    expect([409, 422]).toContain(r.status);
    expect(r.body.ok).toBe(false);
  });

  test("planillas cursos y docentes responden para campaña E2E", async ({ request }) => {
    const f = await salesFixture(request);
    const student = await createStudent(request, f.t, { marker: suffix() });
    const options = await ok(request, "ventas_planillas_opciones", { token: f.t });
    expect(Array.isArray(options.anios)).toBeTruthy();

    const courses = await ok(request, "ventas_planillas_datos", {
      token: f.t,
      query: { tipo: "cursos", id_campania: f.campaign.id_campania, solo_activos: 1 },
    });
    expect(courses.tipo).toBe("cursos");
    expect(Array.isArray(courses.items)).toBeTruthy();
    expect(courses.items.some((x) => Number(x.id_alumno) === Number(student.id_alumno))).toBeTruthy();

    const teachers = await ok(request, "ventas_planillas_datos", {
      token: f.t,
      query: { tipo: "docentes", id_campania: f.campaign.id_campania, solo_activos: 1 },
    });
    expect(teachers.tipo).toBe("docentes");
    expect(Array.isArray(teachers.items)).toBeTruthy();
  });

  test("menu activo público refleja campaña visible", async ({ request }) => {
    const f = await salesFixture(request, { active: true, visible: true });
    const menu = await ok(request, "ventas_menu_activo");
    expect(menu.mostrar_opcion_menu).toBe(true);
    expect(Number(menu.campania_activa.id_campania)).toBe(Number(f.campaign.id_campania));
  });

  test("campaña sin ventas y producto sin usos se eliminan físicamente", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const product = await createSalesProduct(request, t, marker);
    const campaign = await createSalesCampaign(request, t, product, marker, { activo: false, visible_menu: false });

    const campaignDeleted = await ok(request, "ventas_campania_eliminar", {
      token: t,
      method: "POST",
      data: { id_campania: campaign.id_campania },
    });
    expect(campaignDeleted.modo).toBe("eliminada");

    const productDeleted = await ok(request, "ventas_producto_eliminar", {
      token: t,
      method: "POST",
      data: { id_producto: product.id_producto },
    });
    expect(productDeleted.modo).toBe("eliminado");
  });

  test("campaña/producto usados se archivan y preservan trazabilidad", async ({ request }) => {
    const f = await salesFixture(request);
    const sale = await createOrder(request, f, { cantidad: 1 });
    expect(sale.item.id_orden).toBeTruthy();

    const archivedCampaign = await ok(request, "ventas_campania_eliminar", {
      token: f.t,
      method: "POST",
      data: { id_campania: f.campaign.id_campania },
    });
    expect(archivedCampaign.modo).toBe("archivada");

    const archivedProduct = await ok(request, "ventas_producto_eliminar", {
      token: f.t,
      method: "POST",
      data: { id_producto: f.product.id_producto },
    });
    expect(archivedProduct.modo).toBe("archivado");
  });

  test("producto y campaña E2E soportan edición completa sin tocar catálogos reales", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const product = await createSalesProduct(request, t, marker, { stock: 7 });

    const productEdited = await ok(request, "ventas_producto_guardar", {
      token: t,
      method: "POST",
      data: {
        id_producto: product.id_producto,
        nombre: `${product.nombre} EDIT`.slice(0, 150),
        descripcion: "PW E2E producto editado",
        precio: 150,
        precio_anticipada: 140,
        precio_puerta: 160,
        stock: 9,
        activo: true,
      },
    });
    expect(Number(productEdited.item.stock)).toBe(9);
    expect(Number(productEdited.item.precio_anticipada)).toBeCloseTo(140, 2);

    const campaign = await createSalesCampaign(request, t, productEdited.item, marker, {
      activo: false,
      visible_menu: false,
    });
    const campaignEdited = await ok(request, "ventas_campania_guardar", {
      token: t,
      method: "POST",
      data: {
        id_campania: campaign.id_campania,
        nombre: `${campaign.nombre} EDIT`.slice(0, 150),
        id_producto_principal: product.id_producto,
        activo: false,
        visible_menu: false,
        pregunta_persona: "PW E2E EDIT",
        mensaje_inicio: "PW E2E EDIT",
        mensaje_aprobado: "PW E2E EDIT",
      },
    });
    expect(Number(campaignEdited.item.id_campania)).toBe(Number(campaign.id_campania));
    expect(campaignEdited.item.nombre).toContain("EDIT");
  });

  test("venta aprobada mantiene Stock/Contable al editar referencias históricas inactivas y al anular revierte ambos", async ({ request }) => {
    const f = await salesFixture(request, { stock: 5 });
    const sale = await createOrder(request, f, { cantidad: 1 });
    const orderId = Number(sale.item.id_orden);
    const incomeId = Number(sale.item.id_ingreso);
    const personId = Number(sale.item.id_venta_persona);
    expect(orderId).toBeTruthy();
    expect(incomeId).toBeTruthy();
    expect(personId).toBeTruthy();

    const incomeBefore = await ok(request, "contable_ingresos_listar", {
      token: f.t,
      query: { anio: 2026, mes: 10, pagina: 1, por_pagina: 250 },
    });
    expect((incomeBefore.items || []).some((item) => Number(item.id_ingreso) === incomeId)).toBeTruthy();

    await ok(request, "ventas_campania_estado", {
      token: f.t,
      method: "POST",
      data: { id_campania: f.campaign.id_campania, activo: false },
    });
    await ok(request, "ventas_producto_estado", {
      token: f.t,
      method: "POST",
      data: { id_producto: f.product.id_producto, activo: false },
    });

    const edited = await ok(request, "ventas_orden_guardar", {
      token: f.t,
      method: "POST",
      data: {
        id_orden: orderId,
        id_campania: f.campaign.id_campania,
        id_medio_pago: f.medio.id_medio_pago,
        id_persona: personId,
        estado: "aprobada",
        fecha_venta: "2026-10-05",
        observacion: `PW E2E VTA ORDEN ${f.marker}-HISTORICA`,
        items: [{
          id_producto: f.product.id_producto,
          producto_nombre: f.product.nombre,
          cantidad: 1,
          tipo_precio: "anticipada",
          precio_unitario: 100,
        }],
      },
    });
    expect(Number(edited.item.id_orden)).toBe(orderId);
    expect(Number(edited.item.id_ingreso)).toBe(incomeId);

    const products = await ok(request, "ventas_productos_listar", {
      token: f.t,
      query: { buscar: f.product.nombre, pagina: 1, por_pagina: 20 },
    });
    const product = (products.items || []).find((item) => Number(item.id_producto) === Number(f.product.id_producto));
    expect(Number(product.stock)).toBe(4);

    await ok(request, "ventas_orden_eliminar", {
      token: f.t,
      method: "POST",
      data: { id_orden: orderId, motivo: "PW E2E reversión integral" },
    });

    const productsAfter = await ok(request, "ventas_productos_listar", {
      token: f.t,
      query: { buscar: f.product.nombre, pagina: 1, por_pagina: 20 },
    });
    const restored = (productsAfter.items || []).find((item) => Number(item.id_producto) === Number(f.product.id_producto));
    expect(Number(restored.stock)).toBe(5);

    const incomeAfter = await ok(request, "contable_ingresos_listar", {
      token: f.t,
      query: { anio: 2026, mes: 10, pagina: 1, por_pagina: 250 },
    });
    expect((incomeAfter.items || []).some((item) => Number(item.id_ingreso) === incomeId)).toBe(false);
  });

});
