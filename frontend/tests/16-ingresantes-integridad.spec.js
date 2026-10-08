const { test, expect } = require("./helpers/playwright.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createIncoming, createStudent } = require("./helpers/entities.helper");
const { suffix, testDni, today, tomorrow, currentYear, currentMonth } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Ingresantes - integración y trazabilidad", () => {
  test("pantalla expone sólo Todos, Pendientes, Cancelados e Ingresados", async ({ page }) => {
    await authenticatePage(page);
    await page.goto("/alumnos/ingresantes");
    await expect(page).toHaveURL(/\/alumnos\/ingresantes$/);
    await expect(page.getByText("Ingresantes", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Pendientes", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Cancelados", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Ingresados", { exact: true }).first()).toBeVisible();
    // La acción principal cambió de etiqueta en la UI. Sin filas seleccionadas
    // debe existir, pero permanecer inhabilitada para evitar conversiones.
    const convertAction = page.getByRole("button", { name: /^Pasar a alumnos$/i });
    await expect(page.getByRole("tablist", { name: "Situación" }).getByRole("tab")).toHaveCount(4);
    await expect(convertAction).toBeVisible();
    await expect(convertAction).toBeDisabled();
  });

  test("alta, filtros, cancelación y reapertura mantienen la preinscripción", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const incoming = await createIncoming(request, t, {
      marker,
      cicloLectivo: currentYear(),
      matriculaPagada: true,
      montoMatricula: 2345.67,
    });
    expect(incoming.id_ingresante).toBeTruthy();
    expect(incoming.estado).toBe("PENDIENTE");

    const pending = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear(), estado: "PENDIENTE", buscar: incoming.num_documento },
    });
    expect((pending.items || []).some((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante))).toBeTruthy();

    await ok(request, "ingresantes_estado", {
      token: t,
      method: "POST",
      data: { id: incoming.id_ingresante, estado: "CANCELADO" },
    });
    const cancelled = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear(), estado: "CANCELADO", buscar: incoming.num_documento },
    });
    expect((cancelled.items || []).some((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante))).toBeTruthy();

    // Cancelar el ingreso no borra un cobro que realmente ocurrió.
    const accounting = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: {
        anio: currentYear(),
        mes: currentMonth(),
        periodo: 14,
        buscar: incoming.num_documento,
      },
    });
    const accountingRow = (accounting.items || []).find((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante));
    expect(accountingRow).toBeTruthy();
    expect(accountingRow.es_ingresante).toBe(true);
    expect(Number(accountingRow.monto)).toBeCloseTo(2345.67, 2);

    await ok(request, "ingresantes_estado", {
      token: t,
      method: "POST",
      data: { id: incoming.id_ingresante, estado: "PENDIENTE" },
    });
    const reopened = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear(), estado: "PENDIENTE", buscar: incoming.num_documento },
    });
    expect((reopened.items || []).some((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante))).toBeTruthy();
  });

  test("DNI+ciclo no se duplica y una matrícula cobrada queda inmutable", async ({ request }) => {
    const t = token();
    const dni = testDni();
    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      dni,
      cicloLectivo: currentYear(),
      matriculaPagada: true,
      montoMatricula: 3456.78,
    });

    const duplicate = await apiFetch(request, "ingresantes_guardar", {
      token: t,
      method: "POST",
      data: {
        apellido: `PW E2E INGRESANTE ${suffix()}`,
        nombre: "DUPLICADO",
        num_documento: dni,
        id_anio_destino: 1,
        ciclo_lectivo: currentYear(),
        fecha_inscripcion: today(),
        matricula_pagada: 0,
        observaciones: "PW E2E DUPLICADO",
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.codigo).toBe("INGRESANTE_DUPLICADO");

    const immutable = await apiFetch(request, "ingresantes_guardar", {
      token: t,
      method: "POST",
      data: {
        id_ingresante: incoming.id_ingresante,
        apellido: incoming.apellido,
        nombre: incoming.nombre,
        num_documento: incoming.num_documento,
        id_anio_destino: incoming.id_anio_destino,
        ciclo_lectivo: incoming.ciclo_lectivo,
        fecha_inscripcion: incoming.fecha_inscripcion,
        matricula_pagada: 1,
        monto_matricula: 9999.99,
        id_medio_pago: incoming.id_medio_pago,
        fecha_pago_matricula: incoming.fecha_pago_matricula,
        observaciones: incoming.observaciones || "PW E2E",
      },
    });
    expect(immutable.status).toBe(409);
    expect(immutable.body.codigo).toBe("MATRICULA_INGRESANTE_INMUTABLE");
  });

  test("rechaza fechas futuras de inscripción y de pago de matrícula", async ({ request }) => {
    const t = token();
    const catalog = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear(), pagina: 1, por_pagina: 1 },
    });
    const medio = catalog.catalogos?.medios_pago?.[0]?.id_medio_pago;
    const amount = Number(catalog.catalogos?.monto_matricula_actual || 25000);

    const futureRegistration = await apiFetch(request, "ingresantes_guardar", {
      token: t,
      method: "POST",
      data: {
        apellido: `PW E2E INGRESANTE ${suffix()}`,
        nombre: "FUTURO",
        num_documento: testDni(),
        id_anio_destino: 1,
        ciclo_lectivo: currentYear(),
        fecha_inscripcion: tomorrow(),
        matricula_pagada: 0,
        observaciones: "PW E2E",
      },
    });
    expect(futureRegistration.status).toBe(422);

    const futurePayment = await apiFetch(request, "ingresantes_guardar", {
      token: t,
      method: "POST",
      data: {
        apellido: `PW E2E INGRESANTE ${suffix()}`,
        nombre: "FUTURO PAGO",
        num_documento: testDni(),
        id_anio_destino: 2,
        ciclo_lectivo: currentYear(),
        fecha_inscripcion: today(),
        matricula_pagada: 1,
        monto_matricula: amount,
        id_medio_pago: medio,
        fecha_pago_matricula: tomorrow(),
        observaciones: "PW E2E",
      },
    });
    expect(futurePayment.status).toBe(422);
  });

  test("matrícula del ingresante entra hoy en Contable/Dashboard y al convertir no se duplica", async ({ request }) => {
    const t = token();
    const amount = 4321.23;
    const beforeDashboard = await ok(request, "dashboard_resumen", { token: t });
    const beforeIncome = Number(beforeDashboard.resumen?.contable?.ingresos_cuotas_mes || 0);
    const beforeCollections = Number(beforeDashboard.resumen?.cuotas?.cobros_registrados_mes || 0);

    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      cicloLectivo: currentYear(),
      idAnioDestino: 1,
      matriculaPagada: true,
      montoMatricula: amount,
      fechaPagoMatricula: today(),
    });

    const beforeConversion = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: {
        anio: currentYear(),
        mes: currentMonth(),
        periodo: 14,
        buscar: incoming.num_documento,
      },
    });
    expect(beforeConversion.items).toHaveLength(1);
    expect(beforeConversion.items[0].es_ingresante).toBe(true);
    expect(Number(beforeConversion.items[0].monto)).toBeCloseTo(amount, 2);

    const withIncomingDashboard = await ok(request, "dashboard_resumen", { token: t });
    expect(Number(withIncomingDashboard.resumen?.contable?.ingresos_cuotas_mes || 0) - beforeIncome).toBeCloseTo(amount, 2);
    expect(Number(withIncomingDashboard.resumen?.cuotas?.cobros_registrados_mes || 0)).toBe(beforeCollections + 1);

    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(converted.procesados).toBe(1);
    expect(converted.matriculas_migradas + converted.matriculas_existentes).toBe(1);

    const afterConversion = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: {
        anio: currentYear(),
        mes: currentMonth(),
        periodo: 14,
        buscar: incoming.num_documento,
      },
    });
    expect(afterConversion.items).toHaveLength(1);
    expect(afterConversion.items[0].es_ingresante).toBe(false);
    expect(afterConversion.items[0].id_alumno).toBeTruthy();
    expect(Number(afterConversion.items[0].monto)).toBeCloseTo(amount, 2);

    const afterDashboard = await ok(request, "dashboard_resumen", { token: t });
    expect(Number(afterDashboard.resumen?.contable?.ingresos_cuotas_mes || 0)).toBeCloseTo(
      Number(withIncomingDashboard.resumen?.contable?.ingresos_cuotas_mes || 0),
      2
    );
    expect(Number(afterDashboard.resumen?.cuotas?.cobros_registrados_mes || 0)).toBe(
      Number(withIncomingDashboard.resumen?.cuotas?.cobros_registrados_mes || 0)
    );

    const history = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear(), estado: "INGRESADO", buscar: incoming.num_documento },
    });
    const row = (history.items || []).find((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante));
    expect(row?.id_alumno_confirmado).toBeTruthy();
  });

  test("un ciclo futuro no puede convertirse prematuramente en alumno", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      cicloLectivo: currentYear() + 1,
      matriculaPagada: false,
    });

    const result = await apiFetch(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear() + 1, ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(result.status).toBe(409);
    expect(result.body.codigo).toBe("CICLO_FUTURO_NO_ACTIVABLE");

    const pending = await ok(request, "ingresantes_listar", {
      token: t,
      query: { ciclo_lectivo: currentYear() + 1, estado: "PENDIENTE", buscar: incoming.num_documento },
    });
    const row = (pending.items || []).find((x) => Number(x.id_ingresante) === Number(incoming.id_ingresante));
    expect(row).toBeTruthy();
    expect(row.id_alumno_confirmado).toBeNull();
  });

  test("si el DNI pertenecía a un alumno eliminado recupera el mismo id_alumno", async ({ request }) => {
    const t = token();
    const dni = testDni();
    const student = await createStudent(request, t, { marker: suffix(), dni });

    await ok(request, "alumnos_eliminar_definitivo", {
      token: t,
      method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E RECUPERACION DESDE INGRESANTES" },
    });

    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      dni,
      cicloLectivo: currentYear(),
      matriculaPagada: false,
    });
    await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });

    const list = await ok(request, "alumnos_listar", {
      token: t,
      query: { buscar: dni, pagina: 1, por_pagina: 20 },
    });
    const recovered = (list.items || []).find((x) => String(x.num_documento) === String(dni));
    expect(recovered).toBeTruthy();
    expect(Number(recovered.id_alumno)).toBe(Number(student.id_alumno));
    expect(recovered.activo).toBe(true);
    expect(recovered.eliminado).toBe(false);
  });
});
