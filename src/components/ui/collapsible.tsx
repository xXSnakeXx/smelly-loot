"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@/lib/utils";

/**
 * Collapsible wrapper around Base UI's primitives.
 *
 * Used by the History tab to make each raid week's card expand /
 * collapse on click. Same anatomy as the other Base UI wrappers
 * in this folder; the Panel uses CSS to animate height + opacity
 * via Base UI's `data-starting-style` / `data-ending-style`
 * conventions.
 */

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export function CollapsiblePanel({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn(
        "overflow-hidden transition-[height,opacity] duration-200",
        "h-[var(--collapsible-panel-height)]",
        "data-[ending-style]:h-0 data-[ending-style]:opacity-0",
        "data-[starting-style]:h-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}
