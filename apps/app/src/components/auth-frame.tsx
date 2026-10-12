import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/** Sign-in, register and pending: one centred card under the brand mark. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-4 dark:bg-background"
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">
          <Logo className="size-9" />
          necodoc
        </div>
        {children}
      </div>
    </main>
  );
}
