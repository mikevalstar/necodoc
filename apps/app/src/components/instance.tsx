import type { InstanceEnv } from "@necodoc/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, ok } from "@/lib/api";
import { cn } from "@/lib/utils";

// Spec: docs/features/app-shell-and-navigation.md (instance identity). Which installation this is,
// from INSTANCE_NAME / INSTANCE_ENV. A label, not a tenant switcher: every customer self-hosts one.

export const instanceQuery = queryOptions({
  queryKey: ["instance"],
  queryFn: async () => (await ok(api.instance.$get())).json(),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Production reads as a warning colour on purpose: it's the one to be careful in. */
const envTone = {
  prod: "bg-bad-wash text-bad",
  staging: "bg-warn-wash text-warn",
  dev: "bg-ok-wash text-ok",
} as const satisfies Record<InstanceEnv, string>;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

function EnvPill({ env }: { env: InstanceEnv }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 text-[10.5px] leading-4 font-bold tracking-wide uppercase",
        envTone[env],
      )}
    >
      {env}
    </span>
  );
}

/** Top of the sidebar: initials, name and environment; initials alone in the rail. */
export function InstanceBlock({ rail }: { rail: boolean }) {
  const { data } = useQuery(instanceQuery);
  if (!data?.name) return null;
  const label = data.env ? `${data.name} · ${data.env}` : data.name;
  const mark = (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg font-heading text-xs font-extrabold",
        data.env ? envTone[data.env] : "bg-sun text-sun-foreground",
      )}
    >
      {initials(data.name)}
    </span>
  );
  if (rail) {
    return (
      <div role="note" aria-label={`Instance: ${label}`} title={label} className="mb-3.5">
        {mark}
      </div>
    );
  }
  return (
    <div
      role="note"
      aria-label={`Instance: ${label}`}
      className="mb-3.5 flex items-center gap-2.5 rounded-xl bg-white/8 px-2.5 py-2 text-[13px]"
    >
      {mark}
      <div aria-hidden="true" className="min-w-0 leading-tight">
        <div className="truncate font-semibold">{data.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-shell-fg-2">
          Self-hosted
          {data.env && <EnvPill env={data.env} />}
        </div>
      </div>
    </div>
  );
}

/** The login, register and pending pages: the same label under the brand mark. */
export function InstanceLabel() {
  const { data } = useQuery(instanceQuery);
  if (!data?.name) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-sm font-semibold text-shell-fg">
      {data.name}
      {data.env && <EnvPill env={data.env} />}
    </div>
  );
}
