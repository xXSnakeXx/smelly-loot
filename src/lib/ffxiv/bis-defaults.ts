import type { JobCode } from "./jobs";
import { type BisSource, SLOTS, type Slot } from "./slots";

/**
 * Default BiS plan emitted whenever a player is created.
 *
 * The team-onboarding decision (Phase 2.2): every fresh roster
 * starts with `currentSource = "Crafted"` for every wearable slot.
 * The 8.0 crafted set is the canonical "you got here, now upgrade"
 * baseline — most teams enter a tier wearing it, and showing it as
 * the default eliminates the "BiS table looks empty" foot-gun the
 * users hit on first contact.
 *
 * `desiredSource` defaults to `NotPlanned` on every slot: the
 * algorithm only scores slots whose desired source actually
 * differs from current, so leaving the goal blank means we don't
 * recommend any drops for the player until the team explicitly
 * picks a target. The user fills `desiredSource` in via the BiS
 * table once the roster is stable.
 *
 * `Offhand` is deliberately `NotPlanned` for both fields on every
 * job that isn't a Paladin: a non-PLD job will never see an
 * offhand drop, so even the current-source slot is irrelevant.
 * PLDs get `currentSource = "Crafted"` like the other slots.
 */
export interface DefaultBisRow {
  slot: Slot;
  desiredSource: BisSource;
  currentSource: BisSource;
}

export function defaultBisChoicesForJob(mainJob: string): DefaultBisRow[] {
  return SLOTS.map((slot) => {
    if (slot === "Offhand" && mainJob !== ("PLD" satisfies JobCode)) {
      return {
        slot,
        desiredSource: "NotPlanned",
        currentSource: "NotPlanned",
      };
    }
    return {
      slot,
      desiredSource: "NotPlanned",
      currentSource: "Crafted",
    };
  });
}
