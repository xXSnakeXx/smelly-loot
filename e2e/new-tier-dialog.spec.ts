import { expect, test } from "@playwright/test";

/**
 * Smoke test for the dashboard's "New tier" dialog.
 *
 * Reproduces the bug where the dashed-border plus-card on the
 * dashboard didn't open the tier-creation dialog (Base UI's
 * `DialogPrimitive.Trigger` couldn't merge its open-handlers onto
 * a custom function-component trigger that didn't spread the
 * incoming props).
 *
 * The test clicks the plus-card and asserts the dialog title shows
 * up. If the regression resurfaces this fails immediately; the test
 * stops short of submitting the form so it doesn't mutate the
 * shared dev database.
 */
test("Plus card on dashboard opens the New tier dialog", async ({ page }) => {
  await page.goto("/en");

  // Locate the plus card by its visible heading.
  const trigger = page.getByRole("button", { name: /New tier/i });
  await expect(trigger).toBeVisible();

  await trigger.click();

  // Dialog renders into a portal — assert by dialog role + title.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Create a new tier/i)).toBeVisible();
  await expect(dialog.getByLabel(/^Name$/)).toBeVisible();
  await expect(dialog.getByLabel(/Max iLv/i)).toBeVisible();
});
