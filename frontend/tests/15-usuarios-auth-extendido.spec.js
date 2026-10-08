const { test, expect } = require('./helpers/playwright.helper');
const { token } = require('./helpers/auth.helper');
const { ok, login, apiFetch } = require('./helpers/api.helper');
const { suffix } = require('./helpers/data.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, 'Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.');
});

test.describe('Usuarios y autenticación extendidos', () => {
  test('usuario E2E recorre alta, edición, baja, reactivación y eliminación definitiva', async ({ request }) => {
    const adminToken = token();
    const stamp = suffix().replace(/[^A-Z0-9]/gi, '').toLowerCase();
    const username = `pw_e2e_user_${stamp}`.slice(0, 60);
    const password = `Clave!${stamp}Aa1`;

    const created = await ok(request, 'usuarios_guardar', {
      token: adminToken,
      method: 'POST',
      data: {
        nombre_completo: `PW E2E Usuario ${stamp}`,
        usuario: username,
        rol: 'vista',
        contrasena: password,
        confirmar_contrasena: password,
      },
    });
    const id = created.usuario?.id;
    expect(id).toBeTruthy();

    await ok(request, 'usuarios_guardar', {
      token: adminToken,
      method: 'POST',
      data: {
        id,
        nombre_completo: `PW E2E Usuario Edit ${stamp}`,
        usuario: username,
        rol: 'vista',
        contrasena: '',
        confirmar_contrasena: '',
      },
    });

    await ok(request, 'usuarios_cambiar_estado', {
      token: adminToken,
      method: 'POST',
      data: { id, activo: false },
    });

    const disabledLogin = await apiFetch(request, 'auth_login', {
      method: 'POST',
      data: { usuario: username, contrasena: password },
      userAgent: 'PW-COOP-E2E-DISABLED-LOGIN',
    });
    expect(disabledLogin.status).toBe(403);
    expect(disabledLogin.body?.codigo).toBe('USER_DISABLED');

    await ok(request, 'usuarios_cambiar_estado', {
      token: adminToken,
      method: 'POST',
      data: { id, activo: true },
    });

    await ok(request, 'usuarios_eliminar', {
      token: adminToken,
      method: 'POST',
      data: { id },
    });

    const listado = await ok(request, 'usuarios_listar', { token: adminToken });
    expect((listado.usuarios || []).some((u) => Number(u.id) === Number(id))).toBe(false);
  });

  test('sesión E2E puede consultar usuario actual y cerrar sesión', async ({ request }) => {
    const adminToken = token();
    const stamp = suffix().replace(/[^A-Z0-9]/gi, '').toLowerCase();
    const username = `pw_e2e_auth_${stamp}`.slice(0, 60);
    const password = `Auth!${stamp}Aa1`;

    const created = await ok(request, 'usuarios_guardar', {
      token: adminToken,
      method: 'POST',
      data: {
        nombre_completo: `PW E2E Auth ${stamp}`,
        usuario: username,
        rol: 'vista',
        contrasena: password,
        confirmar_contrasena: password,
      },
    });
    const id = created.usuario?.id;

    const session = await login(request, username, password, 'PW-COOP-E2E-AUTH-LOGOUT');
    const actual = await ok(request, 'auth_usuario_actual', { token: session.token });
    expect(actual.usuario?.usuario || actual.user?.usuario).toBe(username);

    await ok(request, 'auth_logout', {
      token: session.token,
      method: 'POST',
      data: {},
    });

    const afterLogout = await apiFetch(request, 'auth_usuario_actual', { token: session.token });
    expect(afterLogout.status).toBe(401);

    await ok(request, 'usuarios_eliminar', {
      token: adminToken,
      method: 'POST',
      data: { id },
    });
  });

  test('protege la sesión actual y rechaza nombres de usuario duplicados', async ({ request }) => {
    const adminToken = token();
    const users = await ok(request, 'usuarios_listar', { token: adminToken });
    const current = (users.usuarios || []).find((user) => user.sesion_actual === true);
    expect(current).toBeTruthy();

    const disableCurrent = await apiFetch(request, 'usuarios_cambiar_estado', {
      token: adminToken,
      method: 'POST',
      data: { id: current.id, activo: false },
    });
    expect(disableCurrent.status).toBe(409);
    expect(disableCurrent.body.codigo).toBe('USUARIO_ACTUAL_BAJA');

    const deleteCurrent = await apiFetch(request, 'usuarios_eliminar', {
      token: adminToken,
      method: 'POST',
      data: { id: current.id },
    });
    expect(deleteCurrent.status).toBe(409);
    expect(deleteCurrent.body.codigo).toBe('USUARIO_ACTUAL_ELIMINAR');

    const stamp = suffix().replace(/[^A-Z0-9]/gi, '').toLowerCase();
    const username = `pw_e2e_dup_${stamp}`.slice(0, 60);
    const password = `Dup!${stamp}Aa1`;
    const first = await ok(request, 'usuarios_guardar', {
      token: adminToken,
      method: 'POST',
      data: {
        nombre_completo: `PW E2E Duplicado ${stamp}`,
        usuario: username,
        rol: 'vista',
        contrasena: password,
        confirmar_contrasena: password,
      },
    });
    const duplicate = await apiFetch(request, 'usuarios_guardar', {
      token: adminToken,
      method: 'POST',
      data: {
        nombre_completo: `PW E2E Duplicado Dos ${stamp}`,
        usuario: username,
        rol: 'vista',
        contrasena: password,
        confirmar_contrasena: password,
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.codigo).toBe('USUARIO_DUPLICADO');

    await ok(request, 'usuarios_eliminar', {
      token: adminToken,
      method: 'POST',
      data: { id: first.usuario.id },
    });
  });

});
