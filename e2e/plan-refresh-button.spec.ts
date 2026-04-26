import { expect, test } from "@playwright/test";

/**
 * E2E test for the Plan tab's manual refresh button.
 *
 * The Plan tab auto-recomputes after every Server Action that calls
 * `revalidatePath`, but the inline refresh button is the manual
 * escape hatch for direct DB edits / multi-tab sessions. The test
 * just covers the click → spinner → click-again loop; deeper
 * coverage of which mutations trigger an auto-refresh lives in the
 * algorithm + snapshot specs.
 */
test("Plan tab refresh button triggers a router refresh", async ({ page }) => {
  await page.goto("/en");

  // Open the active tier (Test Tier in the seed, Heavyweight in
  // production). We pick whichever tier card the dashboard shows
  // first since the tier-grid sorts active first.
  const firstTier = page.locator('a[href*="/tiers/"]').first();
  await firstTier.click();

  // The Plan tab is the second tab — Players is the default after
  // v1.4. Click the Plan trigger to switch.
  await page.getByRole("tab", { name: /^Plan$/ }).click();

  // The refresh button should be visible in the Plan tab header.
  const refresh = page.getByRole("button", { name: /^Refresh$/ });
  await expect(refresh).toBeVisible();
  await expect(refresh).toBeEnabled();

  await refresh.click();

  // After the click finishes (router.refresh resolves), the button
  // returns to its enabled state. Playwright waits up to 5s for the
  // network round-trip.
  await expect(refresh).toBeEnabled({ timeout: 5000 });
});
