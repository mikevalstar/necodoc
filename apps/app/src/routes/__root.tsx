import { DetectiveIcon } from "@phosphor-icons/react";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ErrorAlert } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { authClient, meQuery, unwrap, useSessionChange } from "@/lib/auth";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <ImpersonationBanner />
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  ),
});

// Lives in the root so it also shows on /pending when impersonating a user without roles.
function ImpersonationBanner() {
  const me = useQuery(meQuery).data;
  const sessionChanged = useSessionChange();
  const stop = useMutation({
    mutationFn: () => unwrap(authClient.admin.stopImpersonating()),
    onSuccess: () => sessionChanged("/admin/users"),
  });

  if (!me?.impersonatedBy) return null;
  return (
    <div role="status" className="bg-warn-wash text-ink">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2">
          <DetectiveIcon className="size-5 shrink-0 text-warn" />
          You are impersonating <strong>{me.user.name}</strong> ({me.user.email}).
        </span>
        <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
          Stop impersonating
        </Button>
      </div>
      <div className="mx-auto max-w-6xl px-4 empty:hidden">
        <ErrorAlert error={stop.error} />
      </div>
    </div>
  );
}
