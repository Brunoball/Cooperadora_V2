/**
 * Docentes (Cooperadora V2): contrato, CRUD, aislamiento E2E, permisos y planillas.
 * Solo se modifican docentes marcados PW E2E DOCENTE. Cleanup e integridad
 * se ejecutan globalmente en auth.setup/auth.teardown.
 */
const { test, expect } = require('./helpers/playwright.helper');
const { authenticatePage, token } = require('./helpers/auth.helper');
const { apiFetch, ok, login } = require('./helpers/api.helper');
const { suffix, testDni } = require('./helpers/data.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();
const PREFIX = 'PW E2E DOCENTE ';
const listTeachers = async (request, t = token()) => {
  const result = await ok(request, 'configuracion_obtener', { token: t });
  expect(Array.isArray(result.listas?.docentes)).toBe(true);
  return result.listas.docentes;
};
const saveTeacher = (request, data, t = token()) => ok(request, 'configuracion_lista_guardar', {
  token: t, method: 'POST', data: { lista: 'docentes', ...data },
});
const deleteTeacher = (request, id, t = token()) => ok(request, 'configuracion_lista_eliminar', {
  token: t, method: 'POST', data: { lista: 'docentes', id },
});
const teacherName = (marker, ending = '') => `${PREFIX}${marker}${ending}`.slice(0, 100);

// Estas pruebas son de lectura: se pueden ejecutar incluso cuando Hostinger
// permanece en PW_ALLOW_REMOTE_WRITES=false.
test('Docentes: Configuración devuelve el catálogo y sus campos correctos', async ({ request }) => {
  const rows = await listTeachers(request);
  for (const row of rows) {
    expect(Number(row.id)).toBeGreaterThan(0);
    expect(typeof row.nombre).toBe('string');
    expect([0, 1]).toContain(Number(row.activo));
    expect(row).toHaveProperty('dni');
    expect(row).toHaveProperty('email');
    expect(row).toHaveProperty('motivo');
  }
});

test('Docentes: pestaña, buscador, columnas y formulario sin tarjetas antiguas', async ({ page }) => {
  await authenticatePage(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/configuracion/catalogos?lista=docentes');
  const tab = page.getByRole('tab', { name: 'Docentes' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('table', { name: 'Docentes' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'DNI' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
  await expect(page.locator('.config-catalogStats')).toHaveCount(0);
  await expect(page.getByText(/Mostrando \d+ de \d+ docentes/)).toBeVisible();
  // En producción con acceso solo lectura no se fuerza un modal de escritura.
  if (env.isLocal || env.allowRemoteWrites) {
    await page.getByRole('button', { name: /Nuevo docente/i }).click();
    const dialog = page.getByRole('dialog', { name: /Agregar docente/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.config-catalogField input')).toHaveCount(3);
    await expect(dialog.getByText('Docente activo')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test.describe('Docentes: operaciones E2E aisladas', () => {
  test.beforeEach(() => {
    test.skip(!env.isLocal && !env.allowRemoteWrites, 'Escrituras remotas deshabilitadas en .env.test.');
  });

  test('API: alta, búsqueda, edición, inactivación, reactivación y eliminación', async ({ request }) => {
    const marker = suffix();
    const name = teacherName(marker);
    const dni = testDni();
    const before = await listTeachers(request);
    const optionsBefore = await ok(request, 'ventas_planillas_opciones', { token: token() });
    const activeBefore = Number(optionsBefore.total_docentes);
    const created = await saveTeacher(request, { nombre: name, dni, email: 'E2E.Docente@Example.com', activo: true });
    const id = Number(created.item?.id);
    expect(id).toBeGreaterThan(0);
    expect(created.item.nombre).toBe(name);
    expect(created.item.dni).toBe(dni);
    expect(created.item.email).toBe('e2e.docente@example.com');
    expect(Number(created.item.activo)).toBe(1);
    expect((await listTeachers(request)).length).toBe(before.length + 1);
    expect(Number((await ok(request, 'ventas_planillas_opciones', { token: token() })).total_docentes))
      .toBe(activeBefore + 1);

    const editedName = teacherName(marker, ' EDITADO');
    const edited = await saveTeacher(request, {
      id, nombre: editedName, dni, email: 'nuevo.e2e@example.com', activo: false, motivo: 'PW E2E DESCANSO',
    });
    expect(edited.creado).toBe(false);
    expect(Number(edited.item.activo)).toBe(0);
    expect(edited.item.motivo).toBe('PW E2E DESCANSO');
    const found = (await listTeachers(request)).find((row) => Number(row.id) === id);
    expect(found.nombre).toBe(editedName);
    expect(found.email).toBe('nuevo.e2e@example.com');
    expect(Number((await ok(request, 'ventas_planillas_opciones', { token: token() })).total_docentes))
      .toBe(activeBefore);

    const restored = await saveTeacher(request, {
      id, nombre: editedName, dni, email: 'nuevo.e2e@example.com', activo: true, motivo: '',
    });
    expect(Number(restored.item.activo)).toBe(1);
    expect(restored.item.motivo).toBeNull();
    expect(Number((await ok(request, 'ventas_planillas_opciones', { token: token() })).total_docentes))
      .toBe(activeBefore + 1);
    const deleted = await deleteTeacher(request, id);
    expect(Number(deleted.id)).toBe(id);
    expect((await listTeachers(request)).some((row) => Number(row.id) === id)).toBe(false);
    expect(Number((await ok(request, 'ventas_planillas_opciones', { token: token() })).total_docentes))
      .toBe(activeBefore);
  });

  test('API: planillas de docentes incluyen activos y excluyen inactivos', async ({ request }) => {
    const marker = suffix();
    const created = await saveTeacher(request, {
      nombre: teacherName(marker), dni: testDni(), email: '', activo: true,
    });
    const id = Number(created.item.id);
    const opts = await ok(request, 'ventas_planillas_opciones', { token: token() });
    const campaign = opts.campanias?.[0];
    // Con una base recién instalada sin campañas, el CRUD y el total ya se
    // probaron; generar una planilla exige una campaña real o E2E existente.
    if (!campaign) {
      test.info().annotations.push({ type: 'aviso', description: 'No hay campaña disponible para comprobar datosPlanillas.' });
      return;
    }
    const data = { token: token(), query: { tipo: 'docentes', id_campania: campaign.id_campania } };
    const visible = await ok(request, 'ventas_planillas_datos', data);
    expect(visible.tipo).toBe('docentes');
    expect(visible.items.some((row) => Number(row.id_docente) === id)).toBe(true);
    await saveTeacher(request, {
      id, nombre: created.item.nombre, dni: created.item.dni,
      email: '', activo: false, motivo: 'PW E2E NO VIGENTE',
    });
    const hidden = await ok(request, 'ventas_planillas_datos', data);
    expect(hidden.items.some((row) => Number(row.id_docente) === id)).toBe(false);
  });

  test('API: campos inválidos, duplicados y acciones de baja lógica tienen rechazo controlado', async ({ request }) => {
    const marker = suffix();
    for (const payload of [
      { nombre: teacherName(marker, ' DNI INVALIDO'), dni: '123', email: '' },
      { nombre: teacherName(marker, ' EMAIL INVALIDO'), dni: testDni(), email: 'correo-invalido' },
      { nombre: teacherName(marker, ' ESTADO INVALIDO'), dni: testDni(), email: '', activo: 'cualquier-cosa' },
    ]) {
      const response = await apiFetch(request, 'configuracion_lista_guardar', {
        token: token(), method: 'POST', data: { lista: 'docentes', ...payload },
      });
      expect(response.status).toBe(422);
      expect(response.body.codigo).toBe('VALIDATION_ERROR');
    }
    const created = await saveTeacher(request, { nombre: teacherName(marker), dni: testDni() });
    const duplicate = await apiFetch(request, 'configuracion_lista_guardar', {
      token: token(), method: 'POST', data: { lista: 'docentes', nombre: created.item.nombre, dni: testDni() },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.codigo).toBe('OPCION_DUPLICADA');
    for (const action of ['configuracion_lista_baja', 'configuracion_lista_reactivar']) {
      const result = await apiFetch(request, action, {
        token: token(), method: 'POST', data: { lista: 'docentes', id: created.item.id },
      });
      expect(result.status).toBe(409);
      expect(result.body.codigo).toBe('OPERACION_NO_DISPONIBLE');
    }
  });

  test('Guard E2E: rechaza crear sin prefijo, desmarcar y editar/eliminar docentes reales', async ({ request }) => {
    const marker = suffix();
    const t = token();
    const rejected = await apiFetch(request, 'configuracion_lista_guardar', {
      token: t, method: 'POST', data: { lista: 'docentes', nombre: `DOCENTE REAL SIMULADO ${marker}`, dni: testDni() },
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.codigo).toBe('E2E_SCOPE_BLOCKED');

    const created = await saveTeacher(request, { nombre: teacherName(marker), dni: testDni() });
    const attemptedRename = await apiFetch(request, 'configuracion_lista_guardar', {
      token: t, method: 'POST', data: { lista: 'docentes', id: created.item.id, nombre: 'NOMBRE SIN MARCADOR', dni: created.item.dni },
    });
    expect(attemptedRename.status).toBe(409);
    expect(attemptedRename.body.codigo).toBe('E2E_SCOPE_BLOCKED');

    const real = (await listTeachers(request)).find((row) => !row.nombre.toUpperCase().startsWith(PREFIX));
    if (!real) {
      test.info().annotations.push({ type: 'aviso', description: 'No hay docentes reales para validar el bloqueo por ID.' });
      return;
    }
    for (const action of ['configuracion_lista_eliminar', 'configuracion_lista_eliminar_definitivo']) {
      const response = await apiFetch(request, action, {
        token: t, method: 'POST', data: { lista: 'docentes', id: real.id },
      });
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('E2E_SCOPE_BLOCKED');
    }
    const response = await apiFetch(request, 'configuracion_lista_guardar', {
      token: t, method: 'POST',
      data: { lista: 'docentes', id: real.id, nombre: teacherName(marker, ' ATAQUE'), dni: real.dni || '' },
    });
    expect(response.status).toBe(409);
    expect(response.body.codigo).toBe('E2E_SCOPE_BLOCKED');
  });

  test('Seguridad: usuario vista no puede crear ni eliminar docentes', async ({ request }) => {
    const marker = suffix().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const username = `pw_e2e_doc_vista_${marker}`.slice(0, 60);
    const password = `VistaDoc!${marker}Aa1`;
    await ok(request, 'usuarios_guardar', {
      token: token(), method: 'POST', data: {
        nombre_completo: `PW E2E Vista Docentes ${marker}`.slice(0, 120),
        usuario: username, rol: 'vista', contrasena: password, confirmar_contrasena: password,
      },
    });
    const session = await login(request, username, password, 'PW-COOP-E2E-DOC-VISTA');
    const teacher = await saveTeacher(request, { nombre: teacherName(suffix()), dni: testDni() });
    for (const action of ['configuracion_lista_guardar', 'configuracion_lista_eliminar']) {
      const result = await apiFetch(request, action, {
        token: session.token, method: 'POST', data: {
          lista: 'docentes', id: teacher.item.id, nombre: teacher.item.nombre, dni: teacher.item.dni,
        },
      });
      expect(result.status).toBe(403);
    }
  });

  test('Interfaz: crear, buscar, editar estado y eliminar un docente de prueba', async ({ page, request }) => {
    const marker = suffix();
    const name = teacherName(marker);
    const nameEdited = teacherName(marker, ' MODIFICADO');
    const dni = testDni();
    await authenticatePage(page);
    await page.goto('/configuracion/catalogos?lista=docentes');
    await expect(page.getByRole('tab', { name: 'Docentes' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: /Nuevo docente/i }).click();
    let dialog = page.getByRole('dialog', { name: /Agregar docente/i });
    await expect(dialog).toBeVisible();
    let fields = dialog.locator('.config-catalogField input');
    await fields.nth(0).fill(name);
    await fields.nth(1).fill(dni);
    await fields.nth(2).fill('ui.test@example.com');
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const search = page.getByPlaceholder('Buscar en la tabla...');
    await search.fill(marker);
    let row = page.getByRole('table', { name: 'Docentes' }).getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(dni);
    await row.getByRole('button', { name: `Editar ${name}` }).click();
    dialog = page.getByRole('dialog', { name: /Editar docente/i });
    fields = dialog.locator('.config-catalogField input');
    await fields.nth(0).fill(nameEdited);
    await dialog.getByRole('checkbox').uncheck();
    await dialog.locator('.config-catalogTeacherOptions input[type=text]').fill('PW E2E LICENCIA');
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(dialog).toHaveCount(0);
    row = page.getByRole('table', { name: 'Docentes' }).getByRole('row').filter({ hasText: nameEdited });
    await expect(row).toContainText('INACTIVO');
    await row.getByRole('button', { name: `Eliminar ${nameEdited}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Eliminar docente' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Docentes' }).getByRole('row').filter({ hasText: nameEdited })).toHaveCount(0);
    expect((await listTeachers(request)).some((teacher) => teacher.nombre === nameEdited)).toBe(false);
  });
});
