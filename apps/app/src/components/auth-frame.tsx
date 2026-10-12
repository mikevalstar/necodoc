import type { ReactNode } from "react";
import { InstanceLabel } from "@/components/instance";
import { Logo } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

/** Sign-in, register and pending: one calm card on the cobalt shell, under the brand mark. */
export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      id="main"
      className="flex min-h-svh flex-col items-center justify-center bg-linear-to-b from-shell to-shell-2 p-4"
    >
      <div className="w-full max-w-100 space-y-7">
        <div className="flex items-center justify-center gap-2.5 font-heading text-[26px] font-bold tracking-tight text-shell-fg">
          <Logo className="size-10" accentClassName="fill-sun" />
          necodoc
        </div>
        <InstanceLabel />
        <Card className="gap-6 shadow-float [--card-spacing:--spacing(7)]">
          <CardHeader className="gap-1.5">
            <h1 className="font-heading text-2xl leading-tight font-extrabold tracking-tight">
              {title}
            </h1>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

/** "or" between the single sign-on buttons and the password form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-ink-3 uppercase">
      <span className="h-px flex-1 bg-tint-2" />
      or
      <span className="h-px flex-1 bg-tint-2" />
    </div>
  );
}
