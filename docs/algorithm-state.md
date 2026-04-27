# Algorithm State — Snapshot v4.0.1 (2026-04-26)

Dieser Snapshot dokumentiert den aktuellen Stand des Greedy-Planners
und die offenen Design-Entscheidungen. Wird bei jedem grösseren
Algorithmus-Release aktualisiert. Wenn etwas am Algorithmus
schief läuft oder eine Frage zum Verhalten aufkommt, ist dies
das **canonical reference document** — alles Wichtige steht hier.

## TL;DR — wo wir stehen

- **Algorithmus**: Bottleneck-aware Greedy in `src/lib/loot/greedy-planner.ts`
  (v4.0.0). Ersetzt das v3.x MCMF komplett.
- **Plan-Stickyness**: ja, seit v4.0.1. Drop / Buy / Undo / Edit
  invalidieren den Plan-Cache nicht mehr. Nur Refresh-Button und
  Reset-Week tun das.
- **Tests**: 38/38 green.
- **Zustand**: "macht grundsätzlich was er soll" (User, 2026-04-26).
  Es fehlen kleine Anpassungen — siehe "Open design decisions"
  unten.

## Was der Algorithmus tut

Der Greedy-Planner simuliert Wochen-für-Wochen bis alle Spieler
ihre BiS-Slots gefüllt haben. Pro Woche, pro Boss, in dieser
Reihenfolge:

1. **Drop-Phase** — für jedes Item das der Boss droppt (in fester
   `floor.itemKeys` Reihenfolge, z.B. `Earring → Necklace →
   Bracelet → Ring`):
   - Kandidaten = Spieler mit offener BiS-Slot für dieses Item.
   - Score (höher = besser):
     ```
     score = 100 * open_slots_at_boss(p)
           -  50 * received_this_week(p)        // intra-week fairness
           -   5 * received_this_tier(p)        // anti-streak
     ```
   - Spieler mit höchstem Score gewinnt.

2. **Page-Akkumulation** — jeder Spieler kriegt +1 Page für diesen
   Boss (außer in W1 wenn der Boss schon gekillt wurde, das ist
   schon im Snapshot).

3. **Buy-Phase** — Spieler sortiert nach descending
   `open_slots_at_boss`, dann pro Spieler:
   - `pickBuyItem` priorisiert in Reihenfolge:
     1. Bottleneck-Item, falls der Spieler es noch braucht.
     2. Item mit höchstem aktuellen Roster-Need, das der Spieler
        noch braucht.
   - Pages werden abgezogen, BiS-Slot gefüllt.

**Bottleneck pro Boss** wird **einmalig zu Plan-Start** berechnet
als `argmax(item, total_roster_open_need)` und für die ganze
Tier-Laufzeit fix gehalten. Begründung: stabile, erklärbare Pläne.

**While-Loop** läuft bis kein Spieler mehr offene Slots hat oder
ein 50-Wochen-Safety-Cap erreicht ist.

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

## Architektur

```
DB:
  bis_choice           (player_id, tier_id, slot, desired_source, current_source)
  loot_drop            (raidWeekId, floorId, itemKey, recipientId, paidWithPages, ...)
  boss_kill            (raidWeekId, floorId)
  raid_week            (id, tier_id, weekNumber, startedAt)
  page_adjust          (player_id, tier_id, floor_number, delta)
  tier                 (id, name, max_ilv, ilv_*, ...)
  tier_buy_cost        (tier_id, item_key, floor_number, cost)
  tier_plan_cache      (tier_id, snapshot, computed_at)

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

## Test-Setup (TT3 / TestTier3, id=7)

Roster mit 8 Spielern, randomisierte Savage/TomeUp BiS-Targets:
- Constraint: Weapon = Savage. Ring1 + Ring2 = je 1 Savage + 1 TomeUp.
- Andere Slots: 50/50 Savage/TomeUp (Seed 42, reproduzierbar).
- Skript: `/tmp/randomize_tt3_bis.py` (siehe Session-History).

Boss-1-Profil (Acc-Slots, alle 8 Spieler):

| Spieler | Job  | E    | N    | Br   | R1   | R2   | Boss-1-Need |
|---------|------|------|------|------|------|------|-------------|
| Fara    | PLD  | S    | S    | S    | S    | T    | 4           |
| Kuda    | GNB  | S    | S    | T    | T    | S    | 3           |
| Kaz     | SGE  | T    | T    | S    | T    | S    | 2           |
| Sndae   | WHM  | T    | T    | T    | T    | S    | 1           |
| Quah    | VPR  | T    | S    | S    | T    | S    | 3           |
| Rei     | BRD  | T    | T    | T    | S    | T    | 1           |
| Peter   | PCT  | S    | S    | S    | T    | S    | 4           |
| Brad    | BLM  | S    | S    | S    | S    | T    | 4           |

(S = Savage, T = TomeUp, Boss-1-Need = Anzahl Savage-Slots an
Boss 1.)

Roster-totals pro Item: **Ring 8** (alle), Earring 5, Bracelet 5,
Necklace 5. Bottleneck Boss 1 = Ring.

**Reset-Snippet** (aus Session-History):
```bash
sqlite3 /home/peter/projects/smelly-loot/data/loot.db <<'SQL'
DELETE FROM loot_drop WHERE raid_week_id IN (SELECT id FROM raid_week WHERE tier_id = 7);
DELETE FROM boss_kill WHERE raid_week_id IN (SELECT id FROM raid_week WHERE tier_id = 7);
DELETE FROM raid_week WHERE tier_id = 7;
DELETE FROM page_adjust WHERE tier_id = 7;
DELETE FROM tier_plan_cache WHERE tier_id = 7;
UPDATE bis_choice SET current_source = 'Crafted'
  WHERE tier_id = 7 AND current_source NOT IN ('Crafted', 'NotPlanned');
SQL
```

## Bekannte Trade-offs in v4.0.1

### Trade-off 1: Intra-Week-Fairness vs. Initial-Need

Aktuelle Score-Funktion bestraft jeden Drop in derselben Woche
mit -50 Punkten. Konsequenz im TT3 W1:

- Fara/Peter/Brad alle 4 open → Score 400.
- Earring → Fara (iter-order tie-break).
- Necklace → Peter (Fara hat -50).
- Bracelet → Brad (Peter hat -50).
- **Ring → Kuda** (Fara/Peter/Brad alle bei 250, Kuda bei 300).

**User-Beobachtung 2026-04-26**: "Theoretisch wäre es effizienter
den Ring an Peter zu geben, weil Peter 4 Boss-Drops braucht und
Kuda nur 3."

**Erklärung**: aktuell zählt `open_slots_at_boss` *aktuell*, nicht
*initial*. Nach Earring/Necklace/Bracelet-Drops haben Fara/Peter/
Brad nur noch 3 open. Plus -50 Strafe → 250. Kuda mit 3 open und
0 Strafe = 300, gewinnt Ring.

Lösungsvorschläge in Diskussion (siehe "Open design decisions"):
- `INITIAL_NEED_at_boss` statt `open_slots_at_boss` als Score-Basis.
- Tier-Counter ersetzt Week-Counter (User-Vorschlag).

### Trade-off 2: Plan-Stickyness vs. Plan-Aktualität

Mit v4.0.1 ist der Plan sticky. Konsequenz: wenn der Operator
einen Drop manuell an einen anderen Spieler vergibt als der Plan
empfohlen hat, bleibt die Plan-Empfehlung visuell stehen. Track
zeigt korrekt "Awarded: X", aber Plan zeigt weiter "Recommended:
Y". Ist nicht funktions-kritisch, aber UX-Verbesserung möglich:

- Plan-Tab könnte awarded-state visuell highlighten (Strikethrough
  + Tooltip "in Track an Z vergeben").

### Trade-off 3: Bottleneck konstant vs. dynamisch

Bottleneck pro Boss wird einmal beim Plan-Start berechnet. Wenn
sich das Need-Profil über Zeit dramatisch ändert (z.B. alle Ring-
Bedürftigen sind nach W5 versorgt, aber Bracelet ist immer noch
knapp), bleibt der Bottleneck weiter "Ring". Buy-Phase fällt
auf Priorität-2-Logik zurück (höchster aktueller Roster-Need),
also ist das in der Praxis kein Problem — aber ein Refresh nach
massiven Änderungen (z.B. neuer Spieler mit anderem BiS-Profil)
würde den Bottleneck nicht neu rechnen.

## Open design decisions (Stand 2026-04-26 nach v4.0.1)

Die folgenden Punkte wurden in der Designdiskussion identifiziert
aber noch **nicht** implementiert. Sie sind für eine v4.1.0
geplant:

### A — Frozen Buys

**Status**: vom User akzeptiert, noch nicht umgesetzt.

Buy-Empfehlungen werden beim **ersten** Plan-Lauf pro Tier
berechnet und dann eingefroren. Refresh aktualisiert nur Drops;
Buys bleiben fix.

- Schema: `tier.frozen_buys` (JSON, nullable).
- Refreeze-Button im Tier-Settings: setzt `frozen_buys = NULL`
  und re-computet den Plan, schreibt das neue Buy-Set zurück.
- Bereits vergebene Buys (`paid_with_pages=true loot_drop`) sind
  schon im Snapshot reflektiert (auto-equip hat `bisCurrent`
  aktualisiert), tauchen also nicht im neuen Buy-Set auf.

### B — Tier-Counter ersetzt Week-Counter

**Status**: vom User vorgeschlagen, Plan-Diskussion offen.

User-Quote (2026-04-26): "Statt das week based system zu nutzen
um fairness zu definieren, wie wäre es wenn wir stattdessen
einmal versuchen ein Tier based penalty system zu nutzen? Jeder
Drop den ein spieler bekommen hat erhöht seinen counter
(Bestenfalls mit in die spieler tabelle im tier einbauen) und
der counter gibt ihm dann ein penalty das zuweisungen reduziert."

Schema-Vorschlag:
```sql
CREATE TABLE tier_player_stats (
  tier_id      INTEGER NOT NULL,
  player_id    INTEGER NOT NULL,
  drop_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tier_id, player_id),
  FOREIGN KEY (tier_id) REFERENCES tier(id),
  FOREIGN KEY (player_id) REFERENCES player(id)
);
```

Score-Funktion-Vorschlag:
```
score = INITIAL_NEED_at_boss * 100 - K_COUNTER * tier_drop_count
```

K_COUNTER tuning offen — siehe Trade-off-Tabelle unten.

### C — Item-Reihenfolge nach Roster-Need

**Status**: vom User akzeptiert, noch nicht umgesetzt.

Drop-Phase iteriert Items aktuell in `floor.itemKeys` Reihenfolge
(Earring vor Necklace vor Bracelet vor Ring). Vorschlag: nach
Roster-Total-Need absteigend sortieren — bei TT3 wäre das `Ring →
Earring → Bracelet → Necklace`.

### D — Differenzierte Score-Funktionen für Bottleneck vs. Rest

**Status**: vom User vorgeschlagen 2026-04-26 (jüngste Diskussion).

User-Quote: "Mir stellt sich nun die frage ist eine priorisierung
des loots basierend darauf wieviele items ein spieler von einem
boss braucht überhaupt notwendig? Nur beim Bottleneck da es da zu
adjustments kommen muss... Allerdings denke ich sollte die
verteilung der restlichen items simpler erfolgen. Auswahl
zwischen spielern die item benötigen und dann tier fairness
regelung einbringen."

Konsequenz: zwei Score-Funktionen:

```
// Bottleneck drop (Need-driven, mit Fairness)
bottleneck_score = INITIAL_NEED_at_boss * 100 - K_COUNTER * tier_counter

// Non-bottleneck drop (Pure Fairness, Need wirkt nur als Filter)
nonbottleneck_score = -K_COUNTER * tier_counter
```

Bei Non-Bottleneck-Items gewinnt der Spieler mit niedrigstem
Counter unter den Bedürftigen — egal wie hoch sein Need-Count
ist. Das simplifiziert die Logik massiv.

### Open: K_COUNTER tuning + Hard-Cap

| K | W1 4-need-Spieler bekommt 2 Drops? | W2 Ring an 4-need-Spieler? |
|---:|:---:|:---:|
| 50 | ja (z.B. Fara) | ja (Peter beats Quah) |
| 75 | ja | ja |
| 125 | nein (Top-3 + Kuda je 1 Drop) | nein (Quah holt Ring W2) |

Strukturelle Spannung: linearer Counter kann nicht gleichzeitig
"max 1 Drop/Spieler/Woche" UND "Initial-Need dominiert
Cross-Week" erzwingen.

Lösungsoption: Hard-Cap "max 1 Drop/Spieler/Woche/Boss" als
**Realismus-Constraint** (nicht Fairness-Penalty). Dann ersetzt
der Tier-Counter nur die Cross-Week-Anti-Streak.

## Verzeichnete User-Anforderungen (chronologisch)

1. **2026-04-26 (v3.x)**: "Eine Person soll nicht jede woche 5 items
   bekommen damit nach 4 wochen eine andere person jeweils die
   5 items bekommt." → intra-week-Fairness eingeführt.

2. **v4.0.0**: User wechselt zu Greedy-Algorithmus, will den MCMF
   weghaben. Bottleneck pro Boss soll selbst berechnet werden,
   nicht hartkodiert.

3. **v4.0.1**: User berichtet "Dinge werden während der verteilung
   aktualisiert das soll so nicht sein". → Plan-Cache nicht mehr
   automatisch invalidieren.

4. **2026-04-26 (post-v4.0.1)**: User möchte Frozen Buys + Refreeze
   Button. Will dass Page-Buys nach erstem Plan fix bleiben.

5. **2026-04-26 (jüngste Diskussion)**: User hinterfragt Need-
   Priorisierung für Drops generell. Will eventuell nur für
   Bottleneck Need-Score, sonst nur Fairness.

## Reproduktion + Debug-Hooks

Wenn das Verhalten nicht passt:

1. **Snapshot der DB ziehen**:
   ```bash
   cp /home/peter/projects/smelly-loot/data/loot.db /tmp/debug.db
   ```

2. **Plan-Cache-Inhalt anschauen**:
   ```sql
   SELECT json_extract(snapshot, '$') FROM tier_plan_cache WHERE tier_id = 7;
   ```

3. **Test schreiben statt live debuggen**: Reproduzier das
   Szenario in `src/lib/loot/greedy-planner.test.ts` mit
   `makePlayer` + `computeGreedyPlan`. Test failed → Bug
   eingegrenzt.

4. **Algorithmus-Trace einbauen**: temporär `console.log` in
   `pickDropWinner` und `pickBuyItem`, dann den Test laufen
   lassen.

## Releases & Tags

| Version | Datum      | Highlight                                              |
|---------|------------|--------------------------------------------------------|
| v3.3.1  | 2026-04-26 | MCMF cycle-guard fix                                   |
| v4.0.0  | 2026-04-26 | Greedy-Planner ersetzt MCMF (BREAKING; Tier-Reset)     |
| v4.0.1  | 2026-04-26 | Plan-Stickyness; BuyAssign Done-Badge                  |
| v4.1.0  | tbd        | Frozen Buys + Tier-Counter (Open design decisions A-D) |
