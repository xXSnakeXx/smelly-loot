import { describe, expect, it } from "vitest";

import { cn } from "./utils";

/**
 * Smoke tests for the shared `cn` helper from shadcn/ui.
 *
 * These tests double as a sanity check that the Vitest + tsconfig-paths
 * + jsdom toolchain works end-to-end. The `cn` helper itself is a thin
 * wrapper around `clsx` + `tailwind-merge`, so the assertions stay
 * narrow on purpose: enumerating Tailwind merge edge cases is the
 * upstream library's job.
 */
describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("filters falsy values out of the input", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  it("merges conflicting Tailwind utilities so the last one wins", () => {
    // tailwind-merge is what makes `cn` more than `clsx`: later utilities
    // in the same property family must override earlier ones.
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-zinc-500", "text-base")).toBe(
      "text-zinc-500 text-base",
    );
  });
});
