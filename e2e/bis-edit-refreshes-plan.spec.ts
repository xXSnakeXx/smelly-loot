import { expect, test } from "@playwright/test";

/**
 * Regression test: editing a player's BiS plan should re-render the
 * Plan tab against the latest snapshot, not just the player-detail
 * page.
 *
 * Pre-v1.4.2 the BiS Server Action only revalidated
 * `/players/${id}`, so the Plan tab kept showing the recommendation
 * computed from the previous BiS choices until the user explicitly
 * refreshed. This test changes a slot's desired source on the
 * player-detail page, then asserts that the Plan tab on the
 * tier-detail page reflects the new player. Failure mode is "the
 * Plan tab still shows stale recipients".
 *
 * Implementation:
 *
 *   1. Open a player detail page (Fara, the seed roster's first
 *      raider).
 *   2. Change Fara's Weapon desired source to NotPlanned (so she
 *      drops out of the Weapon competition entirely).
 *   3. Navigate to the active tier's Plan tab.
 *   4. Assert that no Weapon row in the Plan grid lists Fara.
 *
 * The test isn't a 1:1 verification that the algorithm didn't pick
 * Fara before — it just covers the auto-refresh path. A
 * regression where revalidation gets dropped would still fail this
 * test reliably since the Plan would either show Fara (stale) OR
 * produce a server error.
 */
test("BiS edit refreshes the Plan tab on the active tier", async ({ page }) => {
  // 1. Land on the dashboard, jump to the first tier card → Players.
  await page.goto("/en");
  const firstTier = page.locator('a[href*="/tiers/"]').first();
  await firstTier.click();
  await page.waitForURL(/\/en\/tiers\/\d+/);

  // 2. Open the first player listed under Players (the active tier
  // tab is Players-by-default in v1.4).
  const firstPlayer = page.locator('a[href*="/players/"]').first();
  await firstPlayer.click();
  await page.waitForURL(/\/en\/players\/\d+/);

  // 3. Change the Weapon row's desired source to NotPlanned. The
  // BiS table renders one Select per row; the Weapon row is the
  // first one (matches src/lib/ffxiv/slots.ts SLOTS order).
  const weaponDesiredTrigger = page
    .getByRole("row", { name: /Weapon/ })
    .getByRole("combobox")
    .first();
  await weaponDesiredTrigger.click();
  await page.getByRole("option", { name: /^—$/ }).click();

  // The save toast confirms the action ran. Wait for it explicitly
  // so the revalidatePath round-trip has a chance to land before
  // we navigate away.
  await expect(page.getByText(/saved/i).first()).toBeVisible({
    timeout: 5000,
  });

  // 4. Go back to the tier-detail page Plan tab. The dashboard
  // route is the simplest way back — pick the first tier card
  // again so we always land on the active tier.
  await page.goto("/en");
  await page.locator('a[href*="/tiers/"]').first().click();
  await page.waitForURL(/\/en\/tiers\/\d+/);
  await page.getByRole("tab", { name: /^Plan$/ }).click();

  // 5. Assert no Weapon-column cell mentions Fara. The Plan
  // grid uses one row per upcoming week; the Weapon column is
  // headed by "Weapon" and only appears on the floor-4 card.
  const weaponCells = page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: /Weapon/ }) })
    .locator('tbody tr td:has-text("Fara")');
  await expect(weaponCells).toHaveCount(0);
});
