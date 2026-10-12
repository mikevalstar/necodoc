import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/** Sign-in, register and pending: one card on the cobalt shell, under the brand mark. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-svh flex-col items-center justify-center bg-linear-to-b from-shell to-shell-2 p-4"
    >
      <div className="w-full max-w-sm space-y-7">
        <div className="flex items-center justify-center gap-2.5 font-heading text-[26px] font-bold tracking-tight text-shell-fg">
          <Logo className="size-10" accentClassName="fill-sun" />
          necodoc
        </div>
        <div className="[&>[data-slot=card]]:shadow-float">{children}</div>
      </div>
    </main>
  );
}
