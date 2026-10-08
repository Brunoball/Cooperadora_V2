"use strict";
const { test: base, expect } = require("@playwright/test");
const { installHostingerPageThrottle } = require("./hostinger-throttle.helper");

// Usa el mismo test/expect. Solo agrega regulación a las requests PHP de React.
const test = base.extend({
  page: async ({ page }, use) => {
    await installHostingerPageThrottle(page);
    await use(page);
  },
});

module.exports = { test, expect };
