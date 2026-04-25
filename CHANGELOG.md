# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
