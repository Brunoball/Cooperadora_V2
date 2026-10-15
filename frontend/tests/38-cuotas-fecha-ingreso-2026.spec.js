/**
 * Regresión adicional de Cuotas: ingreso en último día de mes.
 * Complementa la suite 31, que cubre ingreso el 25/04, pagos históricos y libreta.
 */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { baseCatalogs, createStudent } = require("./helpers/entities.helper");
const { suffix, currentYear } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "No se crean alumnos E2E en producción sin autorización explícita.");
});

async function fixture(request, kind, month, day) {
  const t = token(), catalogs = await baseCatalogs(request, t);
  const cfg = await ok(request, "categorias_listar", { token: t });
  const amount = (cfg.items || []).find((row) => String(row.nombre || "").toUpperCase() === kind);
  const category = (catalogs.cuotas.categorias || []).find((row) => String(row.nombre || "").toUpperCase() === kind);
  expect(amount?.id_cat_monto, `Falta categoría de montos ${kind}`).toBeTruthy();
  expect(category?.id_categoria, `Falta categoría de alumnos ${kind}`).toBeTruthy();
  const ingreso = `${currentYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const student = await createStudent(request, t, {
    marker: suffix(), catalogs, ingreso, esCobrador: true,
    category: { id_cat_monto: amount.id_cat_monto, id_categoria: category.id_categoria },
  });
  return { t, student };
}

async function book(request, f) {
  const data = await ok(request, "cuotas_cupones_cobrador", { token: f.t,
    query: { anio: currentYear(), buscar: f.student.num_documento } });
  return (data.items || []).filter((r) => Number(r.id_alumno) === Number(f.student.id_alumno));
}

test("ingreso último día de abril: abril incluido, marzo excluido y diciembre omitido para INTERNO", async ({ request }) => {
  const f = await fixture(request, "INTERNO", 4, 30);
  const months = (await book(request, f)).map((x) => Number(x.id_mes));
  expect(months).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  const [march, april] = await Promise.all([3, 4].map((mes) => ok(request, "cuotas_listar", {
    token: f.t, query: { anio: currentYear(), mes, estado: "DEUDORES", id_alumno: f.student.id_alumno },
  })));
  expect((march.items || []).some((r) => Number(r.id_alumno) === Number(f.student.id_alumno))).toBe(false);
  expect((april.items || []).some((r) => Number(r.id_alumno) === Number(f.student.id_alumno))).toBe(true);
});

test("ingreso último día de septiembre: EXTERNO incluye septiembre a diciembre", async ({ request }) => {
  const f = await fixture(request, "EXTERNO", 9, 30);
  const months = (await book(request, f)).map((x) => Number(x.id_mes));
  expect(months).toEqual([9, 10, 11, 12]);
});
