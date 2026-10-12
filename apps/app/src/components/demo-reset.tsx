import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { instanceQuery } from "@/components/instance";
import { demoResetting } from "@/lib/api";

// Spec: docs/features/public-demo.md (Nightly reset). While `pnpm demo:reset` runs the API answers
// 503; the whole app gives way to one calm screen that checks back and reloads when it's over.

const CHECK_MS = 5000;

/** The app, or the resetting screen while a demo reset runs. */
export function DemoResetGate({ children }: { children: ReactNode }) {
  const since = useSyncExternalStore(demoResetting.subscribe, demoResetting.since);
  const { data, dataUpdatedAt } = useQuery({
    ...instanceQuery,
    refetchInterval: (query) => (since !== null || query.state.data?.resetting ? CHECK_MS : false),
  });

  // Loaded during a reset: /api/instance says so before any 503.
  useEffect(() => {
    if (data?.resetting) demoResetting.start();
  }, [data?.resetting]);

  // Over: an answer asked for after the reset began says so. Reload for fresh data and a new
  // session (the old one went with the database).
  useEffect(() => {
    if (since !== null && data && !data.resetting && dataUpdatedAt > since) {
      window.location.reload();
    }
  }, [since, data, dataUpdatedAt]);

  if (since === null) return children;
  return (
    <AuthFrame
      title="The demo is resetting"
      description="It's being rebuilt with fresh sample data, which takes a few minutes. This page reloads by itself when it's back."
    >
      <p role="status" className="text-sm text-ink-3">
        Checking again every few seconds…
      </p>
    </AuthFrame>
  );
}
