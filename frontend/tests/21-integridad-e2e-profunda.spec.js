const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { createIncoming, createCategory, createStudent, baseCatalogs } = require("./helpers/entities.helper");
const { suffix, currentYear, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Integridad E2E profunda", () => {
  test("Safety reconoce a un alumno originado desde Ingresantes y todos sus movimientos", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      cicloLectivo: currentYear(),
      matriculaPagada: true,
      montoMatricula: 2222.22,
    });
    await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });

    const residues = await ok(request, "e2e_residuos", { token: t });
    expect(Number(residues.datos?.conteos?.ingresantes || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(residues.datos?.conteos?.alumnos || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(residues.datos?.conteos?.pagos || 0)).toBeGreaterThanOrEqual(1);
  });

  test("una cadena alumno + cuota + eliminación sigue siendo reconocida íntegramente como E2E", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000 });
    const student = await createStudent(request, t, { catalogs, category, marker: suffix(), ingreso: "2026-01-01" });
    await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno,
        anio: 2026,
        periodos: [6],
        fecha_pago: today(),
        id_medio_pago: catalogs.medio.id_medio_pago,
        monto_libre: 616.16,
      },
    });
    await ok(request, "alumnos_eliminar_definitivo", {
      token: t,
      method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E SAFETY ELIMINADO" },
    });

    const residues = await ok(request, "e2e_residuos", { token: t });
    expect(Number(residues.datos?.conteos?.alumnos || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(residues.datos?.conteos?.pagos || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(residues.datos?.conteos?.auditoria_marcada || 0)).toBeGreaterThanOrEqual(1);
  });

  test("la huella de datos reales puede calcularse aun con escenarios E2E complejos vivos", async ({ request }) => {
    const t = token();
    const before = await ok(request, "e2e_integridad", { token: t });
    expect(before.datos?.sha256).toMatch(/^[a-f0-9]{64}$/i);

    await createIncoming(request, t, { marker: suffix(), cicloLectivo: currentYear(), matriculaPagada: true });

    const after = await ok(request, "e2e_integridad", { token: t });
    expect(after.datos?.sha256).toBe(before.datos?.sha256);
  });
});
