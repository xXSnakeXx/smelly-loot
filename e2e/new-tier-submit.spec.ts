import { expect, test } from "@playwright/test";

/**
 * Submission test for the New tier dialog. Creates a real tier in
 * the DB and asserts the redirect lands on `/tiers/<id>` with the
 * new tier's name in the page header. Because the test mutates the
 * DB, it deliberately uses a one-off name and runs after the
 * smoke test.
 */
test("submitting the New tier dialog creates a tier and redirects", async ({
  page,
}) => {
  const tierName = `Smoke Tier ${Date.now()}`;

  await page.goto("/en");
  await page.getByRole("button", { name: /New tier/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/^Name$/).fill(tierName);
  await dialog.getByLabel(/Max iLv/i).fill("840");

  await dialog.getByRole("button", { name: /^Create tier$/ }).click();

  // After success the dialog closes and the user is sent to
  // /tiers/<id>. Assert we land on a tier-detail page that shows
  // the new tier's name.
  await page.waitForURL(/\/en\/tiers\/\d+/);
  await expect(page.getByRole("heading", { name: tierName })).toBeVisible();
});
