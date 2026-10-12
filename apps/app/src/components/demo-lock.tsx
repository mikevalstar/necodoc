import { DEMO_DISABLED } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { instanceQuery } from "@/components/instance";
import { cn } from "@/lib/utils";

// docs/features/public-demo.md (Hardening), ADR 0046: what the public demo refuses shows
// disabled, with the reason as its tooltip. The API refuses the same actions with 403
// `demo_disabled` and the same words (apps/api/src/demo.ts).

/** Whether this installation is the public demo. */
export function useDemoMode() {
  return useQuery(instanceQuery).data?.demoMode ?? false;
}

/**
 * Disables the buttons and inputs inside it in the public demo and explains why on hover.
 * Menu items aren't form controls: give them `disabled={demo}` too. Elsewhere it renders its
 * children untouched.
 */
export function DemoLock({ children, className }: { children: ReactNode; className?: string }) {
  if (!useDemoMode()) return children;
  // A disabled fieldset disables every control in it; disabled controls ignore the pointer, so
  // the wrapper is what shows the tooltip.
  return (
    <div title={DEMO_DISABLED} className={cn("inline-flex cursor-not-allowed", className)}>
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </div>
  );
}
