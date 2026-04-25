# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.1] - 2026-04-25

A small data-correctness pass.

### Changed

- **Heavyweight `max_ilv` corrected from 795 to 790.** General
  Savage gear caps at 790 — only the floor-4 weapon goes to 795,
  and floor 4 is `tracked_for_algorithm = false` so the algorithm
  doesn't compete on weapon drops anyway. Every per-source iLv
  cascades off 790 (TomeUp = 785, Catchup = 780, Tome = 775, ...).
  The seed default is updated; the active tier in existing
  deployments has been migrated separately via SQL.

### Added

- **`scripts/import-tier-data.ts`** — idempotent re-runnable script
  that reproduces Mannschaft Smelly's spreadsheet snapshot:
  - Player metadata: alt jobs, gear-set links, notes.
  - Full BiS plan per player (12 slots × desired/current/marker).
  - Page balances reproduced via per-(player, tier, floor)
    `page_adjust` rows so the displayed balance matches the
    spreadsheet exactly without back-filling synthetic loot drops.
  - 9 raid weeks + boss kills with the team-clears schedule
    (F1=9, F2=8, F3=6).
- `pnpm import:tier` npm script.

## [1.2.0] - 2026-04-25

A UI/UX pass to centralise the app around the dashboard. Inspired by
the FFLogs-Analyzer pattern the team is already used to:

### Changed

- **Dashboard is now a tier-grid.** The previous hero card +
  quick-actions row is replaced by one clickable card per tier
  (active first, archived after). Each card surfaces a drops
  counter on the right and weeks / kills in the footer; hover
  lifts the border to indigo so the cards feel actionable.
- **Top nav slimmed to brand + Players + Settings cog.** Tier,
  Loot, and History no longer live up there — they're tabs inside
  the per-tier detail page now. The Settings cog targets the
  team-settings page.
- **Indigo primary accent** replaces the neutral primary on
  buttons, rings, and the dashboard's drop counter. The slate-blue
  background tint stays as calibrated.

### Added

- **NewTierDialog**: dashed-border "plus card" rendered as the last
  cell in the dashboard grid. Opens a dialog with name + max iLv;
  on submit the new `createTierAction` Server Action archives the
  previously-active tier, inserts the new tier with the cascaded
  per-source iLvs, and provisions the canonical Heavyweight floor
  + buy-cost layout. The dialog closes itself and routes the user
  to `/tiers/<newTierId>`.
- **`/tiers/[id]` tier-detail page** with four tabs:
  - **Plan**: forward-looking simulator
  - **Track**: per-floor kill toggle + drop cards (shared with
    the legacy `/loot` route)
  - **History**: per-week loot history scoped to this tier
  - **Settings**: tier-name + max-iLv form
- **`src/lib/db/queries-tiers.ts`**: `listTiersForTeam` (with
  weeks / kills / drops rollup per tier) + `findTierById`
  (team-scoped lookup).
- **`src/lib/ffxiv/tier-defaults.ts`**: shared Heavyweight floor
  layout + buy-cost defaults so the boot-time seed and the in-app
  tier-creation flow stay in lock-step.

### Routing

- `/loot`, `/tier`, `/history` redirect to the active tier's
  `/tiers/<id>` page (preserving locale prefix). Direct links and
  bookmarks keep working — they just land inside the new tabbed
  view.

## [1.1.0] - 2026-04-25

A presentation pass. Phase 1's algorithm and data model don't change —
this release adds a forward-looking *Plan* tab to the loot page, gives
the per-player view a hero card and a spreadsheet-style colour-coded
BiS table, and makes the Materials card actionable.

### Added

#### Loot timeline / planning
- `/loot` is now a two-tab page (Plan / Track) backed by Base UI
  Tabs:
  - **Plan** is the forward-looking simulator. For each upcoming
    week (default 8) it walks through every floor's drops and assigns
    each one to the algorithm's top pick, applying the same
    `effective_need` math the live recommendation uses. The result is
    rendered as a Week × Item grid per floor so the team can read off
    a projected loot timeline at a glance.
  - **Track** is the existing kill-toggle + drop-card workflow,
    untouched. As real drops are recorded the snapshots update, so
    the Plan recomputes automatically on the next request.
- `src/lib/loot/timeline.ts` — pure `simulateLootTimeline()` over the
  same `PlayerSnapshot` / `TierSnapshot` shapes the live algorithm
  consumes, so the simulator stays bug-for-bug aligned with reality.
  Six fixture-driven Vitest cases lock in the contract (page costs
  spent, role-weighted ties, untracked floors blanked, deterministic
  hash tiebreaker).

#### Player detail redesign
- Hero card on `/players/[id]`: large player name, role-coloured
  job chip (Tank=sky / Healer=emerald / Melee=rose / Phys-Ranged=
  amber / Caster=violet), alt-jobs line, gear-set link with an
  external-link icon, and a BiS progress bar showing the share of
  desired-source slots already at BiS.
- Materials card refresh: now shows *Received* and *Needed* side-by-
  side. The needed counts are derived from the BiS plan
  (`desiredSource === "TomeUp"` per slot category, mapped Glaze →
  Head/Gloves/Boots, Twine → Chestpiece/Pants, Ester → accessories);
  fully-funded materials get a subtle emerald tint.
- Savage-drops counter promoted to its own compact card so the
  fairness factor is legible at a glance.

#### BiS-table colour legend
- `src/lib/ffxiv/bis-status.ts` — pure `computeBisTone()` returning
  one of seven tones that mirror the spreadsheet legend
  (purple = BiS achieved, amber = needs upgrade token,
  sky = near max, emerald = intermediate, slate = behind,
  rose = significant gap, neutral = NotPlanned). Each row picks up
  a 4-px coloured accent stripe + tinted background so the gear
  status is legible at a glance even from the back of the room.

### Tests
42 unit tests (3 utils + 11 jobs + 10 slots + 12 algorithm + 6
timeline).

## [1.0.0] - 2026-04-25

The MVP. Phase 1 of the [roadmap](./ROADMAP.md) is complete: the app
replaces the Mannschaft-Smelly spreadsheet end-to-end, with live
recommendations driven by the page-aware scoring engine.

### Added

#### Loot distribution
- `/loot` page lands the active raid-week. Empty state offers a
  "Start first raid week" CTA; once weeks exist, the page renders one
  card per floor with a Mark-as-cleared toggle and a 2-column drop
  grid below.
- DropCard handles three render branches — *awarded* (shows recipient
  + Undo), *eligible recipients* (Top-1 recommendation per Topic 6,
  with an Other-player override dialog listing every player sorted by
  algorithm score), and *no eligible recipient* (manual override
  only). The score snapshot at decision time is persisted on the
  `loot_drop` row so historical recommendations stay reproducible.
- Server Actions: `createRaidWeek`, `recordBossKill`, `undoBossKill`,
  `awardLootDrop`, `undoLootDrop` — all Zod-validated, idempotent on
  re-submit, and revalidating every consuming route.

#### Per-player stats
- `/players/[id]` gains a Pages & Materials section above the BiS
  tracker. The page-balance table is auto-derived
  (`kills + page_adjust − tokens_spent` per floor); the Adjust column
  is the single editable seam in the entire page-accounting layer
  (Topic 2 decision).
- Materials card shows Glaze / Twine / Ester counts received this
  tier; the bottom of the card surfaces the Savage-drop count that
  drives the algorithm's fairness factor.

#### Loot history
- `/history` page reads every recorded drop, groups them by week, and
  renders one card per week. Drops show the recipient with optional
  "via pages" / "manual override" badges that mirror the
  spreadsheet's annotations.

#### Tier configuration
- `/tier` page exposes the active tier behind a tiny edit form: name
  + max iLv. The nine per-source iLvs cascade via
  `deriveSourceIlvs` (the same formula the seed uses). A preview
  list shows what saving would produce. Per-source overrides and
  editable buy costs are on the v1.1 wishlist.

#### Plumbing
- `src/lib/loot/snapshots.ts` — DB → algorithm-input adapter. Eight
  small queries, no mega-CTE, ~100ms tail latency on a typical
  `data/loot.db`.
- `src/lib/db/queries-stats.ts` — per-player tier-scoped balances
  used by the player detail page.
- `src/lib/stats/actions.ts` — page-adjust upsert.
- `src/lib/tiers/actions.ts` — tier-edit upsert with iLv cascade.
- DE / EN translations land for every new page + Server Action toast.

### Changed
- Dark-mode palette nudged from neutral grey to deep slate-blue
  (visibly tinted; lightness ~0.205, chroma ~0.030, hue 248) per
  user feedback after testing v0.1.0.
- Docker host port is configurable via `HOST_PORT` in `.env`; default
  remains 3000.
- Healthcheck targets `127.0.0.1:3000/en` instead of `localhost:3000/`
  so it survives the `::1` resolution mismatch and the 307 redirect
  on `/`.

### Pending for v1.1
- Per-source iLv overrides and editable `tier_buy_cost` rows.
- Discord / Markdown export of weekly distribution.
- xivgear.app link parser (auto-import BiS plans).
- Cmd+K command palette for raid-leader power-user shortcuts.

## [0.1.0] - 2026-04-25

The first interim milestone after Phase 0. Substantial groundwork
for the MVP — every Phase 1 *foundation* (schema, players, BiS,
scoring engine) is in place. The loot-distribution UI itself comes
in v1.0.0.

### Added

#### Documentation & decisions
- `ROADMAP.md` records the closed status of all seven Phase 1
  discussion topics with their per-decision blocks (DPS preference,
  pages tracking, Floor 4 behaviour, Glaze/Twine/Ester, BiS source
  granularity, recommendation display, tier rollover).

#### Database & domain
- Full Phase 1 schema across nine tables (`team`, `player`,
  `bis_choice`, `tier`, `floor`, `tier_buy_cost`, `raid_week`,
  `boss_kill`, `loot_drop`, `page_adjust`).
- First-boot seed installs the team `Mannschaft Smelly` and the
  active Heavyweight tier with floor layout, source iLvs (max 795),
  the canonical `tier_buy_cost` lookup (Earring 3, Head 4, Body 6,
  Weapon 8, Glaze 3, Twine 4, Ester 4), and floor-4
  `tracked_for_algorithm = false`.

#### UI
- Persistent site header (brand, five-tab nav, locale switcher,
  theme toggle).
- Dashboard: live team + tier card, quick-actions list.
- Team-settings page (`/team`) with rename + default locale.
- Player CRUD (`/players`): empty state, table with role badges,
  create/edit dialog (job picker grouped by role), delete
  confirmation.
- Per-player BiS tracker (`/players/[id]`): twelve-row gear table
  with desired-source / current-source / marker dropdowns, inline
  iLv display, auto-save on change, row colours signalling BiS
  progress.

#### Algorithm
- `src/lib/loot/algorithm.ts` — pure-function scoring engine over
  plain data. Implements every term in the roadmap:
  - page-aware `effective_need` (Topic 2)
  - class-aware role weights (Topic 1)
  - same engine for upgrade materials (Topic 4)
  - sorted-highest-first output (Topic 6)
  - tiebreaker on oldest last-drop, then deterministic hash
- 12 fixture-driven Vitest cases prove the contract.

#### Plumbing
- Routes touching the database are `force-dynamic` so live state
  doesn't go stale behind a prerender.
- date-fns added for locale-aware date formatting.
- Zod 4 added for shared client/server validation; shadcn `alert`,
  `alert-dialog`, `badge`, `textarea` components added.

### Tests
36 unit tests passing (3 utils + 11 jobs + 10 slots + 12 algorithm).

## [0.0.1] - 2026-04-25

Phase 0 (project setup) of the [roadmap](./ROADMAP.md).

### Added
- **Next.js 16 + React 19 + Tailwind v4 scaffold** with the App Router,
  the `src/` layout, pnpm as the package manager, and Biome as the
  unified lint/format toolchain.
- **TypeScript strict mode** with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and
  `noFallthroughCasesInSwitch` enabled.
- **shadcn/ui** integrated on the new base-nova preset (Base UI
  primitives, neutral palette). Components shipped at this stage:
  button, card, dialog, input, label, select, sonner (toaster), table.
- **Theme + toast providers** wired into the root layout with
  next-themes (system-following dark mode) and Sonner.
- **Drizzle ORM + libSQL** with the initial `team` table and a
  programmatic migrator wired into `src/instrumentation.ts` so a fresh
  database is migrated automatically on server boot.
- **next-intl** with German and English locales, locale-prefixed URLs
  (`/en`, `/de`), the v16 `proxy.ts` file convention, type-safe
  navigation helpers, and a locale switcher component.
- **Vitest** unit suite (jsdom + Testing Library + jest-dom) and a
  **Playwright** end-to-end skeleton with a smoke test that walks the
  proxy, the `[locale]` route segment, and the German/English content.
- **Multi-stage Dockerfile** producing a Next.js standalone image
  (~245 MB) running as `node` (uid 1000), with a HEALTHCHECK against
  `/`, the SQLite path on a volume, and migrations applied at boot.
- **docker-compose.yml** for one-command self-hosting.
- **README** with a quick-start, local-development guide, project
  layout, and tech-stack overview.

### Repository hygiene
- MIT-licensed under the team's GitHub noreply identity.
- `.env.example` documents `DATABASE_URL` and the optional auth token
  for remote libSQL.
- Biome ignores generated `drizzle/` migration metadata so its
  formatter doesn't fight drizzle-kit on every schema change.
