const fs = require("fs");
const { loadTestEnv } = require("./env.helper");

function authState() {
  const env = loadTestEnv();
  if (!fs.existsSync(env.authFile)) {
    throw new Error("No existe tests/.auth/cooperadora.json. Falló el globalSetup.");
  }
  return JSON.parse(fs.readFileSync(env.authFile, "utf8"));
}

async function authenticatePage(page) {
  const auth = authState();
  await page.addInitScript((session) => {
    sessionStorage.setItem("cooperadora_session", JSON.stringify(session));
  }, auth.session);
  return auth;
}

function token() {
  return authState().session.token;
}

module.exports = { authState, authenticatePage, token };
