"use strict";

const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { suffix, today, currentYear, currentMonth } = require("./helpers/data.helper");
const {
  baseCatalogs, createCategory, createStudent, createFamily,
} = require("./helpers/entities.helper");

const env = loadTestEnv();
const YEAR = currentYear();
const PAYMENT_MONTH = currentMonth();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Crear pagos requiere la ejecución E2E autorizada y su limpieza controlada.");
});

async function fixture(request, { collector = true, monthly = 10000, ingreso = `${YEAR}-03-01` } = {}) {
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), {
    monto_mensual: monthly, monto_anual: monthly * 9,
  });
  const student = await createStudent(request, t, {
    category, catalogs, marker: suffix(), ingreso, esCobrador: collector,
  });
  return { t, catalogs, category, student, medio: catalogs.medio.id_medio_pago };
}

async function registrar(request, f, periods, amounts, overrides = {}) {
  return ok(request, "cuotas_registrar_pago", {
    token: f.t, method: "POST",
    data: {
      id_alumno: f.student.id_alumno, anio: YEAR,
      periodos: periods, fecha_pago: today(),
      id_medio_pago: f.medio,
      montos_por_periodo: amounts,
      ...overrides,
    },
  });
}

async function ingresosDe(request, f, period = null) {
  const data = await ok(request, "contable_ingresos_alumnos", {
    token: f.t,
    query: {
      anio: YEAR, mes: PAYMENT_MONTH, buscar: f.student.num_documento,
      ...(period == null ? {} : { periodo: period }),
      pagina: 1, por_pagina: 100,
    },
  });
  return data.items || [];
}

async function egresosDe(request, f) {
  // El buscador de egresos busca apellido/nombre, no documento.
  const data = await ok(request, "contable_egresos_listar", {
    token: f.t,
    query: { anio: YEAR, mes: PAYMENT_MONTH, buscar: f.student.apellido },
  });
  return data.items || [];
}

function commission(gross) {
  return Math.round(gross * 0.15);
}

async function verificarPago(request, f, payment, gross, expectedCommission) {
  const idPago = Number(payment.id_pago);
  expect(idPago).toBeGreaterThan(0);
  expect(Number(payment.monto_pago_es_bruto), "El nuevo pago SIEMPRE se guarda como bruto").toBe(1);
  expect(Number(payment.monto_pago), "Pagos no debe almacenar el 85%").toBeCloseTo(gross, 2);

  const [incomes, expenses] = await Promise.all([
    ingresosDe(request, f), egresosDe(request, f),
  ]);
  const income = incomes.find(x => Number(x.id_pago) === idPago);
  expect(income, `Pago ${idPago} en Ingresos de alumnos`).toBeTruthy();
  expect(Number(income.monto)).toBeCloseTo(gross, 2);
  expect(Number(income.comision_cobrador)).toBeCloseTo(expectedCommission, 2);
  if (expectedCommission) {
    expect(String(income.etiqueta_cobrador)).toMatch(/COBRADOR\s*[·-]\s*15%/i);
  } else {
    expect(String(income.etiqueta_cobrador || "")).toBe("");
  }

  const linked = expenses.filter(x => Number(x.id_pago_origen) === idPago);
  expect(linked, `Una comisión automática, sin duplicados, para pago ${idPago}`)
    .toHaveLength(expectedCommission ? 1 : 0);
  if (expectedCommission) {
    expect(Number(linked[0].importe)).toBeCloseTo(expectedCommission, 2);
    expect(linked[0].automatico).toBe(true);
    expect(String(linked[0].concepto)).toMatch(/COBRADOR/i);
  }
  const receipt = await ok(request, "cuotas_comprobante", {
    token: f.t,
    query: { id_alumno: payment.id_alumno, id_pago: idPago },
  });
  const comprobante = receipt.comprobante;
  expect(Number(comprobante.monto_total)).toBeCloseTo(gross, 2);
  expect(Number(comprobante.monto_neto_cooperadora)).toBeCloseTo(gross - expectedCommission, 2);
  expect(Number(comprobante.monto_comision_cobrador)).toBeCloseTo(expectedCommission, 2);
  return linked[0] || null;
}

test("Pago $10.000: bruto completo, egreso $1.500, etiqueta y recibo correctos", async ({ request }) => {
  const f = await fixture(request);
  const before = await ok(request, "contable_resumen", {
    token: f.t, query: { anio: YEAR, mes: PAYMENT_MONTH, medio: f.medio },
  });
  const registered = await registrar(request, f, [10], { 10: 10000 });
  expect(registered.insertados_total).toBe(1);
  expect(Number(registered.monto_bruto_original)).toBe(10000);
  expect(Number(registered.monto_comision_cobrador)).toBe(1500);
  expect(Number(registered.monto_neto_cooperadora)).toBe(8500);
  const payment = registered.items[0];
  const expense = await verificarPago(request, f, payment, 10000, 1500);

  // El sistema no permite borrar manualmente el egreso originado por Cuotas.
  const denied = await apiFetch(request, "contable_egreso_eliminar", {
    token: f.t, method: "POST", data: { id_egreso: expense.id_egreso },
  });
  expect(denied.status).toBe(409);
  expect(denied.body.codigo).toBe("EGRESO_AUTOMATICO");

  const after = await ok(request, "contable_resumen", {
    token: f.t, query: { anio: YEAR, mes: PAYMENT_MONTH, medio: f.medio },
  });
  const oldMonth = before.resumen.meses.find(m => Number(m.mes) === PAYMENT_MONTH);
  const newMonth = after.resumen.meses.find(m => Number(m.mes) === PAYMENT_MONTH);
  expect(Number(newMonth.ingresos) - Number(oldMonth.ingresos)).toBeCloseTo(10000, 2);
  expect(Number(newMonth.egresos) - Number(oldMonth.egresos)).toBeCloseTo(1500, 2);
  expect(Number(newMonth.resultado) - Number(oldMonth.resultado)).toBeCloseTo(8500, 2);

  // La eliminación de la cuota revierte el ingreso y la comisión en la misma operación.
  await ok(request, "cuotas_eliminar_pago", {
    token: f.t, method: "POST",
    data: { id_pago: payment.id_pago, id_alumno: f.student.id_alumno },
  });
  const [incomes, expenses] = await Promise.all([ingresosDe(request, f), egresosDe(request, f)]);
  expect(incomes.some(x => Number(x.id_pago) === Number(payment.id_pago))).toBe(false);
  expect(expenses.some(x => Number(x.id_pago_origen) === Number(payment.id_pago))).toBe(false);
  const restored = await ok(request, "contable_resumen", {
    token: f.t, query: { anio: YEAR, mes: PAYMENT_MONTH, medio: f.medio },
  });
  const restoredMonth = restored.resumen.meses.find(m => Number(m.mes) === PAYMENT_MONTH);
  expect(Number(restoredMonth.ingresos)).toBeCloseTo(Number(oldMonth.ingresos), 2);
  expect(Number(restoredMonth.egresos)).toBeCloseTo(Number(oldMonth.egresos), 2);
});

test("Comisión $10, $30 y $8.000 en 3 meses: redondea una vez y nunca descuenta de monto_pago", async ({ request }) => {
  test.setTimeout(100_000);
  const f = await fixture(request);
  const paid = await registrar(request, f, [8, 9, 10], { 8: 10, 9: 30, 10: 8000 });
  expect(paid.insertados_total).toBe(3);
  expect(Number(paid.monto_bruto_original)).toBe(8040);
  expect(Number(paid.monto_comision_cobrador)).toBe(1207);
  expect(Number(paid.monto_neto_cooperadora)).toBe(6833);
  for (const payment of paid.items) {
    const gross = Number(payment.monto_pago);
    await verificarPago(request, f, payment, gross, commission(gross));
  }
  // Cada período debe figurar como PAGADO con el mismo monto BRUTO.
  for (const payment of paid.items) {
    const list = await ok(request, "cuotas_listar", {
      token: f.t,
      query: { anio: YEAR, mes: payment.id_mes, estado: "PAGADOS", id_alumno: f.student.id_alumno },
    });
    const row = list.items.find(x => Number(x.id_pago) === Number(payment.id_pago));
    expect(Number(row.monto)).toBeCloseTo(Number(payment.monto_pago), 2);
  }
});

test("Alumnos sin cobrador y condonados: nunca generan egreso del 15%", async ({ request }) => {
  const normal = await fixture(request, { collector: false });
  const registered = await registrar(request, normal, [10], { 10: 10000 });
  expect(Number(registered.monto_comision_cobrador)).toBe(0);
  await verificarPago(request, normal, registered.items[0], 10000, 0);

  const collector = await fixture(request, { collector: true });
  const forgiven = await ok(request, "cuotas_condonar_pago", {
    token: collector.t, method: "POST",
    data: { id_alumno: collector.student.id_alumno, anio: YEAR, periodos: [9], fecha_pago: today() },
  });
  expect(forgiven.insertados_total).toBe(1);
  expect(Number(forgiven.items[0].monto_pago)).toBe(0);
  expect(Number(forgiven.monto_comision_cobrador)).toBe(0);
  const expenses = await egresosDe(request, collector);
  expect(expenses.filter(x => Number(x.id_pago_origen) === Number(forgiven.items[0].id_pago))).toHaveLength(0);
});

test("Familia mixta: solo integrantes con cobrador generan comisión", async ({ request }) => {
  const f = await fixture(request, { collector: true });
  const sibling = await createStudent(request, f.t, {
    category: f.category, catalogs: f.catalogs, marker: suffix(),
    ingreso: `${YEAR}-03-01`, esCobrador: false,
  });
  await createFamily(request, f.t, [f.student, sibling], suffix());
  const paid = await registrar(request, f, [10], { 10: 10000 }, { aplicar_familia: true });
  expect(paid.insertados_total).toBe(2);
  expect(Number(paid.monto_bruto_original)).toBe(20000);
  expect(Number(paid.monto_comision_cobrador)).toBe(1500);
  expect(Number(paid.monto_neto_cooperadora)).toBe(18500);
  const collectorPaid = paid.items.find(x => Number(x.id_alumno) === Number(f.student.id_alumno));
  const siblingPaid = paid.items.find(x => Number(x.id_alumno) === Number(sibling.id_alumno));
  expect(collectorPaid).toBeTruthy();
  expect(siblingPaid).toBeTruthy();
  await verificarPago(request, f, collectorPaid, 10000, 1500);
  await verificarPago(request, { ...f, student: sibling }, siblingPaid, 10000, 0);
});
