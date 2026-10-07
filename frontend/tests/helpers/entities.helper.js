const { ok } = require("./api.helper");
const { suffix, testDni, today } = require("./data.helper");

async function configuracion(api, token) {
  return ok(api, "configuracion_obtener", { token });
}

async function baseCatalogs(api, token) {
  const cfg = await configuracion(api, token);
  const tipoDoc = cfg.listas?.tipo_documento?.[0];
  const sexo = cfg.listas?.sexo?.[0] || null;
  const cuotas = await ok(api, "cuotas_catalogos", {
    token,
    query: { anio: 2026, mes: 10 },
  });
  const medio = cuotas.catalogos?.medios_pago?.[0];
  if (!tipoDoc || !medio) throw new Error("Faltan catálogos base (tipo_documento/medio_pago).");
  return { tipoDoc, sexo, cuotas: cuotas.catalogos, medio };
}

async function createCategory(api, token, marker = suffix(), overrides = {}) {
  const name = (overrides.nombre || `PW E2E CAT ${marker}`).slice(0, 20);
  const body = await ok(api, "categorias_guardar", {
    token,
    method: "POST",
    data: {
      nombre: name,
      monto_mensual: overrides.monto_mensual ?? 1000,
      monto_anual: overrides.monto_anual ?? 9000,
      vigente_desde: overrides.vigente_desde || today(),
    },
  });

  const catalogs = await ok(api, "cuotas_catalogos", {
    token,
    query: { anio: 2026, mes: 10 },
  });
  const categoryType = (catalogs.catalogos?.categorias || []).find(
    (item) => String(item.nombre || "").toUpperCase() === name.toUpperCase()
  );
  if (!categoryType?.id_categoria) throw new Error(`No se pudo resolver id_categoria para ${name}.`);

  return { ...body.item, id_categoria: Number(categoryType.id_categoria) };
}

async function createSiblingRule(api, token, category, options = {}) {
  const body = await ok(api, "categorias_hermanos_guardar", {
    token,
    method: "POST",
    data: {
      id_cat_monto: category.id_cat_monto,
      cantidad_hermanos: options.cantidad_hermanos ?? 2,
      monto_mensual: options.monto_mensual ?? 900,
      monto_anual: options.monto_anual ?? 8100,
      vigente_desde: options.vigente_desde || today(),
    },
  });
  return body.item;
}

async function createStudent(api, token, options = {}) {
  const marker = options.marker || suffix();
  const catalogs = options.catalogs || await baseCatalogs(api, token);
  const category = options.category || null;
  const body = await ok(api, "alumnos_guardar", {
    token,
    method: "POST",
    data: {
      apellido: `PW E2E ALUMNO ${marker}`.slice(0, 100),
      nombre: options.nombre || "PRUEBA",
      id_tipo_documento: catalogs.tipoDoc.id,
      num_documento: options.dni || testDni(),
      id_sexo: catalogs.sexo?.id || null,
      domicilio: "DOMICILIO E2E",
      localidad: "SAN FRANCISCO",
      telefono: "3492999999",
      fecha_nacimiento: options.fechaNacimiento || "2012-01-15",
      id_anio: options.idAnio ?? catalogs.cuotas?.anios_lectivos?.[0]?.id_anio ?? null,
      id_division: options.idDivision ?? catalogs.cuotas?.divisiones?.[0]?.id_division ?? null,
      id_cat_monto: category?.id_cat_monto || null,
      id_categoria: category?.id_categoria || null,
      es_cobrador: options.esCobrador ? 1 : 0,
      ingreso: options.ingreso || "2026-03-01",
      observaciones: options.observaciones || "PW E2E",
    },
  });
  return body.item;
}

async function createFamily(api, token, students = [], marker = suffix()) {
  const body = await ok(api, "familias_guardar", {
    token,
    method: "POST",
    data: {
      nombre_familia: `PW E2E FAM ${marker}`.slice(0, 120),
      observaciones: "PW E2E",
      integrantes: students.map((s) => Number(s.id_alumno || s)),
    },
  });
  return body.item;
}

async function createAccountingOption(api, token, type, marker = suffix()) {
  const body = await ok(api, "contable_opcion_guardar", {
    token,
    method: "POST",
    data: { tipo: type, nombre: `PW E2E CT ${type} ${marker}`.slice(0, 115) },
  });
  return body;
}

async function accountingFixture(api, token, marker = suffix()) {
  const provider = await createAccountingOption(api, token, "PROVEEDOR", marker);
  const incomeCategory = await createAccountingOption(api, token, "CATEGORIA_INGRESO", `${marker}-I`);
  const incomeConcept = await createAccountingOption(api, token, "CONCEPTO_INGRESO", `${marker}-I`);
  const expenseCategory = await createAccountingOption(api, token, "CATEGORIA_EGRESO", `${marker}-E`);
  const expenseConcept = await createAccountingOption(api, token, "CONCEPTO_EGRESO", `${marker}-E`);
  const catalogs = await ok(api, "contable_catalogos", { token });
  const medio = catalogs.medios_pago?.[0] || catalogs.catalogos?.medios_pago?.[0];
  if (!medio) throw new Error("No hay medios de pago contables.");
  return {
    provider,
    incomeCategory,
    incomeConcept,
    expenseCategory,
    expenseConcept,
    medioId: medio.id_medio_pago || medio.id,
  };
}

async function createSalesProduct(api, token, marker = suffix(), overrides = {}) {
  const body = await ok(api, "ventas_producto_guardar", {
    token,
    method: "POST",
    data: {
      nombre: `PW E2E VTA PROD ${marker}`.slice(0, 150),
      descripcion: "Producto Playwright Cooperadora",
      precio: 100,
      precio_anticipada: 100,
      precio_puerta: 120,
      stock: 20,
      activo: true,
      ...overrides,
    },
  });
  return body.item;
}

async function createSalesCampaign(api, token, product, marker = suffix(), overrides = {}) {
  const body = await ok(api, "ventas_campania_guardar", {
    token,
    method: "POST",
    data: {
      nombre: `PW E2E VTA CAMP ${marker}`.slice(0, 150),
      id_producto_principal: product.id_producto,
      activo: overrides.activo ?? true,
      visible_menu: overrides.visible_menu ?? false,
      pregunta_persona: "PW E2E",
      mensaje_inicio: "PW E2E",
      mensaje_aprobado: "PW E2E",
      ...overrides,
    },
  });
  return body.item;
}

async function createSalesPerson(api, token, marker = suffix(), overrides = {}) {
  const body = await ok(api, "ventas_persona_guardar", {
    token,
    method: "POST",
    data: {
      dni: overrides.dni || testDni(),
      nombre_apellido: overrides.nombre_apellido || `PW E2E VTA PERSONA ${marker}`,
      telefono: overrides.telefono || "3492999999",
      email: overrides.email || "",
      ...overrides,
    },
  });
  return { id_persona: body.id_persona, ...overrides };
}

module.exports = {
  configuracion,
  baseCatalogs,
  createCategory,
  createSiblingRule,
  createStudent,
  createFamily,
  createAccountingOption,
  accountingFixture,
  createSalesProduct,
  createSalesCampaign,
  createSalesPerson,
};
