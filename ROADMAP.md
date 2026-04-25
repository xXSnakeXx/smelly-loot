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
// drizzle schema (sketch)

team(id, name, locale, created_at)

player(
  id, team_id, name, main_job, alt_jobs JSON,
  gear_link, notes, page_adjust, sort_order, created_at
)

// per-player BiS plan: which source they want for each slot
bis_choice(
  player_id, slot,                 // PK
  source                            // Savage | TomeUp | Tome | Crafted | Relic | Catchup | NotPlanned
)

// tier definition (loaded from YAML config)
tier(id, name, ilv_savage, ilv_tome_up, ilv_tome, ilv_crafted, ...)

floor(id, tier_id, number, drops JSON, tracked BOOLEAN)
// e.g. tier="Arcadion Heavyweight", number=2, drops=["Head","Gloves","Boots","Glaze"]
// floor.tracked = false for floor 4 (mount/coffer not algorithm-driven)

raid_week(id, team_id, week_number, started_at)

// every recorded drop, whether the algorithm picked it or the user overrode
loot_drop(
  id, raid_week_id, floor_id, item, slot_or_material,
  recipient_id, picked_by_algorithm BOOLEAN, score_snapshot JSON, notes
)
```

Slot enum (fixed):
`Weapon, Offhand, Head, Chest, Gloves, Pants, Boots, Earring, Neck, Bracelet, Ring1, Ring2`

Source enum (mirrors the spreadsheet's "Legend"):
`Savage (795), TomeUp (790), Tome (780), Crafted (770), Extreme (775), Relic (770), Catchup (780), NotPlanned`

Material enum: `Glaze, Twine, Ester` (consumable upgrades).

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
| `base_priority`   | 100 if the slot's BiS source is `Savage`; 40 if `TomeUp` (token usable as page); 0 otherwise |
| `role_weight`     | 1.05 for DPS, 1.00 for Tank / Healer (slight preference, see Topic 1)              |
| `ilv_gain_factor` | `(desired_ilv - current_ilv) / 10`, clamped to `[0.5, 3.0]`                        |
| `fairness_factor` | `1 / (1 + savage_drops_received_this_tier)`                                        |
| `recency_penalty` | `max(0, (4 - weeks_since_last_drop_from_this_floor)) * 5`                          |

For **upgrade materials** (Glaze / Twine / Ester) the formula reuses the same
shape but `base_priority` becomes:
`base_priority = remaining_upgrades_needed * 25`
where `remaining_upgrades_needed` is computed from the player's BiS choices and
their loot history.

Tiebreakers, in order:

1. Player with the oldest "last drop" timestamp.
2. Random with a deterministic seed (raid week id + floor id + item).

Output for the UI: a sorted list of `(player, score, breakdown)` tuples. The
top entry is the recommendation; the rest are shown collapsed. The
`score_snapshot` is persisted on the loot drop, so historical recommendations
remain reproducible even if the algorithm changes later.

---

## Phase 0: Project Setup

Goal: a runnable, dockerised "Hello world" with the toolchain wired up.

- [ ] `pnpm create next-app` with App Router, TS strict, Tailwind
- [ ] Install and init shadcn/ui (`button`, `input`, `dialog`, `table`, `toast` to start)
- [ ] Install Drizzle + libSQL client; first migration creates an empty `team` table
- [ ] `next-intl` setup with `de.json` / `en.json` and a top-bar language switcher
- [ ] Biome config; pre-commit hook via simple-git-hooks
- [ ] Vitest config + first dummy test; Playwright skeleton
- [ ] `Dockerfile` (multi-stage) and `docker-compose.yml` mounting `./data`
- [ ] `.env.example`, `.gitignore`, `LICENSE` (MIT), `README.md`, `CHANGELOG.md`
- [ ] Public GitHub repo `xXSnakeXx/smelly-loot`
- [ ] Initial commit on `main`, tag `v0.0.1`

Acceptance: `docker compose up -d` opens an empty page on `localhost:3000` in
DE or EN; tests pass; lint clean.

---

## Phase 1: MVP

Goal: parity with the spreadsheet + automated recommendations. Single team,
single tier, no auth.

### 1.1 Team & Player Management

- [ ] Single team auto-created on first run, name editable
- [ ] Player CRUD: name, main job, alt jobs, gear link (plain text in v1), notes, `page_adjust`
- [ ] Sortable order (drag handles in the table for the raid leader)
- [ ] Job dropdown with all 21 FF XIV combat jobs grouped by role

### 1.2 BiS Tracker

- [ ] Per-player gear table with 12 rows (one per slot) and columns `Desired source`, `Current source`, `Date received`, `Markers`
- [ ] Markers from the spreadsheet (📃 paid with pages, 🔨 will craft, ◀️ next upgrade, 💾 save token, 💰 bought via tomes/etc.)
- [ ] iLv computed from source via tier config
- [ ] Conditional cell colours matching the spreadsheet legend (purple/blue/green/yellow/white/red)

### 1.3 Tier Configuration

- [ ] Tier YAML files under `configs/tiers/*.yml`
- [ ] First config: `arcadion_heavyweight.yml` with floors 1-3 active, floor 4 tracked-only
- [ ] Loaded at startup, hot-reload in dev
- [ ] Materials (Glaze / Twine / Ester) configurable per tier (some tiers might rename them)

### 1.4 Loot Distribution

- [ ] "New raid week" button on the dashboard
- [ ] Per floor: a row of drop slots; clicking one opens the recommendation panel
- [ ] Recommendation panel shows top-1 prominently, top-3 below, "show all" expands the rest
- [ ] Each entry: player name, score, breakdown chips (BiS / iLv gain / fairness / recency)
- [ ] One-click accept; `Cmd+Enter` accepts top entry
- [ ] Override = pick any other player; system records it as `picked_by_algorithm=false`
- [ ] After all drops are assigned: weekly summary card shows what was distributed

### 1.5 Material Tally

- [ ] Live counter per player: Glaze / Twine / Ester needed vs received
- [ ] Auto-derived from BiS plan + loot history
- [ ] Spreadsheet-style symbols: 💍, 👢, etc. for Glaze; counter chips for Twine

### 1.6 Pages Counter

- [ ] Per-player, per-floor: spent / current / needed (mirror spreadsheet)
- [ ] `page_adjust` field for missed weeks
- [ ] Highlighted in yellow/bold for player with the most pages still needed

### 1.7 History Views

- [ ] Per-player gear timeline (when did they get what)
- [ ] Per-week loot grid (clone of spreadsheet's loot tab) — TanStack Table with frozen header
- [ ] Both views read-only; corrections require editing the underlying loot drop

### 1.8 Polish

- [ ] DE / EN translation parity
- [ ] Dark mode (Tailwind class strategy)
- [ ] Keyboard shortcuts: `1-4` switch floors, `n` new week, `?` help overlay
- [ ] Toast notifications for save / override actions

Acceptance for v1.0.0: replicate one full historical week from the spreadsheet
(week 5 from the linked sheet is a good fixture) and confirm the algorithm
recommends the same recipients OR the divergence is justified by the
breakdown.

---

## Phase 2: Enhancements

Goal: convenience features that move the workflow beyond the spreadsheet.

- [ ] **xivgear.app link import** — paste link, automatically populate BiS sources per slot. Investigate API / format first; fallback gracefully if format changes.
- [ ] **Score breakdown tooltip** — hovering any score line in the recommendation panel shows the full numeric calculation
- [ ] **Markdown / Discord export** — copy the week's distribution as a formatted message ready to paste in Discord
- [ ] **Pages auto-tracking** — derive spent / current pages from loot history, no manual entry
- [ ] **What-if mode** — drag a drop to a different player, see how it affects future recommendations
- [ ] **Quick-search command palette** (`Cmd+K`) — "assign earring to Quah", "open week 5", "set Rei boots desired = TomeUp"
- [ ] **Bulk BiS edit** — paste a TSV row to set all 12 slots at once for fast onboarding

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
