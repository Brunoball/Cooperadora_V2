"use strict";
const { test: base, expect } = require("@playwright/test");
const { installHostingerPageThrottle } = require("./hostinger-throttle.helper");

// El throttle no puede sobrevivir al test. Cancelar los handlers pendientes
// sin pedirle a Playwright que siga usando un BrowserContext ya cerrado.
const test = base.extend({
  page: async ({ page }, use) => {
    await installHostingerPageThrottle(page);
    try {
      await use(page);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  },
});

module.exports = { test, expect };
