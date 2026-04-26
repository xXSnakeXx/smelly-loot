"use client";

/**
 * Top-bar navigation.
 *
 * After the v1.4 tier-scoped-roster refactor everything that used to
 * live on the top nav (players, tier config, loot tracking, history)
 * hangs off the per-tier detail page as tabs. The nav surface is
 * therefore intentionally empty here — the Brand link on the left
 * and the Settings cog on the right (in `site-header`) are the only
 * persistent affordances. The dashboard's tier grid is the canonical
 * "where do I go from here" entry point.
 *
 * The component is kept around as a no-op spacer so the header
 * layout (which uses the nav as a flex child) doesn't shift; it'll
 * grow back into a real menu once we actually have global surfaces
 * worth promoting.
 */
export function MainNav() {
  return <nav className="flex items-center gap-1 text-sm" />;
}
