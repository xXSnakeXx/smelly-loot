# Algorithm State — Snapshot v4.2.0 (2026-04-26)

Dieser Snapshot dokumentiert den aktuellen Stand des Greedy-Planners
und die offenen Design-Entscheidungen. Wird bei jedem grösseren
Algorithmus-Release aktualisiert. Wenn etwas am Algorithmus
schief läuft oder eine Frage zum Verhalten aufkommt, ist dies
das **canonical reference document** — alles Wichtige steht hier.

## TL;DR — wo wir stehen

- **Algorithmus**: Bottleneck-aware Greedy in `src/lib/loot/greedy-planner.ts`
  (v4.2.0). Ersetzt das v3.x MCMF komplett.
- **Plan-Stickyness**: ja, seit v4.0.1.
- **Tier-Counter** als primäre Fairness-Mechanik (v4.1.0).
- **Frozen Buys** seit v4.1.0 — Plan-Cache friert die Buy-Liste
  beim ersten Lauf ein, Refresh berührt nur Drops.
- **Diagonal Bottleneck-Distribution** seit v4.2.0: ein 3-Glaze-
  Spieler dominiert nicht mehr 3 Wochen am Stück, weil der
  Bottleneck-Score mit jedem gewonnenen Drop sinkt.
- **`bossKillIndex` pro Drop** seit v4.2.0 — Track mappt die
  tatsächliche Kill-Reihenfolge des Operators auf die
  Plan-Empfehlungen, nicht mehr auf absolute Wochen-Nummern.
- **Tests**: 44/44 green.

## Was der Algorithmus tut

Der Greedy-Planner simuliert Wochen-für-Wochen bis alle Spieler
ihre BiS-Slots gefüllt haben. Pro Woche, pro Boss, in dieser
Reihenfolge:

1. **Drop-Phase** — Items werden in **Roster-Need-Reihenfolge**
   absteigend iteriert (Bottleneck zuerst; Ties via
   `floor.itemKeys` Order). Pro Item:
   - Kandidaten = Spieler mit offener BiS-Slot für dieses Item.
   - **Score** (höher = besser), zwei Regimes:
     ```
     bottleneck_score(p, item)     = open_count_for_item(p, item) * 100
     nonbottleneck_score(p)        = -K_COUNTER * tier_drop_count(p)
     ```
     - Bottleneck-Score nutzt seit v4.2 den **aktuellen** open-
       Count des Spielers für das spezifische Item, nicht den
       initialen Floor-Need. Ein Spieler mit 3 offenen
       Glaze-Slots scored 300 in W1, dann 200 in W2 (nach
       Glaze-Win), 100 in W3 — der Score zerfällt mit jedem
       Drop, der ihn bedient. → Diagonal-Distribution.
     - Counter (`tier_drop_count`) wird **nicht** im
       Bottleneck-Score berücksichtigt: ein Spieler mit hohem
       Need-Count bekommt seinen Bottleneck-Drop, auch wenn er
       schon andere Drops in diesem Tier hatte.
     - Non-Bottleneck-Score ignoriert Need-Count komplett —
       nur der Counter bestimmt die Verteilung. Spieler mit
       niedrigstem Counter unter den Bedürftigen gewinnt.
   - Spieler mit höchstem Score gewinnt (Tie-Break: erste
     Iteration, also Reihenfolge in `snapshots`).
   - **Counter-Update**: jeder Drop (auch Bottleneck) erhöht
     den Counter um 1. Buys nicht.

2. **Page-Akkumulation** — jeder Spieler kriegt +1 Page für
   diesen Boss (außer in W1 wenn der Boss schon gekillt wurde).

3. **Buy-Phase** — Spieler sortiert nach descending
   `open_slots_at_boss`, dann pro Spieler:
   - `pickBuyItem` priorisiert in Reihenfolge:
     1. Bottleneck-Item, falls der Spieler es noch braucht.
     2. Item mit höchstem aktuellen Roster-Need, das der
        Spieler noch braucht.
   - Pages werden abgezogen, BiS-Slot gefüllt. **Buys erhöhen
     den Tier-Counter NICHT**.

4. **`bossKillIndex` (v4.2)** — pro Floor wird ein 1-basierter
   Counter geführt, der bei jeder Simulationsiteration um 1
   inkrementiert. Jeder `PlannedDrop` und `UnassignedDrop`
   bekommt diesen Index mitgegeben. Die Track-Tab nutzt das,
   um die tatsächliche Kill-Reihenfolge des Operators auf die
   Plan-Empfehlungen zu mappen — wenn Boss 2 in W1 übersprungen
   und in W2 zum ersten Mal gekillt wird, zeigt Track die
   Plan-Empfehlung für `bossKillIndex=1`, nicht die für die
   absolute W2.

**Bottleneck pro Boss** wird **einmalig zu Plan-Start** berechnet
als `argmax(item, total_roster_open_need)` und für die ganze
Tier-Laufzeit fix gehalten. Begründung: stabile, erklärbare Pläne.

**While-Loop** läuft bis kein Spieler mehr offene Slots hat oder
ein 50-Wochen-Safety-Cap erreicht ist.

**Tier-Counter (v4.1)**: Persistiert in
`tier_player_stats(tier_id, player_id, drop_count)`. Server
Actions halten den Counter konsistent:
- `awardLootDropAction`: +1 auf Drops, 0 auf Buys.
- `undoLootDropAction`: -1 auf Drops, clamped 0.
- `editLootDropAction`: -1 alter Empfänger, +1 neuer (nur
  Drops).
- `resetRaidWeekAction`: per-Spieler-Decrement matching der
  gelöschten Drops.

**`K_COUNTER = 50`** (default). Ein 1-Drop-Unterschied flippt
Tie-Breaks; ein 4-Drop-Unterschied schließt einen Spieler
faktisch aus, bis andere aufgeholt haben.

## Plan-Stickyness (v4.0.1)

Der `tier_plan_cache` wird **nicht** automatisch nach Loot-Actions
invalidiert. Konkret:

- `awardLootDropAction` (drop / buy) → cache bleibt
- `undoLootDropAction` → cache bleibt
- `editLootDropAction` → cache bleibt
- `recordBossKillAction` / `undoBossKillAction` → cache bleibt
- `resetRaidWeekAction` → cache **wird** geflusht (explizite Operator-Aktion)
- Refresh-Button → cache wird geflusht und neu gerechnet

**Konsequenz**: Track-Tab zeigt während der Verteilung dieselben
Empfehlungen über die ganze Woche. Awarded Items werden direkt
aus `loot_drop` rendered ("Awarded: X"), Empfehlungen kommen
aus dem (sticky) Plan.

**Doppel-Klick-Schutz**: Plan-Tab Buy-Button checkt
`assignedBuyKeys` (Set von `${recipientId}|${itemKey}` für
`paid_with_pages=true` drops der aktuellen Woche) und rendert
"Done"-Badge wenn schon vergeben.

## Frozen Buys (v4.1.0)

`tier.frozen_buys` (JSON-Spalte, nullable) speichert die beim
ersten Plan-Lauf berechnete Buy-Liste. Subsequent refreshes
recomputen **nur** die Drops und re-using die persistierten Buys
(gefiltert um schon vergebene Items, weil `bisCurrent` nach
auto-equip aktualisiert wurde).

**Refreeze-Button** im Tier-Settings: setzt `frozen_buys = NULL`
und invalidiert den Plan-Cache, sodass beim nächsten Render eine
frische Buy-Liste aus dem aktuellen Zustand entsteht.

## `bossKillIndex` Lookup (v4.2.0)

**Plan-Seite**: jeder `PlannedDrop` und `UnassignedDrop` hat
ein 1-basiertes `bossKillIndex`-Feld, das im Simulator pro
Floor inkrementiert wird.

**Track-Seite**: die `track-view.tsx` baut den Lookup-Key als
`${floorNumber}|${bossKillIndex}|${itemKey}` (statt früher
`${weekNumber}`). Der `currentBossKillIndex` für den aktuellen
Boss-Kill berechnet sich aus
`countPriorBossKillsByFloorForTier(tierId, currentWeekNumber) + 1`.

**Konsequenz**: wenn der Operator Boss 2 in W1 überspringt und
ihn in W2 zum ersten Mal killt, zeigt Track die Plan-Empfehlung
für "Boss-2-kill 1" — nicht für die W2-Position aus dem Plan.

## Architektur

```
DB:
  bis_choice           (player_id, tier_id, slot, desired_source, current_source)
  loot_drop            (raidWeekId, floorId, itemKey, recipientId, paidWithPages, ...)
  boss_kill            (raidWeekId, floorId)
  raid_week            (id, tier_id, weekNumber, startedAt)
  page_adjust          (player_id, tier_id, floor_number, delta)
  tier                 (id, name, max_ilv, ilv_*, frozen_buys, ...)
  tier_buy_cost        (tier_id, item_key, floor_number, cost)
  tier_plan_cache      (tier_id, snapshot, computed_at)
  tier_player_stats    (tier_id, player_id, drop_count)

Loot Module (src/lib/loot/):
  algorithm.ts         Shared types: PlayerSnapshot, TierSnapshot, item↔slot mapping
  snapshots.ts         DB → algorithm-input adapters (loadPlayerSnapshots etc.)
  greedy-planner.ts    The planner: computeGreedyPlan(floors, snapshots, tier, options)
  plan-cache.ts        Cache layer: refreshPlan / getCachedOrComputePlan / invalidatePlanCache
  actions.ts           Server Actions (award / undo / edit / reset / record-kill)
  schemas.ts           Zod validation for the Server Actions

UI (src/app/[locale]/):
  loot/_components/
    timeline-plan.tsx          Plan tab (drops grid + buys table)
    buy-assign-button.tsx      "Vergeben" button on Plan-tab buy rows
    drop-card.tsx              Track tab card per dropped item
    refresh-button.tsx         Plan tab refresh trigger
  tiers/[id]/
    page.tsx                   Tier detail page (entry point)
    _components/track-view.tsx Track tab (per-floor drop cards)
    _components/history-view.tsx
```

## Bekannte Trade-offs in v4.2.0

### Trade-off 1: Plan-Stickyness vs. Plan-Aktualität

Mit v4.0.1 ist der Plan sticky. Konsequenz: wenn der Operator
einen Drop manuell an einen anderen Spieler vergibt als der Plan
empfohlen hat, bleibt die Plan-Empfehlung visuell stehen. Track
zeigt korrekt "Awarded: X", aber Plan zeigt weiter "Recommended:
Y". Ist nicht funktions-kritisch, aber UX-Verbesserung möglich:

- Plan-Tab könnte awarded-state visuell highlighten (Strikethrough
  + Tooltip "in Track an Z vergeben").

### Trade-off 2: Bottleneck konstant vs. dynamisch

Bottleneck pro Boss wird einmal beim Plan-Start berechnet. Wenn
sich das Need-Profil über Zeit dramatisch ändert (z.B. alle Ring-
Bedürftigen sind nach W5 versorgt, aber Bracelet ist immer noch
knapp), bleibt der Bottleneck weiter "Ring". Buy-Phase fällt
auf Priorität-2-Logik zurück (höchster aktueller Roster-Need),
also ist das in der Praxis kein Problem — aber ein Refresh nach
massiven Änderungen (z.B. neuer Spieler mit anderem BiS-Profil)
würde den Bottleneck nicht neu rechnen.

### Trade-off 3: Counter-Asymmetrie ist ein Design-Punkt, kein Bug

Bottleneck-Drops **erhöhen** den Counter, werden aber **nicht
bestraft** durch ihn. Diese Asymmetrie ist gewollt: Hoch-Need-
Spieler sollen ihren Bottleneck-Drop bekommen, dafür aber in
nachfolgenden Non-Bottleneck-Verteilungen "bezahlen" (höherer
Counter → niedrigerer Score in Non-Bottleneck-Regime).

## Releases & Tags

| Version | Datum      | Highlight                                              |
|---------|------------|--------------------------------------------------------|
| v3.3.1  | 2026-04-26 | MCMF cycle-guard fix                                   |
| v4.0.0  | 2026-04-26 | Greedy-Planner ersetzt MCMF (BREAKING; Tier-Reset)     |
| v4.0.1  | 2026-04-26 | Plan-Stickyness; BuyAssign Done-Badge                  |
| v4.1.0  | 2026-04-26 | Bottleneck/Non-Bottleneck-Score split, Tier-Counter, Frozen Buys |
| v4.2.0  | 2026-04-26 | Diagonal Bottleneck (decaying score), `bossKillIndex` lookup |
