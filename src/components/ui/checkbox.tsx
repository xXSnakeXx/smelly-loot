"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Square checkbox with a small check-mark indicator.
 *
 * Wraps Base UI's `Checkbox.Root` so we get controlled/uncontrolled
 * support, accessible-name forwarding, and form integration for
 * free. The `Indicator` only renders while the checkbox is in the
 * `checked` state, which keeps the unchecked box visually clean.
 *
 * Mirrors the visual language of `<Input>` and `<Select>` —
 * rounded-sm border, focus ring on tab-into, muted disabled state.
 */
export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex h-full w-full items-center justify-center"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
