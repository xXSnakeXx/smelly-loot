# Smelly Loot - Roadmap

## Project Vision

Replace the team's existing FF XIV loot tracking spreadsheet with a self-hosted
web application that automates fair loot distribution recommendations per boss
kill, with built-in upgrade-material accounting and gear-progression tracking.

Goals (in priority order):

1. **Fair**: deterministic, transparent scoring per drop, with a slight DPS
   preference. Every recommendation must be explainable ("why is Quah ahead of
   Rei for this earring?").
2. **Fast**: power-user, keyboard-first UX for the raid leader. Logging a full
   floor of drops should take well under a minute.
3. **Complete**: replaces both the gear-tracker tab and the loot-distribution
   tab of the existing spreadsheet — no external sheet needed.
4. **Maintainable**: small surface area, all data in SQLite, no runtime
   dependencies on external services. The only optional outbound integration is
   xivgear.app for BiS import (Phase 2).
5. **Self-hostable**: single Docker container, single SQLite file, no auth in
   v1.0. Trivial to back up and migrate.

Non-goals (explicit):

- Not a public service. No tenant isolation, billing, etc.
- Not a damage / parse analyser — that's what fflogs-analyzer is for.
- No mobile-first UX. Desktop-only is a deliberate choice.

---

## Tech Stack

Decided 2026-04-25.

| Layer            | Choice                              | Notes                                                                  |
| ---------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Runtime          | Node.js 20 LTS                      | Alpine base for container                                              |
| Framework        | Next.js 15, App Router, React 19    | Server Components + Server Actions; no separate API tier               |
| Language         | TypeScript (strict)                 | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled       |
| UI kit           | shadcn/ui + Tailwind CSS            | Components copied into the repo, owned by us                           |
| Data grids       | TanStack Table v8                   | Backbone of the gear-tracker / loot-history views                      |
| Database         | SQLite via libSQL (`@libsql/client`)| File-based, WAL mode, mounted volume                                   |
| ORM              | Drizzle ORM                         | Type-safe, SQL-near, fast migrations                                   |
| Validation       | Zod + react-hook-form               | Same schema in client and Server Action                                |
| i18n             | next-intl                           | DE / EN, type-safe message keys                                        |
| Icons            | lucide-react                        | Bundled with shadcn/ui                                                 |
| State            | TanStack Query (sparingly) + Zustand for UI-only state | Most server state stays on the server                  |
| Tests            | Vitest (unit) + Playwright (e2e)    | Vitest for the score algorithm; Playwright for 2-3 critical flows      |
| Lint / Format    | Biome                               | Replaces ESLint + Prettier                                             |
| Package manager  | pnpm                                | Fast, content-addressed                                                |
| Container        | Docker, multi-stage, Node 20 alpine | Single image, ~150 MB                                                  |

Auth: **none** in v1.0. Considered for Phase 3 (edit-token links).

---

## Domain Model

```ts
// drizzle schema (sketch — v1 finalized 2026-04-25)

team(id, name, locale, created_at)

player(
  id, team_id, name, main_job, alt_jobs JSON,
  gear_role,                       // computed from main_job: tank | healer | melee | phys_range | caster
  gear_link, notes, sort_order, created_at
)

// per-player BiS plan: which source they want for each slot
bis_choice(
  player_id, slot,                 // PK
  source                            // see Source enum below
)

// tier definition: configured at tier creation, persisted in DB (not YAML)
tier(
  id, name, archived_at,            // archived_at != null → read-only snapshot
  max_ilv,                          // user input at creation; everything else derives
  ilv_savage, ilv_tome_up, ilv_tome, ilv_catchup,
  ilv_extreme, ilv_relic, ilv_crafted, ilv_whyyyy, ilv_just_no,
  glaze_label, twine_label, ester_label,    // tier-specific material names
  glaze_floor, glaze_cost,                  // floor 2, 3 tokens
  twine_floor, twine_cost,                  // floor 3, 4 tokens
  ester_floor, ester_cost                   // floor 3, 4 tokens
)

floor(
  id, tier_id, number,              // 1..4
  drops JSON,                       // ["Earring","Necklace",...] gear + token names
  tracked_for_algorithm BOOLEAN,    // false for floor 4
  page_token_label                  // e.g. "HW Edition I"
)

// per-floor token cost lookup (covers all buyable items + materials)
tier_buy_cost(
  tier_id, item,                    // PK
  floor_number,                     // which floor's token pays for it
  cost                              // number of tokens
)

raid_week(id, tier_id, week_number, started_at)

// boss kills feed page accumulation; one row per (week, floor) combo
boss_kill(
  raid_week_id, floor_id,           // PK
  cleared_at
)

// every recorded drop, whether the algorithm picked it or the user overrode
loot_drop(
  id, raid_week_id, floor_id, item,
  recipient_id,                     // null if dropped to floor / pug-won
  paid_with_pages BOOLEAN,          // true → no boss drop, just a token purchase
  picked_by_algorithm BOOLEAN, score_snapshot JSON, notes
)

// per-player, per-floor adjustment for pre-tier or missed-week corrections
page_adjust(
  player_id, tier_id, floor_number, // PK
  delta                             // signed integer
)
```

**Slot enum** (fixed): `Weapon, Offhand, Head, Chest, Gloves, Pants, Boots, Earring, Neck, Bracelet, Ring1, Ring2`

**Source enum** (Topic 5, decision: Option B — keep all 8 sources from the
spreadsheet's legend, including the in-jokes):
`Savage, TomeUp, Catchup, Tome, Extreme, Relic, Crafted, WHYYYY, JustNo, NotPlanned`

The iLv each source resolves to is derived from the tier's `max_ilv`
input via fixed deltas (see Topic 7's "Tier Creation UX"). Operators
can override individual values during tier creation if a future patch
breaks the pattern.

**Material enum**: `Glaze, Twine, Ester` (consumable upgrades). Names
and floor-of-origin are tier-configurable so upcoming tiers can rename
them (e.g. "Thundersteeped Solvent" → "Ester" alias).

**Page accounting**: pages are not stored as a single value; they're
auto-derived per render: `pages = boss_kills_for_floor +
sum(page_adjust.delta for that floor) - tokens_spent_for_floor`.

---

## Distribution Algorithm

The core deliverable. Per drop, every eligible player gets a score; the highest
score is the algorithm's recommendation. The raid leader can always override.

```
score = base_priority * role_weight * ilv_gain_factor * fairness_factor
       - recency_penalty
```

| Term              | Definition                                                                         |
| ----------------- | ---------------------------------------------------------------------------------- |
| `base_priority`   | `effective_need * 100` where `effective_need = max(0, slots_needing_this_source - already_owned - buy_power)` |
| `buy_power`       | `floor(player_pages_for_this_floor / item_page_cost)` — how many of this item the player can self-buy with their floor-specific tokens |
| `role_weight`     | Klassen-aware (Topic 1 decision, Option B): see role table below                   |
| `ilv_gain_factor` | `(desired_ilv - current_ilv) / 10`, clamped to `[0.5, 3.0]`                        |
| `fairness_factor` | `1 / (1 + savage_drops_received_this_tier)`                                        |
| `recency_penalty` | `max(0, (4 - weeks_since_last_drop_from_this_floor)) * 5`                          |

**Pages-aware `effective_need`** is the crucial term. Pages let players
self-purchase any drop using floor-specific tokens (1 token per boss
kill per player). A player with enough pages to cover their remaining
need is deprioritized — the drop should go to someone who actually
depends on it.

Worked example (Earrings cost 3 HW Edition I tokens):
- Quah: BiS = 1 Savage Earring outstanding, current pages = 6 → buy_power = 2 → effective_need = max(0, 1 − 0 − 2) = 0 → score = 0 → not recommended.
- Rei: BiS = 1 Savage Earring outstanding, current pages = 2 → buy_power = 0 → effective_need = 1 → score = 100 × role_weight × … → recommended.

**Role weights** (Topic 1, decision: Option B, gear-role aware):

| Role / gear group        | Jobs                                  | `role_weight` |
| ------------------------ | ------------------------------------- | ------------- |
| Tank (Fending)           | PLD, WAR, DRK, GNB                    | 1.00          |
| Healer (Healing)         | WHM, SCH, AST, SGE                    | 1.00          |
| Caster DPS (Casting)     | BLM, SMN, RDM, PCT                    | 1.00          |
| Phys-Ranged DPS (Aiming) | BRD, MCH, DNC                         | 1.05          |
| Melee DPS                | DRG, RPR, MNK, SAM, NIN, VPR          | 1.10          |

**For upgrade materials** (Glaze / Twine / Ester) the same `effective_need`
formula applies:
`effective_need_material = max(0, materials_needed_for_bis - materials_received - floor(player_pages_for_material_floor / material_cost))`
The `role_weight` for materials is configurable per tier; default is
`1.00` for everyone (materials are pure economy and DPS preference
makes less sense than for gear pieces).

**Tier-buy-cost lookup** (Heavyweight Tier defaults; carried per tier
in `tier_buy_cost` so future tiers can be tweaked):

| Item                              | Floor / token | Cost |
| --------------------------------- | ------------- | ---- |
| Earring / Necklace / Bracelet / Ring | Floor 1       | 3    |
| Head / Gloves / Boots             | Floor 2       | 4    |
| Chest / Pants                     | Floor 3       | 6    |
| Weapon                            | Floor 4       | 8    |
| Glaze (accessory upgrade)         | Floor 2       | 3    |
| Twine (clothing upgrade)          | Floor 3       | 4    |
| Ester / Solvent (weapon upgrade)  | Floor 3       | 4    |

Floor 4 tokens convert down to Floor 1/2/3 at 1:1; the buy_power
calculation uses floor-specific pages without modeling the down-trade
in v1. Manually adjust via `page_adjust` if a player actually
down-trades.

Tiebreakers, in order:
1. Player with the oldest "last drop" timestamp.
2. Random with a deterministic seed (raid week id + floor id + item).

UI output (Topic 6, decision: Option A — Top-1 only): the highest-
scoring player is shown alongside the drop. Override opens a flat
list of all eligible players with their scores. The `score_snapshot`
is persisted on the loot drop, so historical recommendations remain
reproducible even if the algorithm changes later.

---

## Phase 0: Project Setup

Goal: a runnable, dockerised "Hello world" with the toolchain wired up.

**Status: shipped in v0.0.1 (2026-04-25).** Every checkbox below is
covered by the GitHub release; see `CHANGELOG.md` for the
commit-by-commit detail.

- [x] `pnpm create next-app` with App Router, TS strict, Tailwind
- [x] Install and init shadcn/ui (button, input, dialog, table, sonner toast, select, label, card to start)
- [x] Install Drizzle + libSQL client; first migration creates an empty `team` table
- [x] `next-intl` setup with `de.json` / `en.json` and a top-bar locale switcher
- [x] Biome config (replaces ESLint + Prettier)
- [x] Vitest config + first dummy test; Playwright skeleton with locale smoke test
- [x] `Dockerfile` (multi-stage) and `docker-compose.yml` mounting `./data`
- [x] `.env.example`, `.gitignore`, `LICENSE` (MIT), `README.md`, `CHANGELOG.md`
- [x] Public GitHub repo `xXSnakeXx/smelly-loot`
- [x] Initial commit on `main`, tag `v0.0.1`, ZIP asset attached to the GitHub release

Acceptance achieved: `docker compose up -d` opens the localized landing
page on `localhost:3000`, the SQLite migration applies on container
boot, all checks (lint / typecheck / unit / e2e) are green.

---

## Phase 1: MVP

Goal: parity with the spreadsheet + automated recommendations. Single team,
single tier, no auth. Decisions on the seven open topics (see "Open
Discussion Topics" further down) were finalized 2026-04-25 — every
sub-section below reflects those decisions directly.

### 1.1 Team & Player Management

- [ ] Single team auto-created on first run, name editable
- [ ] Player CRUD: name, main job, alt jobs, `gear_link` (plain text in
      v1, the Phase 2 xivgear-import lands later), notes
- [ ] `gear_role` is computed automatically from `main_job` (via a
      mapping in `src/lib/ffxiv/jobs.ts`); the algorithm's role weights
      live there.
- [ ] Sortable order (drag handles in the table for the raid leader)
- [ ] Job dropdown with all 21 FF XIV combat jobs grouped by role
      (Tank / Healer / Melee / Phys-Range / Caster) so the role weight
      picks itself.

### 1.2 BiS Tracker

- [ ] Per-player gear table with 12 rows (one per slot) and columns
      `Desired source`, `Current source`, `Date received`, `Markers`.
- [ ] Source dropdowns expose all 8 spreadsheet sources (Topic 5
      decision: Option B): `Savage`, `TomeUp`, `Catchup`, `Tome`,
      `Extreme`, `Relic`, `Crafted`, `WHYYYY`, `JustNo`, plus
      `NotPlanned`.
- [ ] Markers from the spreadsheet (📃 paid with pages, 🔨 will craft,
      ◀️ next upgrade, 💾 save token, 💰 bought via tomes/etc.)
- [ ] iLv displayed per cell is the active tier's value for that source
      (auto-derived in 1.3).
- [ ] Conditional cell colours matching the spreadsheet legend
      (purple / blue / green / yellow / white / red).

### 1.3 Tier Configuration

Topic 7 decision: tiers are configured in-app (DB-backed), not via
YAML. The tier-creation form takes one number — the maximum item level
— and computes everything else.

- [ ] Tier-creation form: `name`, `max_ilv`, optional manual overrides
      for individual source iLvs and material costs.
- [ ] Default iLv deltas (matching the spreadsheet's legend exactly):
      `Savage = max`, `TomeUp = max-5`, `Catchup = max-10`,
      `Tome = max-15`, `Extreme = max-20`, `Relic = max-20`,
      `Crafted = max-25`, `WHYYYY = max-30`, `JustNo = max-40`.
- [ ] Default `tier_buy_cost` table (Heavyweight numbers; per-tier
      override possible): see "Tier-buy-cost lookup" in the Distribution
      Algorithm section.
- [ ] Floor table seeded with: F1 = `Earring/Necklace/Bracelet/Ring`,
      F2 = `Head/Gloves/Boots/Glaze`,
      F3 = `Chestpiece/Pants/Twine/Ester`,
      F4 = `Weapon` (`tracked_for_algorithm = false`, Topic 3 decision).
- [ ] First seed migration creates the Heavyweight tier so the app is
      usable on first boot.

### 1.4 Loot Distribution

- [ ] "New raid week" button on the dashboard. Each week has a
      `boss_kill` row per cleared floor — `1 kill = 1 page` per player.
- [ ] Per floor: a row of drop slots; clicking one opens the
      recommendation panel.
- [ ] Recommendation panel (Topic 6 decision: Option A — Top-1 only):
      a single suggested player with score and breakdown chips. An
      "Other player" button opens a flat list with per-player scores.
- [ ] Page-aware scoring (see Distribution Algorithm): a player with
      enough pages to self-buy the drop is deprioritized and falls
      below players who actually depend on it.
- [ ] One-click accept; `Cmd+Enter` accepts the suggestion.
- [ ] Override = pick any other player; system records it as
      `picked_by_algorithm = false`.
- [ ] "Paid with pages" toggle when a player buys an item rather than
      it dropping; the loot row is marked `paid_with_pages = true`
      and decrements that floor's pages.
- [ ] After all drops are assigned: weekly summary card shows what was
      distributed and the resulting page balances.

### 1.5 Material Tally

- [ ] Live counter per player: Glaze / Twine / Ester needed vs
      received vs purchasable (from current pages).
- [ ] Auto-derived from BiS plan + loot history + page balance.
- [ ] Effective-need formula reuses the algorithm: a player who can
      buy enough materials with their current pages shows ✅; a player
      with a real shortfall shows the count in red.
- [ ] Spreadsheet-style symbols (💍, 👢) for Glaze; counter chips for
      Twine and Ester.

### 1.6 Pages Counter

- [ ] Per-player, per-floor: `kills`, `spent`, `adjust`, `current`,
      `needed` (mirror spreadsheet).
- [ ] `kills`, `spent`, and `current` are auto-derived from the
      `boss_kill` and `loot_drop` tables — no manual entry.
- [ ] `adjust` is the only editable column (per `page_adjust` row),
      for pre-tier or missed-week corrections.
- [ ] Player with the largest `needed` value across all floors is
      highlighted in yellow/bold (matches spreadsheet behaviour).

### 1.7 History Views

- [ ] Per-player gear timeline (when did they get what, did they buy
      it or did it drop, the score snapshot at the time).
- [ ] Per-week loot grid (clone of spreadsheet's loot tab) — TanStack
      Table with frozen header.
- [ ] Both views read-only; corrections require editing the underlying
      `loot_drop` row.

### 1.8 Polish

- [ ] DE / EN translation parity for every user-facing string.
- [ ] Dark mode (Tailwind class strategy, already wired up via
      next-themes in Phase 0).
- [ ] Keyboard shortcuts: `1-4` switch floors, `n` new week, `?` help
      overlay.
- [ ] Toast notifications for save / override actions.

Acceptance for v1.0.0: replicate one full historical week from the
spreadsheet (week 5 from the linked sheet is a good fixture) and
confirm the algorithm recommends the same recipients **or** the
divergence is justified by the breakdown — the score persisted on
each `loot_drop` makes either outcome auditable.

---

## Phase 2: Workflow & Integration

Goal: tighten the per-tier user journey from "tier created" to "weekly
distribution announced in Discord", and surface progression at-a-glance.

The work below is sequenced so each shippable increment unblocks the next:

### 2.1 Plan ↔ Track parity (foundation, ~v1.5.0)

The Plan tab simulates the *next* week (`startingWeekNumber = currentWeek + 1`)
while Track scores the *current* week's drops; that's a one-page-per-floor
delta in the underlying snapshot, which is enough to flip tiebreakers and make
the two recommendations diverge for the same data. The Plan tab is supposed to
be a faithful preview of what Track will recommend on the next kill, so this
is a correctness bug — not a UX choice.

- Investigate the divergence with a synthetic fixture (Test Tier ships
  randomized BiS already; perfect for this) — write a Vitest case that asserts
  Plan-Week-1 ≡ Track-Active-Week for the same snapshot.
- Fix the simulator either by aligning `startingWeekNumber` to the active
  week (and skipping the first `incrementPages`) OR by exposing the same
  semantics behind both call sites with a shared helper.
- Add a regression test so this doesn't drift again.

### 2.2 Tier onboarding flow (~v1.5.0)

- **Default `current_source = "Crafted"` for every slot** when a player is
  created. The Heavyweight Test Tier already does this manually; promoting it
  to a server-side default removes the "BiS table looks empty after creating
  a player" foot-gun.
- **Bulk-paste roster import** on the Players tab. Paste a TSV row per
  player: `Name<TAB>MainJob<TAB>AltJobs<TAB>GearLink`. Validates against the
  same Zod schema as the create dialog, surfaces per-row errors before
  committing.
- **Verify roster-copy on tier rollover** (already shipped in v1.4.0) keeps
  working with the bulk-paste path.
- Player rows stay editable inline once added — no separate "review" step.

### 2.3 Role-driven roster UI (~v1.6.0)

- **Sort order** in the Players tab + every per-floor recommendation list:
  Tank → Healer → Melee DPS → Caster DPS → Phys-Ranged DPS.
- **Role colours** applied to player rows, job chips, recipient pills on the
  Plan / Track tabs:
  - Tank → blue (sky-500ish)
  - Healer → green (emerald-500ish)
  - DPS (melee / caster / phys-range) → red (rose-500ish)
- Sort + colour tokens centralised in `src/lib/ffxiv/roles.ts` so the same
  conventions apply everywhere.

### 2.4 Item-needs overview (~v1.6.0)

- **Per-player** section on `/players/[id]`: "Still needed from Floor X" with
  the slot, the desired source, and the derived iLv. Filtered to items where
  `current ≠ desired AND desired ≠ NotPlanned`.
- **Per-tier aggregate** on the tier-detail page (likely as a sub-section of
  the Players tab or a small badge cluster on each tier card): "Floor 1: 3×
  Earring · 2× Necklace · …". Drives the "what are we still farming" question
  that comes up every other week.

### 2.5 Discord export (~v1.7.0)

- "Copy for Discord" button on the Plan tab. Renders the next week's planned
  distribution as a short Discord-flavoured markdown block:

  ```
  **Mannschaft Smelly · Heavyweight Savage · Week 15**

  **Floor 1 (Vamp Fatale)**
  - Earring → Brad
  - Necklace → S'ndae
  - Bracelet → Quah
  - Ring → Fara

  **Floor 2 (The Blowjob Brothers)**
  - …
  ```

- Single-click copy to clipboard, with a transient toast confirming the copy.
- Single-person workflow: no shared state, no auth required — anyone with
  access to the page can grab the export.

### 2.6 Stretch goals (deferred, no commitment)

These were the original Phase 2 items in this roadmap and stay on the wish
list but no longer block 2.1–2.5:

- [ ] **xivgear.app link import** — paste link, populate BiS sources
- [ ] **Score-breakdown tooltip** on every recommendation pill
- [ ] **Pages auto-tracking** without a manual `page_adjust` column
- [ ] **What-if mode** — drag a drop to a different player, preview the ripple
- [ ] **Cmd+K command palette**
- [ ] **Bulk BiS edit** — paste a TSV row to set all 12 slots at once

---

## Phase 3: Polish & Multi-Team

Goal: harden, broaden, share.

- [ ] **Multi-team support** — same instance hosts multiple statics, switcher in the top bar
- [ ] **Auth — edit-token links** — anyone with view-link can read; edit-link required to mutate (mirrors Google Sheets share UX)
- [ ] **Public read-only share link** — for raiders to peek without an account
- [ ] **Stats dashboard** — luck-of-the-draw analysis: who got the most / fewest Savage drops this tier, distribution histogram, longest dry streak
- [ ] **Multi-tier history** — archive previous tier on rollover, keep stats
- [ ] **CSV export of the full database** (for paranoid backup folk)
- [ ] **Audit log** — every loot drop / override carries an actor + timestamp once auth lands

---

## Open Discussion Topics

These are the design decisions that warrant a real conversation before
implementation. Same format as fflogs-analyzer's roadmap.

### Topic 1: DPS Preference Magnitude

> **Decision (2026-04-25): Option B — class-aware role weights.**
> Tank, Healer, and Caster DPS get `role_weight = 1.00` (the casters
> share Casting gear with four jobs in the pool — same competition as
> tanks/healers). Phys-Ranged DPS gets `1.05`. Melee DPS — across
> Maiming, Striking, and Scouting — gets `1.10`. The exact mapping
> lives in `src/lib/ffxiv/jobs.ts` so adding a new job is a one-line
> change. A per-team or per-tier slider (Option C) is still on the
> Phase 2 wish list.

The user wants a "slight DPS preference". How slight?

**Option A — Flat 5% boost**

`role_weight = 1.05` for any DPS, `1.00` otherwise. Simple, transparent.

**Option B — Class-aware weights**

Some DPS share gear (Vipers and Ninjas use Scouting; Pictomancers, Black Mages,
Summoners, Red Mages share Casting). Tanks share Fending across four jobs.
Healers share Healing across four jobs. The "competition factor" differs.

A more nuanced weighting could be:

```
gear_role             jobs_using_it     role_weight
Fending               4 tanks           1.00
Healing               4 healers         1.00
Maiming (Str melee)   2 (DRG, RPR)      1.10
Striking              2 (MNK, SAM)      1.10
Scouting              2 (NIN, VPR)      1.10
Aiming (Phys range)   3 (BRD, MCH, DNC) 1.05
Casting               4 (BLM, SMN, RDM, PCT) 1.00
```

Pros: more accurate fairness across gear-type pools.
Cons: harder to reason about, more config.

**Option C — Per-team slider**

Single number `dps_preference_percent` editable in team settings, default 5%,
applied flat to all DPS.

**Recommendation: A in MVP, C in Phase 2.** Class-aware weighting (B) is
academically nice but the team may already be self-balancing through manual
overrides; let's not optimise prematurely.

### Topic 2: Pages / Token Tracking — Automation Level

> **Decision (2026-04-25): Option C (hybrid) plus full algorithm
> integration.** Pages are auto-derived from `boss_kill` and
> `loot_drop`; the only writable surface is `page_adjust`. Pages also
> feed into the recommendation algorithm via `effective_need`
> (see "Distribution Algorithm"): a player who can self-buy the drop
> with their existing pages is deprioritized. The token-cost lookup
> for the Heavyweight tier (Earring 3, Head 4, Body 6, Weapon 8, Glaze
> 3, Twine 4, Ester 4) is shipped as the seed `tier_buy_cost` table.

The spreadsheet tracks Spent / Current / Needed pages per player per floor
manually. We can do better.

**Option A — Manual entry only**

Mirror the spreadsheet 1:1. Three editable cells per player per floor.

**Option B — Fully derived from loot history**

Floor 1 kill → all 8 players gain 1 page towards their floor-1 token.
Spending a token (recorded in loot history) decrements pages.

**Option C — Hybrid**

Auto-derive from history; expose a `page_adjust` field for edge cases (player
joined mid-tier, missed a week, got pages from coffers, etc.).

**Recommendation: C.** Auto-derivation is the whole point, but the
`page_adjust` escape hatch is essential — the spreadsheet has it for a reason
(Peter / The Black Mage both have `-2` adjustments).

### Topic 3: Floor 4 (Weapons) Behaviour

> **Decision (2026-04-25): Option B — track without recommendations.**
> Floor 4 (`tracked_for_algorithm = false`) accepts manual loot entries
> and contributes its `boss_kill` row so HW Edition IV pages are
> counted, but the recommendation engine is skipped. Mount drops fall
> under the same path.

User said floor 4 "doesn't need to be distributed".

**Option A — Skip entirely**

Floor 4 is a hard-coded UI exclusion. No tab, no entry.

**Option B — Track without recommendations**

UI lets the raid lead log who got the weapon / coffer / mount, but no scoring.
Useful for material counters and the loot-history view to be complete.

**Option C — Track with recommendations**

Same scoring as other floors. Maybe DPS preference is even stronger here.

**Recommendation: B.** History needs to be complete (weapon coffers and pages
matter for token economics), but the actual decision-making for floor 4 is
trivial enough that the spreadsheet's "just write the name" is fine.

### Topic 4: Glaze / Twine / Ester Distribution

> **Decision (2026-04-25): Option A — same algorithm as gear, with
> page-aware `effective_need`.** Materials reuse the score machinery,
> but `base_priority = effective_need_material * 100` where
> `effective_need_material = max(0, materials_needed_for_bis -
> materials_received - floor(player_pages_for_material_floor /
> material_cost))`. Default `role_weight` for materials is `1.00` for
> everyone — materials are pure economy and DPS preference would feel
> arbitrary.

These are upgrade materials, not gear pieces, but they're contested loot.

**Option A — Same algorithm, separate `base_priority` formula**

Treat them like any drop. `base_priority = remaining_upgrades_needed * 25`,
everything else identical. Already proposed above.

**Option B — Greedy "most-needed-first" without role weighting**

Materials are pure economy. Skip role preference, just pick the player who
needs the most.

**Option C — Manual only**

Tally is shown, but no recommendation; raid lead picks.

**Recommendation: A.** Reusing the score machinery keeps the UI consistent.
Role weight on materials is debatable — could be set to 1.00 for all roles in
the per-tier config if we want it neutral.

### Topic 5: BiS Source Granularity

> **Decision (2026-04-25): Option B — keep all 8 spreadsheet sources
> including the in-jokes.** The Source enum is `Savage`, `TomeUp`,
> `Catchup`, `Tome`, `Extreme`, `Relic`, `Crafted`, `WHYYYY`, `JustNo`,
> plus a synthetic `NotPlanned` for empty cells. iLv mapping per
> source is derived from the tier's `max_ilv` (see Topic 7).

The spreadsheet has 8 sources: Savage / Tome Up / Tome / Crafted / Relic /
Catchup / WHYYYY / "Just no.". Most matter only for iLv colour-coding.

**Option A — Reduce to {Savage, TomeUp, Tome, Crafted, Relic, NotPlanned}**

Drop "Catchup", "WHYYYY", "Just no." — they're either equivalent to existing
sources or an in-joke.

**Option B — Keep all 8 with the in-jokes**

Faithful port, fun for the team.

**Option C — Per-tier configurable list**

Each tier YAML defines its own sources and iLv values.

**Recommendation: A in MVP, C in Phase 3.** "Just no." is a meme that doesn't
need to be in code. Configurable per tier is correct long-term but overkill
for v1.

### Topic 6: Recommendation Display

> **Decision (2026-04-25): Option A — Top-1 only.** The recommendation
> panel renders the single highest-scoring player with their score
> breakdown. An "Other player" button opens a flat list of the
> remaining eligible players sorted by score, where the raid leader
> can override.

How much information at the moment of decision?

**Option A — Top-1 only**

Only show the recommended player. "Override" opens a flat list to pick from.
Cleanest UI.

**Option B — Top-3 ranked, expandable**

Top-1 prominent, top-2 and top-3 visible below, "show all" expands the rest.
Each line has its score and breakdown chips.

**Option C — Full ranked list always**

All eligible players, sorted, scrollable.

**Recommendation: B.** Matches how loot-council discussions usually go: "the
suggestion is X, but Y and Z are also reasonable". Hides the cruft of
ineligible / zero-score players.

### Topic 7: Tier Rollover

> **Decision (2026-04-25): Option A (archive old tier) plus a
> tier-creation UX.** Tiers are configured *in-app*, not via YAML.
> Creating a tier asks for a single `max_ilv`; every per-source iLv,
> material cost, and floor-buy cost is derived via fixed deltas from
> that input. Operators can override individual fields if a future
> patch breaks the pattern, but the default path is one number.
>
> When a new tier is started, the old tier gets `archived_at` set;
> all loot history stays read-only for posterity, but no algorithm
> input crosses the boundary.

#### Tier Creation UX (the actual flow)

The form has one required field — `max_ilv` — and a "Defaults" panel
populated from the deltas below. Anything in the panel is editable.

```
input:           max_ilv = 795
              ┌──────────────────┬────────┬────────┐
              │ Source           │ Delta  │ iLv    │
              ├──────────────────┼────────┼────────┤
              │ Savage           │ −0     │ 795    │
              │ Tome Up          │ −5     │ 790    │
              │ Catchup          │ −10    │ 785    │
              │ Tome             │ −15    │ 780    │
              │ Extreme          │ −20    │ 775    │
              │ Relic            │ −20    │ 775    │
              │ Crafted / Prep   │ −25    │ 770    │
              │ WHYYYY           │ −30    │ 765    │
              │ Just no.         │ −40    │ 755    │
              └──────────────────┴────────┴────────┘
```

The same form also seeds the `tier_buy_cost` table with the standard
Heavyweight numbers (Earring 3, Head 4, Body 6, Weapon 8, Shield 3,
PLD-Sword 5, Glaze 3, Twine 4, Ester 4) and the four `floor` rows with
their default drop lists. Either set is editable inline.

#### Options considered

When a new tier drops, what happens to the previous one?

**Option A — Archive old tier, start fresh**

Snapshot the old tier (read-only view), all loot history preserved but
algorithm starts from scratch on the new tier.

**Option B — Continuous rolling history**

Same database, new tier just adds new floors and items. Material counters
reset; gear scoring uses only current-tier loot.

**Option C — Manual import to a new instance**

Just spin up a new container per tier.

**Recommendation: A.** Archival is the natural mental model. Loot history
shouldn't disappear, but the algorithm shouldn't penalise someone for being
lucky last tier.

---

## Pending / Future Work

### Open Items

- [ ] **xivgear.app parser** — investigate API endpoints; the URL formats observed are `?page=bis|<job>|current` (canonical BiS) and `?page=sl|<uuid>` (custom set). Need to determine if there's a JSON export endpoint or if it requires HTML scraping
- [ ] **Pages-from-history derivation** — concrete algorithm for Topic 2 Option C
- [ ] **Discord export format** — what's the team's preferred message style?

### Deferred (low priority)

- [ ] **Mobile responsive design** — explicit non-goal for v1, but might revisit if raiders ask for it
- [ ] **Real-time collaboration** — multiple raid leaders editing simultaneously is a Phoenix LiveView use case; we don't need it
- [ ] **Audit log** — only useful once auth exists (Phase 3)

### Considered and Rejected

- [ ] **AG Grid** — overkill, license complexity
- [ ] **Prisma instead of Drizzle** — heavier, slower migrations, code generation complexity
- [ ] **PostgreSQL instead of SQLite** — unnecessary for an 8-person static; SQLite WAL handles this load comfortably; keeps the deployment to one container
- [ ] **NextAuth / Auth.js** — Auth is explicitly out of scope for v1
- [ ] **Tauri desktop app** — pinning to a web app keeps multi-user viewing trivial
