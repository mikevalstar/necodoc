import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { api, ok } from "@/lib/api";
import { formatRate, summarize, type Tone } from "@/lib/ops-status";
import { cn } from "@/lib/utils";
import { formatMs } from "@/routes/_app/generations/-generation-actions";

// Spec: docs/features/app-shell-and-navigation.md (ops status bar). Admins only, opt-in per
// browser. Reads GET /api/system like Admin › System, but every 30 s, and TanStack Query skips
// the interval while the tab is hidden (refetchIntervalInBackground is off).

const storageKey = "necodoc-status-bar";
const listeners = new Set<() => void>();

function readStored() {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false; // storage blocked
  }
}

let shown = readStored();

export function setStatusBar(on: boolean) {
  shown = on;
  try {
    localStorage.setItem(storageKey, on ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts until reload
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this browser asked for the bar; the shell still shows it to admins only. */
export function useStatusBar() {
  return useSyncExternalStore(subscribe, () => shown);
}

const statusQuery = queryOptions({
  queryKey: ["system", "1h"],
  queryFn: async () => (await ok(api.system.$get({ query: { window: "1h" } }))).json(),
  refetchInterval: 30_000,
  placeholderData: keepPreviousData,
  retry: false,
});

const dot: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

function Item({
  to,
  tone,
  label,
  children,
  className,
}: {
  to: LinkProps["to"];
  tone?: Tone;
  /** The whole item for screen readers, e.g. "Queue: 3 waiting, 2 running". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-full items-center gap-1.5 rounded px-2 whitespace-nowrap hover:bg-tint hover:text-ink",
        className,
      )}
    >
      {tone && (
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot[tone])} />
      )}
      <span aria-hidden="true">{children}</span>
    </Link>
  );
}

export function OpsStatusBar() {
  const status = useQuery(statusQuery);
  const s = status.data ? summarize(status.data) : null;
  const connected = !status.isError;
  return (
    <section
      aria-label="System status"
      className="sticky bottom-0 z-10 mt-auto flex h-7 shrink-0 items-center gap-0.5 overflow-hidden border-t border-hair bg-surface/95 px-2 font-mono text-[11.5px] text-ink-2 backdrop-blur sm:px-6"
    >
      <Item
        to="/admin/system"
        tone={connected ? "ok" : "bad"}
        label={connected ? "API connected" : "API unreachable"}
      >
        {connected ? "API" : "API unreachable"}
      </Item>
      {s && (
        <>
          <Item
            to="/admin/queue"
            tone={s.queue.tone}
            label={`Queue: ${s.queue.waiting} waiting, ${s.queue.running} running`}
          >
            queue {s.queue.waiting} · {s.queue.running} running
          </Item>
          <Item
            to="/admin/system"
            tone={s.workers.tone}
            label={`Workers: ${s.workers.online} online, ${s.workers.busy} of ${s.workers.slots} slots busy`}
          >
            workers {s.workers.online} · {s.workers.busy}/{s.workers.slots}
          </Item>
          <Item
            to="/admin/system"
            tone={s.p95Tone}
            label={`p95 render time, last hour: ${formatMs(s.p95Ms)}`}
            className="max-[999px]:hidden"
          >
            p95 {formatMs(s.p95Ms)}
          </Item>
          <Item
            to="/admin/system"
            tone={s.errorTone}
            label={`Failure rate, last hour: ${formatRate(s.errorRate)}`}
            className="max-[999px]:hidden"
          >
            failed {formatRate(s.errorRate)}
          </Item>
          <Item
            to="/admin/system"
            tone={s.mixedVersions ? "warn" : undefined}
            label={`Version ${s.version}${s.mixedVersions ? ", other versions online" : ""}`}
            className="ml-auto"
          >
            {s.version}
            {s.mixedVersions && " · mixed"}
          </Item>
        </>
      )}
    </section>
  );
}
