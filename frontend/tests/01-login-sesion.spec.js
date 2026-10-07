const { test, expect } = require("@playwright/test");
const { authState } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();

function loginCredentials(auth) {
  if (auth.runner?.usuario && auth.runner?.contrasena) {
    return { usuario: auth.runner.usuario, contrasena: auth.runner.contrasena };
  }
  return { usuario: env.username, contrasena: env.password };
}

test.describe("Login y sesión", () => {
  test("login real desde la UI", async ({ page, request }) => {
    const auth = authState();
    const credentials = loginCredentials(auth);
    await page.goto("/");
    await page.getByPlaceholder("Usuario").fill(credentials.usuario);
    await page.getByPlaceholder("Contraseña").fill(credentials.contrasena);
    await page.getByRole("button", { name: /ingresar/i }).click();
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.locator("body")).not.toContainText("Usuario o contraseña incorrectos");

    // En smoke remoto cerramos la sesión adicional creada por la UI para no
    // dejar una sesión activa extra. En local el runner se elimina en cleanup.
    if (auth.readOnly) {
      const session = await page.evaluate(() => {
        try { return JSON.parse(sessionStorage.getItem("cooperadora_session") || "null"); }
        catch { return null; }
      });
      if (session?.token) {
        await apiFetch(request, "auth_logout", { token: session.token, method: "POST" });
      }
    }
  });

  test("Bearer temporal devuelve el usuario actual", async ({ request }) => {
    const auth = authState();
    const body = await ok(request, "auth_usuario_actual", { token: auth.session.token });
    const expected = auth.runner?.usuario || env.username;
    expect(body.usuario?.usuario).toBe(expected);
    expect(body.usuario?.rol).toBeTruthy();
  });

  test("validación local evita enviar login vacío", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ingresar/i }).click();
    await expect(page.locator("body")).toContainText(/Ingresá tu usuario/i);
  });
});
