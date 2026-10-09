const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createCategory, createSiblingRule } = require("./helpers/entities.helper");
const { suffix, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Categorías y Configuración - cobertura extendida", () => {
  test("categoría: obtener, historial y eliminación definitiva sin usos", async ({ request }) => {
    const t = token();
    const category = await createCategory(request, t, suffix());
    const detail = await ok(request, "categorias_obtener", { token: t, query: { id: category.id_cat_monto } });
    expect(Number(detail.item.id_cat_monto)).toBe(Number(category.id_cat_monto));
    const history = await ok(request, "categorias_historial", { token: t, query: { id: category.id_cat_monto } });
    expect(Array.isArray(history.items || history.historial || [])).toBeTruthy();
    const deleted = await ok(request, "categorias_eliminar", {
      token: t,
      method: "POST",
      data: { id: category.id_cat_monto },
    });
    expect(deleted).toBeTruthy();
  });

  test("regla por hermanos: historial y aliases legacy siguen operativos", async ({ request }) => {
    const t = token();
    const category = await createCategory(request, t, suffix());
    const rule = await createSiblingRule(request, t, category, { monto_mensual: 875, monto_anual: 7800 });

    const history = await ok(request, "categorias_hermanos_historial", {
      token: t,
      query: { id: rule.id_cat_hermanos },
    });
    expect(Array.isArray(history.items || history.historial || [])).toBeTruthy();

    const legacyList = await ok(request, "descuentos_familiares_listar", { token: t });
    expect(Array.isArray(legacyList.items || [])).toBeTruthy();

    const legacySaved = await ok(request, "descuentos_familiares_guardar", {
      token: t,
      method: "POST",
      data: {
        id_cat_hermanos: rule.id_cat_hermanos,
        id_cat_monto: category.id_cat_monto,
        cantidad_hermanos: 2,
        monto_mensual: 860,
        monto_anual: 7700,
        vigente_desde: today(),
      },
    });
    expect(Number(legacySaved.item.id_cat_hermanos)).toBe(Number(rule.id_cat_hermanos));

    await ok(request, "descuentos_familiares_eliminar", {
      token: t,
      method: "POST",
      data: { id: rule.id_cat_hermanos },
    });
    await ok(request, "categorias_hermanos_reactivar", {
      token: t,
      method: "POST",
      data: { id: rule.id_cat_hermanos },
    });
  });

  test("configuración cubre alta/edición/eliminación y operaciones no disponibles", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const created = await ok(request, "configuracion_lista_guardar", {
      token: t,
      method: "POST",
      data: { lista: "sexo", nombre: `PW E2E SEX ${marker}`.slice(0, 50) },
    });
    const id = created.item.id;
    expect(id).toBeTruthy();

    const down = await apiFetch(request, "configuracion_lista_baja", {
      token: t,
      method: "POST",
      data: { lista: "sexo", id },
    });
    expect(down.status).toBe(409);
    expect(down.body.codigo).toBe("OPERACION_NO_DISPONIBLE");

    const reactivate = await apiFetch(request, "configuracion_lista_reactivar", {
      token: t,
      method: "POST",
      data: { lista: "sexo", id },
    });
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.codigo).toBe("OPERACION_NO_DISPONIBLE");

    const deleted = await ok(request, "configuracion_lista_eliminar_definitivo", {
      token: t,
      method: "POST",
      data: { lista: "sexo", id },
    });
    expect(Number(deleted.id)).toBe(Number(id));
  });

  test("las cinco listas configurables soportan alta, lectura y eliminación E2E", async ({ request }) => {
    const t = token();
    const marker = suffix().replace(/[^A-Z0-9]/gi, "").slice(-8);
    const definitions = [
      { lista: "contable_categoria", payload: { nombre: `PW E2E CT CAT ${marker}` } },
      { lista: "contable_descripcion", payload: { nombre: `PW E2E CT DESC ${marker}` } },
      { lista: "contable_proveedor", payload: { nombre: `PW E2E CT PROV ${marker}` } },
      { lista: "sexo", payload: { nombre: `PW E2E SEX ${marker}` } },
      { lista: "tipo_documento", payload: { descripcion: `PW E2E DOC ${marker}`, sigla: `PWE2E${marker}`.slice(0, 10) } },
    ];

    const created = [];
    for (const definition of definitions) {
      const body = await ok(request, "configuracion_lista_guardar", {
        token: t,
        method: "POST",
        data: { lista: definition.lista, ...definition.payload },
      });
      const id = body.item?.id || body.id;
      expect(id).toBeTruthy();
      created.push({ lista: definition.lista, id });
    }

    const config = await ok(request, "configuracion_obtener", { token: t });
    for (const item of created) {
      const rows = config.listas?.[item.lista] || [];
      expect(rows.some((row) => Number(row.id) === Number(item.id))).toBeTruthy();
    }

    for (const item of created.reverse()) {
      await ok(request, "configuracion_lista_eliminar", {
        token: t,
        method: "POST",
        data: { lista: item.lista, id: item.id },
      });
    }
  });

});
