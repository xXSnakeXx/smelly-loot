# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.1.0] - 2026-04-26

### Added

- **Material handling in the optimal planner.** Glaze, Twine,
  and Ester drops are now routed through the min-cost-flow
  network just like gear:
  - **Glaze** (drops on F2, cost 3 pages): fills accessory
    TomeUp needs (Earring / Necklace / Bracelet / Ring1 /
    Ring2 with `bisDesired = "TomeUp"`).
  - **Twine** (drops on F3, cost 4 pages): fills clothing
    TomeUp needs (Head / Chestpiece / Gloves / Pants / Boots).
  - **Ester** (drops on F3, cost 4 pages): fills weapon
    TomeUp needs (Weapon / Offhand).

  Each (player, slot) need is owned by exactly one floor — the
  floor where its filling item drops — so the per-floor flow
  decomposition still gives globally optimal results.

- **Mixed-cost shared page budget.** F2 has Glaze at cost 3
  and gear at cost 4; F3 has materials at 4 and gear at 6.
  The flow network now scales every edge to "1 unit of flow =
  1 page", so a shared `PageBudget` cap (= total pages over
  the horizon) correctly enforces "you can't spend 11 pages
  when you only have 8" across cost classes. Buys are
  modelled per-cost-class with their own k-counter so two
  Glazes complete at W3 and W6 (not W3 and W3 as the v3.0
  per-item-k formulation falsely showed).

- **Per-need source aggregation in the read-off.** SSP can
  legally split flow between two equally-cheap incoming edges
  (e.g., a Glaze drop in W1 may push 1.5 units to one need and
  1.5 to another). The plan UI surfaces only the dominant
  source per need (highest flow, drop preferred over buy on
  ties) so a single drop never appears as two simultaneous
  fulfilments.

- **TomeUp tagging in Plan UI.** Drop and buy cells distinguish
  Savage fulfilments from TomeUp fulfilments via colour (amber
  for TomeUp, neutral for Savage) and an explicit `(slot)` tag
  on drop chips. Buy table gains an "Item" column showing
  whether a buy is gear or material.

- 3 new unit tests in `floor-planner.test.ts` covering Glaze
  drops + buys for accessory TomeUp, the shared cost-class
  budget constraint, and Twine drops on F3.

### Changed

- `PlannedDrop` and `PlannedBuy` interfaces gain a
  `source: "Savage" | "TomeUp"` discriminator. `PlannedBuy`
  also gains an `itemKey` field describing exactly which item
  the player should buy.
- `algorithm.ts` exports `SLOTS_BY_MATERIAL`, `isMaterial`,
  `slotsForItem`, and `sourceForItem` helpers consumed by the
  planner.

### Migrations

- `0008_flush_plan_cache_v3_1.sql` — clears every tier's
  `tier_plan_cache` row on container start because pre-v3.1
  caches lack the new `source` / `itemKey` fields the UI now
  reads.

## [3.0.0] - 2026-04-26

### Changed (BREAKING)

- **Plan algorithm replaced with min-cost max-flow.** The
  greedy "score per (week, item) and award to top scorer"
  engine that powered v1.x and v2.x is gone, replaced by a
  per-floor min-cost max-flow optimiser that decides every
  drop assignment AND page-buy in a single pass against a
  single network.

  The new objective is **min-max time-to-BiS**: minimise the
  latest week any player completes their Savage BiS for the
  floor. Edge costs are squared completion-week, which
  approximates min-of-max via min-of-sum-of-squares — late
  assignments are punished super-linearly so the optimiser
  spreads work out evenly. Role weights, ilv-gain factors,
  recency penalties, and fairness factors from the v2 score
  formula are gone; the flow constraints alone enforce
  fairness (1 drop per item, 1 player can only fill a slot
  once, page balances cap purchase capacity).

  Side effect: the algorithm no longer suffers from any of
  the within-week sequencing artefacts that plagued v2:
  Bracelet spillover, item-order sensitivity, recency
  double-penalties, fully-self-served vanishing drops. They
  literally cannot occur in a single-pass formulation.

- **Plan tab now shows a buy plan alongside the drop plan.**
  In addition to "who gets which drop in which week", the
  optimiser emits an explicit "Brad should buy Bracelet
  starting W4 with 3 pages" list per floor. Page-buys are
  the natural complement to drop assignments: players whose
  needs the drops can't reach in the planning horizon are
  scheduled to self-serve with their accumulated tokens.

- **Track tab now reads from the Plan cache** instead of
  running its own per-drop scoring. The recommendation
  shown for each kill in Track is exactly the recipient the
  Plan tab computed; the two views can never disagree.

- `simulateLootTimeline`, `scoreDrop`, `scoreGear`,
  `scoreMaterial`, `computePurchasedSlots`, and the entire
  v2 utility/fairness/recency chain are removed. The
  remaining content of `algorithm.ts` is the type surface
  (`PlayerSnapshot`, `TierSnapshot`, `SLOTS_BY_ITEM_KEY`)
  imported by `floor-planner.ts` and `snapshots.ts`.

### Added

- `src/lib/loot/mcmf.ts` — generic Successive-Shortest-Path
  min-cost-max-flow solver, ~250 LOC. Graph-shape agnostic
  so the loot-specific wiring lives in `floor-planner.ts`.
- `src/lib/loot/floor-planner.ts` — per-floor network
  builder + `computeFloorPlan` entry point. Builds a flow
  network with drop nodes, page-buy nodes, and need nodes,
  solves, and reads off the optimal plan.
- 8 unit tests in `floor-planner.test.ts` and 7 in
  `mcmf.test.ts` covering the new code, including a
  regression test for the v2.5.1 Bracelet spillover scenario.

### Removed

- `src/lib/loot/timeline.ts` and its 444-LOC test file.
- All v2-era scoring tests in `algorithm.test.ts` (the
  functions they covered no longer exist).

### Migrations

- `0007_flush_plan_cache_v3.sql` — clears every tier's
  `tier_plan_cache` row on container start because the
  cache content shape changed from `TimelineForFloor[]`
  (v2) to `FloorPlan[]` (v3). The runtime also has a
  defensive shape check that recomputes if a stale cache
  somehow survived migration.

### Notes

- Per-floor decomposition is intentional: pages are
  floor-specific in FF XIV (HW-Edition-I tokens only buy F1
  gear) so solving each floor independently loses no global
  optimality and keeps each network small (~50-150 nodes,
  ~200-400 edges for an 8-player roster on 8 weeks ahead).
  Each solve runs in well under 1 ms — typically a few
  hundred microseconds.
- Materials (Glaze, Twine, Ester) are not yet planned
  through the new optimiser; they appear as unassigned
  drops on F2/F3. v3.1 will extend the network to model
  TomeUp upgrades.

## [2.5.1] - 2026-04-26

### Fixed

- **Plan tab: drops no longer "spill" into "—" within the same
  lockout.** The forward-planning simulator awards a floor's
  items sequentially; before this release, awarding the first
  item to a player mutated their `bisCurrent` so the *next*
  item's `computePurchasedSlots` saw a smaller unmet count. With
  `purchasedSlots.size === remaining_unmet` the player was
  falsely flagged "fully self-served" and got `score = 0` on
  every subsequent F1 drop in that lockout — leaving the
  recipient field as "—" even though they still wanted the item.

  Concrete reproducer (TestTier2 W4): Kaz wants Necklace and
  Bracelet, gets Necklace from the algorithm, then Bracelet
  silently dropped to "—" because Kaz' "remaining" unmet had
  collapsed to 1 == buyPower. Fix: the fully-self-served
  zero-out now bypasses when the player has already won a drop
  on this floor this week (`lastDropWeekByFloor[floor] ===
  currentWeek`). Once they've already taken their share for the
  lockout, they re-enter the competition with the standard 0.5
  purchase-discount instead of being booted entirely.

- **Recency penalty no longer punishes same-lockout sequential
  drops.** A player who legitimately wins both Necklace and
  Bracelet in the same week shouldn't be penalised for the
  second item on the basis of "you got a drop 0 weeks ago" —
  recency models multi-week patience, not in-week ordering.
  Penalty is now `0` when `weeksSince === 0`. Fairness
  (`1/(1+drops)`) already de-prioritises repeat winners over the
  course of the tier.

- Plan-tab caches from before this release are flushed
  automatically by migration `0006_flush_plan_cache_v2_5_1.sql`
  on container start — no manual `tier_plan_cache` purge
  needed when upgrading.

### Added

- `timeline.test.ts` regression test "does not spill
  fully-self-served onto later items in the same lockout
  (v2.5.1)" pins the Bracelet-after-Necklace assignment.

## [2.5.0] - 2026-04-26

### Changed

- **Inline-edit BiS matrix** is now the only Roster-tab surface.
  The previous read-only matrix + separate row-action table is
  gone; clicking any matrix cell pops a Base UI popover with two
  Selects (Desired / Current source) and saves on every change.
  No more round-trips through the per-player BiS editor for
  routine cell edits.

  Layout changes that fall out of the new design:
  - Sticky top header + sticky leftmost player column so names
    and slot codes stay anchored while scrolling a wide grid.
  - Players sorted Tank → Healer → Melee → Phys-Range → Caster
    to match the spreadsheet's row order.
  - Player column shows name + role-coloured job chip; the name
    still links to the team-level identity page.
  - Per-row "Remove from tier" lives in the rightmost cell.
  - Tier-detail container width raised from 1280 px to 1536 px
    so the full grid fits without horizontal scroll on a typical
    raid-leader monitor.

  The `RosterTable` row-action card is dropped — every action it
  hosted (jump to identity / remove from tier / per-slot BiS
  edit) is now reachable from the matrix in one or two clicks.

### Added

- New `Popover` primitive in `src/components/ui/popover.tsx`
  wrapping Base UI's anchored popup for inline editors.

## [2.4.0] - 2026-04-26

### Added

- **At-a-glance BiS matrix on the Roster tab.** The previous
  per-player BiS table required clicking into each raider to see
  what they had vs. what they wanted; the matrix solves that with
  a spreadsheet-style grid (rows = players, columns = the 11
  wearable slots). Each cell shows the desired source code on top
  ("S" Savage, "T+" TomeUp, "C" Catchup, etc.) and the current
  source underneath, colour-coded with the spreadsheet legend
  (purple = BiS achieved, amber = needs upgrade, rose = gap, ...).

  The Offhand column is omitted on purpose — only Paladins wear
  one, and a 7/8-empty column was just noise. Per-slot Offhand
  edits still happen via the per-player BiS editor at
  `/tiers/[tid]/players/[pid]`. Player names in the matrix link
  there directly so the matrix → editor → matrix loop stays
  tight.

  Backed by a new `listBisChoicesForTier(tierId)` query that
  pulls all BiS rows for the tier in one round-trip; the matrix
  builds a per-(player, slot) lookup and renders the 8 × 11 grid
  without N+1 reads. Translations gain `roster.matrix.*` in DE +
  EN.

## [2.3.0] - 2026-04-26

### Added

- **Sticky Plan tab.** The Plan-tab simulation result is now
  cached in a new `tier_plan_cache` table and only refreshes when
  the user clicks the Refresh button. Other tabs (Track, Roster,
  History) keep updating live as before; the Plan tab is
  intentionally NOT live so that casual kill-toggling, drop-
  awarding, BiS edits etc. don't reshuffle the next few weeks of
  recommendations under the operator. The cache survives server
  restarts. The button now also surfaces a "Last refreshed ..."
  timestamp so the operator can decide if the cache is still
  meaningful.

  Migration `0005` adds the cache table; tier deletion
  cascade-removes the matching cache row.

### Changed

- **Self-purchase heuristic now follows team-wide demand.** The
  v2.2 cumulative-buyPower / canonical-SLOTS-order combination
  picked a player's first unmet slot regardless of how needed
  the slot was elsewhere on the team. The new rule picks the
  slot with the highest team-wide demand first, falling back to
  canonical SLOTS order as the tiebreaker. Practical effect:
  bottleneck slots (a Ring every raider wants) clear via self-
  purchase, leaving rare wants for the actual drops.

- **Fully self-served players exit the floor competition.** When
  every slot a player wanted on a floor is covered by simulated
  self-purchase, their score for every drop on that floor goes
  to 0. The drop is then handed to a teammate with genuine
  remaining need. Reproduces the user's three-player example
  (A wants Ring; B wants Bracelet+Ring; C wants Earring+
  Bracelet+Ring; everyone has 3 pages → all buy Ring → A
  scores 0 on every Floor-1 drop, B/C compete for the rest).

## [2.2.2] - 2026-04-26

### Fixed

- **Plan tab now recommends a recipient for every droppable item.**
  Two issues with v2.2.1's page-aware purchase simulation
  collapsed onto the same surface:

  1. `computePurchasedSlots` walked `tier.buyCostByItem` in
     iteration order, which is whatever order Drizzle returns
     the rows in (alphabetical for the current build:
     Bracelet → Earring → Necklace → Ring). Every Floor-1
     player got Bracelet marked as their self-purchased slot, so
     the Bracelet drop never surfaced a recipient.
  2. The discount for a purchased slot was binary: it
     contributed 0 to `effectiveNeed`. Floor-1 items where every
     plausible recipient could self-buy (Earring + Necklace once
     each player accumulated 3 pages) ended up with no drop
     recommendation — the algorithm refused to assign anyone,
     even though in-game the drop still falls and someone has to
     take it.

  v2.2.2:
  - The purchase simulation now walks the canonical `SLOTS` list
    (Weapon → Offhand → Head → Chestpiece → Gloves → Pants →
    Boots → Earring → Necklace → Bracelet → Ring1 → Ring2). A
    Floor-1 player who wants Earring + Necklace + Bracelet is
    simulated as buying Earring first, leaving the other two
    open as drop candidates.
  - A purchased slot now contributes **0.5** to `effectiveNeed`
    instead of 0. A page-rich player still scores positive and
    will receive the drop if they're the only candidate, but
    they're consistently outranked by anyone with raw unmet
    need (which contributes 1.0 per slot).

  Plan-tab Floor 1 in TestTier2 now shows a recipient for all
  four items every week — Earring/Necklace at lower scores
  (~35-40) reflecting that those slots are page-buyable, and
  Bracelet/Ring at higher scores (~85-90) reflecting genuine
  drop need.

## [2.2.1] - 2026-04-26

### Changed

- **Page-aware purchase simulation for gear scoring.** Walks back
  the v2.2 "pages are completely separate" model — that fixed the
  Fara-style page double-counting but introduced a new bug where
  page-rich players still got drop recommendations they could
  trivially have bought.

  v2.2.1 pre-computes a per-(player, floor) set of "purchased
  slots" via `computePurchasedSlots`: pages divided by the floor's
  per-item cost gives the number of slots covered by self-
  purchase, picked in deterministic floor-item order. Any
  specific item's `effectiveNeed` only counts slots that are NOT
  in that set.

  Behaviour matrix (Floor 1, cost 3):
  - 9 pages, 1 needed item → 1 slot purchased → no drop
    recommendation (player buys it themselves).
  - 0 pages, 1 needed item → 0 slots purchased → drop is
    recommended.
  - 3 pages, 3 needed items → 1 slot purchased (first in floor
    order, e.g. Earring), the other two (Necklace, Ring) keep
    `effectiveNeed = 1` and surface as drops.

  The simulation respects FFXIV pricing within a floor (Floor 1
  gear all 3 pages, Floor 2 all 4, Floor 3 all 6). Materials are
  filtered out — they're handled by `scoreMaterial`, where pages
  are still the canonical sink (a page-rich player legitimately
  needs fewer Glaze / Twine drops because they can vendor-buy
  them).

## [2.2.0] - 2026-04-26

### Changed

- **Gear-drop scoring no longer subtracts page balances from
  effective need.** The previous formula computed
  `effectiveNeed = slotsWanting - slotsAlready - buyPower` per
  item, which had two real-world problems:

  1. Page balances were double-counted across a player's multiple
     needed items. A player with 3 Floor-1 pages who needed three
     different accessories saw `buyPower = 1` reapplied to each
     item independently — every item's effective_need dropped to
     0, so the algorithm refused to recommend any of them even
     though the player could only buy one accessory total.
  2. Pages on Floors 2/3 are spent on Glaze / Twine vendors
     (TomeUp upgrades), not on gear pieces. Letting Floor-2/3
     pages reduce gear-drop priority misrepresented the team's
     actual page economy.

  v2.2: `effectiveNeed` for gear drops is just
  `slotsWanting - slotsAlready`. Pages become a separate purchase
  track that doesn't move drop recommendations. `buyPower` is
  still computed and surfaced in the score breakdown for context.

  `scoreMaterial` keeps using `buyPower` — a page-rich player
  legitimately needs fewer Glaze / Twine drops because pages ARE
  the canonical sink for those.

  Practical effect on the Plan tab: a fresh tier with 8 players
  now distributes ~19 Floor-1 drops across an 8-week forecast
  (4, 4, 3, 3, 2, 1, 1, 1) instead of emptying out after week 2.

## [2.1.2] - 2026-04-26

### Fixed

- **Material-needs mapping on the tier-scoped player page.** The
  Glaze/Twine/Ester assignment had been carried over from the
  seed script's drop-floor layout instead of the team's upgrade
  semantics — Glaze was wired to Head/Gloves/Boots, Twine to
  Chestpiece/Pants, Ester to accessories. None of those matched
  how the team actually spends the materials.

  Corrected:
  - **Twine** → all armor (Head, Chestpiece, Gloves, Pants, Boots).
  - **Glaze** → all accessories (Earring, Necklace, Bracelet,
    Ring1, Ring2).
  - **Ester (Solvent)** → Weapon → tracked manually and no longer
    surfaced on the materials card. Same convention the algorithm
    already uses for the Floor-4 weapon drops.

  The Materials card on `/tiers/[tid]/players/[pid]` now renders
  two rows (Glaze, Twine) with the correct totals derived from
  each player's `desiredSource = "TomeUp"` slot tally.

## [2.1.1] - 2026-04-26

### Changed

- **Extreme + Crafted iLv defaults shifted up.** The team's
  reading of where these gear tiers sit relative to the Savage cap
  has changed:
  - Extreme: `max - 20` → `max - 15` (now between Catchup/Tome
    and Crafted/Relic)
  - Crafted: `max - 25` → `max - 20` (now shares iLv with Relic)

  Heavyweight (max = 790) therefore reports Extreme 775 / Crafted
  770 instead of 770 / 765. Migration `0004` updates existing
  tiers whose stored values still match the previous defaults;
  customised iLvs are preserved.

## [2.1.0] - 2026-04-26

### Added

- **Tier-scoped player-detail page** at `/tiers/[tid]/players/[pid]`.
  Hosts the BiS editor + per-floor pages stats + materials need +
  savage drop counter for the (player, tier) pair, reading the tier
  straight from the URL. Editing a player's BiS plan in an archived
  tier is now a click away from the tier's Roster tab — no fake
  "active tier" detour, no implicit context.

  The Roster table on `/tiers/[id]` links player names directly
  here so picking a player from any tier (active or archived)
  lands on that tier's plan.

### Changed

- **`/team/[id]` is now identity + tier list only.** The hero card
  shows the player's stable team-level fields (name, jobs,
  gear-link, notes) and an "Edit identity" affordance. A new
  "Tier-specific gear plans" card lists every tier the player is
  enrolled in, with a link into the new tier-scoped detail page
  for each. The BiS editor + pages/materials/savage cards move out
  of this view because they're per-tier data, not per-player.

  This makes the v2.0 model consistent end-to-end: stable identity
  belongs to the team and lives at `/team/[id]`; the tier-specific
  gear plan belongs to the tier and lives at
  `/tiers/[tid]/players/[pid]`.

- New query `listTiersForPlayer(playerId)` joins through
  `bis_choice` to find every tier a player is enrolled in. Active
  tier sorts first, then archived in reverse-creation order to
  match the dashboard's tier grid.

### Fixed

- Translations: `roster.*` and `team.roster.*` namespaces missing
  from `de.json` are filled in (the keys were silently falling
  back to English at runtime).

## [2.0.1] - 2026-04-26

### Fixed

- **Player-detail route 404 after the v2.0 move.** The new Roster
  table on `/tiers/[id]` and the team-roster table on `/team` link
  the player name to `/team/[id]`, but the v2.0 release shipped
  without actually creating that route — clicking a player name
  hit a 404. Moved the existing `/players/[id]` page (BiS table,
  pages stats, materials, savage drops) over to `/team/[id]` and
  left the legacy path as a 308-redirect for any pre-v2 deep
  links.

## [2.0.0] - 2026-04-26

### Breaking changes

- **Players are team-scoped again.** v1.4 made each tier own its
  own copy of every raider; v2.0 walks that back. A raider's stable
  identity (name, main job, alt jobs, gear-tracker URL, notes)
  doesn't change between tiers and now lives in a single `player`
  row keyed by `team_id`. Per-tier data — the BiS plan and the
  loot history — moves to `bis_choice.tier_id`, with a new
  `(player_id, tier_id, slot)` composite primary key.

  Migration `0003_team_scoped_players_with_tier_bis` ports existing
  rows: duplicate `(name, main_job)` players from previous tiers
  collapse onto the youngest canonical id; the original
  `bis_choice.tier_id` is back-filled from each player's
  pre-migration `tier_id`; `loot_drop.recipient_id` and
  `page_adjust.player_id` are remapped through the same dedup map
  so historical loot stays attached to the canonical players.

- **Tier membership is implicit.** A player IS in a tier iff at
  least one `bis_choice` row exists for the (player, tier) pair —
  there is no separate membership table. Adding a player to a tier
  stamps the 12-slot Crafted-baseline default BiS plan; removing
  them deletes those rows. Loot history they accrued in the tier
  stays attached.

### Added

- **`/team` master-roster page.** Top-level Top-Nav entry next to
  the brand. Lists every player on the team and lets you add /
  edit / delete the stable-identity fields (name, jobs, gear-link,
  notes) once instead of 8x per rollover. Adding a player here
  does NOT auto-enrol them into any tier — that's now an explicit
  per-tier action.

- **Tier-detail Roster tab.** Replaces the v1.4 Players tab. Shows
  the players currently in the tier (= those with `bis_choice`
  rows for it), with per-row "remove from tier" and a top-right
  "Add players" dialog that multi-selects from the team players
  not yet in the tier. The add action stamps the Crafted-baseline
  default BiS plan for each selection.

- **`/team/settings`.** Team rename + default-locale form moves
  from the (now-repurposed) `/team` route. The Settings cog in the
  top-bar links here.

- **Auto-roster on tier creation.** `createTierAction` now reads
  the team-level player list and stamps the 12-slot
  Crafted-baseline default BiS plan for every team player on the
  new tier. The tier comes up with a complete roster from the
  start; pruning happens via the Roster tab if a particular tier
  won't include everyone.

### Changed

- **`createPlayerAction`** takes a `teamId` instead of a `tierId`.
  Tier membership is granted explicitly via
  `addPlayerToTierAction`.
- **`saveBisChoice`** requires a `tierId` for the new composite
  key; the upsert target is `(playerId, tierId, slot)`.
- **`listBisChoicesForPlayer(playerId, tierId)`** filters by tier
  so the BiS table on the player-detail page renders the active
  tier's plan.
- **`/players` and `/players/[id]`** redirect to `/team` and
  `/team/[id]` respectively.
- **Loot tabs** rename `Players` → `Roster` in DE + EN.

### Removed

- **`PlayersView`, `players/PlayersTable`** etc. on the tier-detail
  page — replaced by `RosterView`, `RosterTable`,
  `AddPlayersToTierDialog`. The CRUD components for stable identity
  move under `/team/_components/`.
- **Tier-rollover roster copy.** v1.4's
  "copy the source tier's roster onto the new tier" branch is
  gone; the new tier's roster derives from the team-level player
  list directly.

## [1.5.0] - 2026-04-25

### Fixed

- **Plan tab and Track tab now agree on the active-week's drops.**
  The Plan-tab simulator was scoring its first iteration against
  `currentWeek + 1` and incrementing every floor's page count
  unconditionally. That double-counted the active-week kill (the
  `boss_kill` row already increments pages via the live snapshot,
  so the simulator's own `+1 page` step was redundant). Result:
  Plan-Week-1 ranked the players differently from Track for the
  same drop, and the team got two inconsistent answers for the
  same kill.

  The simulator now accepts an `alreadyKilledFloors` option naming
  the floors whose active-week kill is already in the input
  snapshot. Those floors skip the `+1 page` step on iteration 0
  only — from iteration 1 onward the kill is purely simulated and
  the simulator always increments. The Plan tab passes
  `currentWeek` (not `+1`) and the floors it has live kills for,
  so its first-iteration scoring now matches `scoreDrop` exactly.

  Three new unit tests in `src/lib/loot/timeline.test.ts` lock the
  parity in.

### Added

- **Default BiS rows on every new player.** Fresh player rows used
  to land in the database without any `bis_choice` siblings, so
  the BiS table rendered empty and the algorithm had no gear-gap
  to score against until the user manually picked a current source
  for every slot on every player. `createPlayerAction` now stamps
  12 `bis_choice` rows on each new player: `currentSource =
  "Crafted"` for every wearable slot, `desiredSource =
  "NotPlanned"` so the algorithm doesn't recommend any drops
  until the team explicitly picks targets. Offhand stays
  `NotPlanned` for non-PLD jobs (they never see an offhand drop).

  The same defaults apply to players copied over by
  `createTierAction` during a tier rollover — the previous tier's
  BiS plans deliberately don't carry over (a new tier means a new
  max iLv, the team replans), but the table now renders with the
  canonical Crafted baseline instead of empty rows.

  Helper `defaultBisChoicesForJob` lives in
  `src/lib/ffxiv/bis-defaults.ts` and is covered by 5 unit tests.

## [1.4.2] - 2026-04-26

### Fixed

- **BiS edits and page-adjust saves now invalidate every tier-scoped
  surface.** Both Server Actions previously revalidated only the
  narrow per-player route they originated from (`/players/[id]`,
  plus a stale `/loot` in the page-adjust case — that path has
  been a redirect since v1.2.0). Both inputs feed the algorithm's
  `effective_need` / current-source lookups the Plan tab consumes,
  so a BiS edit in one browser tab left the Plan tab in another
  tab showing the pre-edit recommendation until the next hard
  navigation. Both actions now call
  `revalidatePath("/", "layout")` to match the player CRUD
  actions, which invalidates every tier-scoped page in one
  round-trip.

A new Playwright spec (`e2e/bis-edit-refreshes-plan.spec.ts`)
locks the auto-refresh in: it edits a player's Weapon desired
source to `NotPlanned` and asserts the Plan tab no longer routes
Weapon drops to that player.

## [1.4.1] - 2026-04-26

### Added

- **Manual refresh button on the Plan tab.** The plan re-computes
  automatically whenever a Server Action fires (kill toggles, drop
  awards, BiS edits, page-adjust saves, roster changes, tier
  settings) — but direct DB edits or activity in another browser
  tab don't trip Next.js's revalidation. The new
  `<RefreshButton>` calls `router.refresh()` to re-fetch the RSC
  payload and recompute the plan against the latest snapshot.
  Spins its icon while pending. An accompanying Playwright spec
  (`e2e/plan-refresh-button.spec.ts`) locks the click → spinner →
  enabled loop in.

## [1.4.0] - 2026-04-25

A pivot to a tier-centric data model. Players, BiS plans, page
balances, and loot history now all hang off a tier — every tier is
its own self-contained universe of rosters and progression.

### Changed

- **Players are tier-scoped.** `player.team_id` →
  `player.tier_id` (Drizzle migration `0002_tier_scoped_players`).
  "Brad in Heavyweight" and "Brad in Cruiserweight" are formally
  separate identities; cross-tier history is recoverable via
  `player.name` joins instead of a stable foreign key. The
  migration backfills `tier_id` from each player's strongest
  signal — the tier with the most `page_adjust` rows — falling
  back to the team's earliest-created tier for players who never
  raided.
- **Players is now a tab inside the tier detail.** The dashboard's
  tier card opens straight onto the Players tab (Players / Plan /
  Track / History / Settings, in that order). The top nav drops
  the global Players link; the dashboard's tier grid is the
  canonical entry point for everything tier-scoped.
- **Dashboard tier card** picks up a Players column in the stats
  row alongside Status / Weeks / Kills.

### Added

- **`createTierAction` copies the previous tier's roster** into
  the new tier when the plus card is clicked. Player rows
  (name / mainJob / altJobs / gearLink / notes / sortOrder)
  duplicate; BiS plans / page balances / loot history start fresh.
- **`createPlayerAction`** now takes a `tierId` so the New player
  dialog stamps the hidden field automatically — no more "active
  tier" lookup behind the scenes.
- **`TierStats.players`** counts the roster size per tier.

### Routing

- `/players` redirects to `/tiers/[active.id]` (the Players tab is
  the default), so bookmarks keep working.

## [1.3.2] - 2026-04-25

### Fixed

- **Dashboard plus-card now opens the New tier dialog.** The
  trigger silently swallowed clicks because Base UI's
  `DialogPrimitive.Trigger` merges its open-handlers onto the
  element passed via the `render` prop, but the wrapper component
  it was nested in didn't spread those props onto the inner
  `<button>`. The plus-card markup is now inlined directly inside
  `NewTierDialog`, so the merged props land on a real DOM node and
  the dialog opens reliably. Two Playwright specs lock in the
  regression (`e2e/new-tier-dialog.spec.ts` for the open gesture,
  `e2e/new-tier-submit.spec.ts` for the full create-and-redirect
  flow).
- The dialog's default `maxIlv` now reads 790 (matching the
  corrected Heavyweight cap from v1.2.2) instead of 795.

## [1.3.1] - 2026-04-25

### Fixed

- Imported historical drops are now marked
  `picked_by_algorithm = true` so the History tab no longer paints
  every imported row with a noisy "manual override" badge. There
  was no algorithm running at the time those distributions
  happened, so flagging them as overrides was both visually noisy
  and semantically wrong. Future drops awarded via the in-app flow
  still record the real algorithm-vs-pick distinction the badge
  was designed for.

## [1.3.0] - 2026-04-25

### Added

- **Full Heavyweight loot history import.** The `import:tier`
  script now reproduces the spreadsheet's "Heavyweight Loot" tab
  in addition to the gear tracker:
  - 13 raid weeks with kills derived from per-week recipient
    activity. Totals: F1=13, F2=12, F3=9, F4=2.
  - 138 loot drops across the four floors. The dashboard's tier
    card and the per-player Savage-drops counter populate
    accordingly, and the tier-detail History tab now shows the
    full week-by-week distribution.
  - Drops awarded outside the static (PUG, dropped to floor) land
    as `recipient_id = NULL` and surface as "—" in the History
    tab, matching the spreadsheet's `(Other)` entries.
  - Page-token, F4 coffer, F4 chestpiece-from-coffer, and Mount
    columns are intentionally skipped — they're outside our
    `ITEM_KEYS` schema.

### Changed

- Player **The Black Mage → Brad** (DB rename).
  The gear tracker tab used "The Black Mage" as a placeholder
  joke name; the loot tab uses the canonical character name. The
  rename is run automatically by the import script and is
  idempotent (no-op once it has happened).
- The import script's `raid_week` / `boss_kill` / `loot_drop`
  steps are now **destructive on re-run**: they delete every row
  scoped to the active tier before re-importing so the
  spreadsheet stays the single source of truth. `bis_choice`,
  `page_adjust`, and `player` rows are still upserted (UI edits
  between runs survive).

## [1.2.2] - 2026-04-25

### Changed

- **Cascade deltas corrected** for `TomeUp` (-5 → 0) and `Tome`
  (-15 → -10). Per the spreadsheet legend the upgraded tome piece
  reaches the same iLv as the raw Savage drop, and the
  non-upgraded weekly tome cap shares its iLv with the Catchup
  pool. The active Heavyweight tier now reads:
  - Savage  790
  - TomeUp  790
  - Catchup 780
  - Tome    780
  - Extreme 770, Relic 770, Crafted 765, WHYYYY 760, JustNo 750

  The `bis_status` colour legend keeps working unchanged — the
  "near-max / intermediate / behind / significant-gap" thresholds
  are gap-driven (≤5 / ≤10 / ≤20 / >20) so the slimmer cascade
  spread reads the same.

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
