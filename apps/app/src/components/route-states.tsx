import {
  ArrowClockwiseIcon,
  CloudWarningIcon,
  FileMagnifyingGlassIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { EmptyState, Page } from "@/components/page";
import { Button } from "@/components/ui/button";

// The router's not-found and error screens. Inside the app they render in the shell (nav
// stays); before sign-in they render on their own, so they carry the logo.

export function NotFound() {
  return (
    <Page width="narrow" className="py-16">
      <EmptyState
        icon={FileMagnifyingGlassIcon}
        title="Page not found"
        description="The link may be old, or the page was moved or deleted."
        action={
          <Button nativeButton={false} render={<Link to="/" />}>
            Go home
          </Button>
        }
      />
    </Page>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Page width="narrow" className="py-16">
      <div className="flex justify-center">
        <Logo className="size-8" />
      </div>
      <EmptyState
        icon={CloudWarningIcon}
        title="Something went wrong"
        description={
          <>
            {error instanceof Error && error.message ? error.message : "The page couldn’t load."} If
            necodoc was just restarted, trying again usually works.
          </>
        }
        action={
          <Button
            onClick={() => {
              reset();
              router.invalidate();
            }}
          >
            <ArrowClockwiseIcon />
            Try again
          </Button>
        }
      />
    </Page>
  );
}

/** Shown when a route takes over a second to load, e.g. while the API restarts. */
export function RoutePending() {
  return (
    <div
      role="status"
      className="flex min-h-[50svh] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <SpinnerGapIcon className="size-4 animate-spin" />
      Loading…
    </div>
  );
}
