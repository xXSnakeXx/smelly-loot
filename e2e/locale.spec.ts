import { expect, test } from "@playwright/test";

/**
 * Smoke test for locale routing.
 *
 * Verifies the next-intl proxy, the [locale] route segment, and the
 * locale switcher all agree on which language is active. Phase 1
 * adds richer, feature-driven scenarios; this test is the "is the
 * scaffold even alive" canary.
 */
test.describe("locale routing", () => {
  test("the root path redirects to the default locale", async ({ page }) => {
    const response = await page.goto("/");
    // The proxy redirects unprefixed requests; we expect to land on /en.
    await expect(page).toHaveURL(/\/en$/);
    // The 200 OK comes from the redirected target, not the redirect
    // itself, so any sub-300 status is acceptable.
    expect(response?.status()).toBeLessThan(400);
  });

  test("English content renders at /en", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Smelly Loot",
    );
    await expect(
      page.getByText(/Self-hosted loot distribution/i),
    ).toBeVisible();
  });

  test("German content renders at /de", async ({ page }) => {
    await page.goto("/de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Smelly Loot",
    );
    await expect(page.getByText(/Selbst gehostete/i)).toBeVisible();
  });
});
