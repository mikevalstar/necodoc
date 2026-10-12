import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CloudSlashIcon,
  type Icon,
  LockKeyIcon,
  SignInIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  type ErrorComponentProps,
  Link,
  useCanGoBack,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Logo } from "@/components/logo";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// The router's not-found, error and pending screens (docs/features/app-shell-and-navigation.md).
// Inside the app they render in the shell, so the nav stays; when the shell itself couldn't
// load (signed out, or the API is down on first load) they stand alone on the cobalt frame.

/** True once the signed-in shell has loaded, so a state renders inside it. */
function useInShell() {
  return useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/_app" && match.status === "success"),
  });
}

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

function StateScreen({
  art,
  title,
  description,
  detail,
  actions,
}: {
  art: ReactNode;
  title: string;
  description: ReactNode;
  /** The URL or the server's message, for whoever reports the problem. */
  detail?: string;
  actions: ReactNode;
}) {
  const inShell = useInShell();
  const detailLine = detail && <p className="font-mono text-xs break-all text-ink-3">{detail}</p>;

  if (!inShell) {
    return (
      <AuthFrame title={title} description={description}>
        <div className="space-y-5">
          {detailLine}
          <div className="flex flex-wrap gap-2.5">{actions}</div>
        </div>
      </AuthFrame>
    );
  }
  return (
    <Page width="narrow" className="pt-8">
      <Card className="items-center px-6 py-12 text-center sm:py-16">
        <div aria-hidden="true">{art}</div>
        <div className="space-y-2">
          <h1 className="font-heading text-2xl leading-tight font-extrabold tracking-tight">
            {title}
          </h1>
          <p className="mx-auto max-w-md text-[15px] text-ink-2">{description}</p>
          {detailLine}
        </div>
        <div className="flex flex-wrap justify-center gap-2.5">{actions}</div>
      </Card>
    </Page>
  );
}

/** "4 (neko) 4": the mark stands in for the zero. */
function LostNeko() {
  return (
    <div className="flex items-center gap-1 font-heading text-[88px] leading-none font-extrabold tracking-tight text-brand-ink">
      4
      <Logo className="size-[76px] text-ink" />4
    </div>
  );
}

function IconTile({ icon: TileIcon, tone = "brand" }: { icon: Icon; tone?: "brand" | "bad" }) {
  return (
    <div
      className={cn(
        "grid size-16 place-items-center rounded-2xl",
        tone === "brand" ? "bg-brand-wash text-brand" : "bg-bad-wash text-bad",
      )}
    >
      <TileIcon className="size-9" />
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  if (!useCanGoBack()) return null;
  return (
    <Button variant="outline" onClick={() => router.history.back()}>
      <ArrowLeftIcon weight="bold" />
      Go back
    </Button>
  );
}

function HomeButton({ variant }: { variant?: "outline" }) {
  const inShell = useInShell();
  return (
    <Button variant={variant} nativeButton={false} render={<Link to="/" />}>
      {inShell ? "Go to My documents" : "Go to necodoc"}
    </Button>
  );
}

function NotFoundScreen({ what = "page" }: { what?: "page" | "record" }) {
  const { pathname } = useLocation();
  return (
    <StateScreen
      art={<LostNeko />}
      title={what === "page" ? "This page wandered off" : "We couldn’t find that"}
      description={
        what === "page"
          ? "There’s nothing at this address. The link may be old, or the page was moved."
          : "It may have been deleted, or the link has a typo. Check the address, or go back."
      }
      detail={pathname}
      actions={
        <>
          <BackButton />
          <HomeButton />
        </>
      }
    />
  );
}

export function NotFound() {
  return <NotFoundScreen />;
}

/** A 400 or 404 from a loader means the id in the URL is wrong; anything 5xx-ish or a dropped
 * connection is the server not answering, which usually passes after a restart. */
function kindOf(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400 || error.status === 404) return "notFound";
    if (error.status === 401) return "signedOut";
    if (error.status === 403) return "forbidden";
    if (error.status >= 502 && error.status <= 504) return "unreachable";
    return "failed";
  }
  const dropped = error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
  return dropped || !navigator.onLine ? "unreachable" : "failed";
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const kind = kindOf(error);
  const online = useOnline();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    reset();
    await router.invalidate();
    setRetrying(false);
  };

  // Back online: try again without waiting for a click.
  useEffect(() => {
    if (kind !== "unreachable") return;
    const onOnline = () => {
      reset();
      router.invalidate();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [kind, reset, router]);

  const tryAgain = (
    <Button disabled={retrying} onClick={retry}>
      <ArrowClockwiseIcon weight="bold" className={cn(retrying && "animate-spin")} />
      {retrying ? "Trying…" : "Try again"}
    </Button>
  );

  switch (kind) {
    case "notFound":
      return <NotFoundScreen what="record" />;
    case "forbidden":
      return (
        <StateScreen
          art={<IconTile icon={LockKeyIcon} />}
          title="You don’t have access to this"
          description="Your role doesn’t include it. If you need it, ask an admin to change your role."
          actions={
            <>
              <BackButton />
              <HomeButton />
            </>
          }
        />
      );
    case "signedOut":
      return (
        <StateScreen
          art={<IconTile icon={SignInIcon} />}
          title="You’ve been signed out"
          description="Your session ended. Sign in again to carry on."
          actions={
            <Button nativeButton={false} render={<Link to="/login" />}>
              <SignInIcon />
              Sign in
            </Button>
          }
        />
      );
    case "unreachable":
      return (
        <StateScreen
          art={<IconTile icon={CloudSlashIcon} />}
          title="necodoc isn’t responding"
          description={
            online
              ? "The server may be restarting. Give it a few seconds, then try again."
              : "You’re offline. This page will try again when the connection is back."
          }
          actions={
            <>
              <BackButton />
              {tryAgain}
            </>
          }
        />
      );
    default:
      return (
        <StateScreen
          art={<IconTile icon={WarningCircleIcon} tone="bad" />}
          title="Something went wrong"
          description="This page couldn’t load. If necodoc was just restarted, trying again usually works."
          detail={error instanceof Error && error.message ? error.message : undefined}
          actions={
            <>
              <HomeButton variant="outline" />
              {tryAgain}
            </>
          }
        />
      );
  }
}

/** Shown when a route takes over a second to load, e.g. while the API restarts. */
export function RoutePending() {
  const inShell = useInShell();
  const online = useOnline();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  const note = !online
    ? "You’re offline. necodoc will carry on when the connection is back."
    : slow
      ? "Still waiting for the server. If necodoc was just restarted, this takes a few seconds."
      : null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 text-center",
        inShell ? "min-h-[50svh]" : "min-h-svh bg-background",
      )}
    >
      <Logo className="size-12 animate-pulse text-ink" />
      <p className="text-sm font-semibold text-ink-2">Loading…</p>
      {note && <p className="max-w-xs text-sm text-ink-3">{note}</p>}
    </div>
  );
}
