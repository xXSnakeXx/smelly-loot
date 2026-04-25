import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for end-to-end tests.
 *
 * The single project below targets Chromium against the production
 * build of the app (`pnpm start`). End-to-end tests serve two purposes:
 *
 * 1. Cover async Server Components, which Vitest can't currently render.
 * 2. Smoke-test deployment seams (proxy, locale negotiation, theme,
 *    database access via Server Actions) that wouldn't surface in unit
 *    tests at all.
 *
 * `webServer` boots `pnpm start` automatically when running locally so
 * `pnpm test:e2e` is a one-shot command. CI pipelines that already
 * have a server running can opt out by setting `PLAYWRIGHT_SKIP_WEB_SERVER`,
 * in which case the `webServer` key is omitted entirely (omitted, not
 * `undefined`, so the strict `exactOptionalPropertyTypes` config is
 * satisfied).
 */
const skipWebServer = Boolean(process.env.PLAYWRIGHT_SKIP_WEB_SERVER);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Pin a single worker on CI for deterministic ordering of database
  // mutations; locally let Playwright pick the optimal count by
  // omitting the key entirely (the strict typing forbids `undefined`).
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: "pnpm start",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
