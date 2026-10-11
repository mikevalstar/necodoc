import type { AuditAction, AuditActorKind, AuditTargetType } from "@necodoc/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, ok } from "@/lib/api";
import { meQuery } from "@/lib/auth";
import { dayjs } from "@/lib/date";

// Spec: docs/features/audit-log.md. The entry drawer and the History panel object pages show;
// Admin › Audit log (routes/_app/admin/audit.tsx) uses both. Admins only, like the API.

const words = (id: string) => id.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

/** "theme.updated" → "Theme updated", "auth.sign_in_failed" → "Sign in failed". */
export const actionLabel = (action: AuditAction) => {
  const [type = "", verb = ""] = action.split(".");
  return type === "auth" || type === "settings"
    ? words(verb)
    : `${words(type)} ${words(verb).toLowerCase()}`;
};
export const targetTypeLabel = (type: AuditTargetType) => words(type);

export const actorKindLabels: Record<AuditActorKind, string> = {
  user: "User",
  api_key: "API key",
  service_account: "Service account",
  system: "System",
  public: "Not signed in",
};

export function ActorCell({
  entry,
}: {
  entry: {
    actorKind: AuditActorKind;
    actorName: string | null;
    impersonatorId: string | null;
    impersonatorName: string | null;
    apiKeyId: string | null;
  };
}) {
  const name = entry.actorName ?? actorKindLabels[entry.actorKind];
  return (
    <span>
      {name}
      {entry.apiKeyId && (
        <span className="text-muted-foreground"> · {actorKindLabels[entry.actorKind]}</span>
      )}
      {entry.impersonatorId && (
        <span className="block text-xs text-muted-foreground">
          impersonated by {entry.impersonatorName ?? entry.impersonatorId}
        </span>
      )}
    </span>
  );
}

const auditEntryQuery = (id: string) =>
  queryOptions({
    queryKey: ["audit", "entry", id],
    queryFn: async () => (await ok(api.audit[":id"].$get({ param: { id } }))).json(),
  });

function Value({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  if (value === null) return <span className="text-muted-foreground">empty</span>;
  if (typeof value === "string" && value.length < 120 && !value.includes("\n")) {
    return <span className="break-words">{value}</span>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

type Fields = Record<string, unknown> | null;

/** One row per changed field: what it was, what it became. */
export function AuditDiff({ before, after }: { before: Fields; after: Fields }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length)
    return <p className="text-sm text-muted-foreground">No field changes recorded.</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="w-1/5 pb-1 font-medium">Field</th>
          {before && <th className="pb-1 font-medium">Before</th>}
          {after && <th className="pb-1 font-medium">After</th>}
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-t align-top">
            <td className="py-1.5 pr-2 font-mono text-xs break-all">{key}</td>
            {before && (
              <td className="py-1.5 pr-2">
                <Value value={before[key]} />
              </td>
            )}
            {after && (
              <td className="py-1.5">
                <Value value={after[key]} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditEntrySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const entry = useQuery({ ...auditEntryQuery(id ?? ""), enabled: id !== null });
  const e = entry.data;
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{e ? actionLabel(e.action) : "Audit entry"}</SheetTitle>
          {e && (
            <SheetDescription>
              {dayjs(e.createdAt).format("YYYY-MM-DD HH:mm:ss")} · {targetTypeLabel(e.targetType)}{" "}
              {e.targetName ?? e.targetId ?? ""}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <ErrorAlert error={entry.error} />
          {e && (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Actor</dt>
                <dd>
                  <ActorCell entry={e} />
                  {e.actorId && (
                    <span className="block font-mono text-xs break-all text-muted-foreground">
                      {e.actorId}
                    </span>
                  )}
                </dd>
                {e.apiKeyId && (
                  <>
                    <dt className="text-muted-foreground">API key</dt>
                    <dd className="font-mono text-xs">{e.apiKeyId}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Target id</dt>
                <dd className="font-mono text-xs break-all">{e.targetId ?? "—"}</dd>
                <dt className="text-muted-foreground">IP</dt>
                <dd>{e.ip ?? "—"}</dd>
                <dt className="text-muted-foreground">User agent</dt>
                <dd className="text-xs break-all">{e.userAgent ?? "—"}</dd>
                <dt className="text-muted-foreground">Request id</dt>
                <dd className="font-mono text-xs break-all">{e.requestId ?? "—"}</dd>
              </dl>
              {(e.before || e.after) && (
                <section className="space-y-2">
                  <h3 className="font-medium">Changes</h3>
                  <AuditDiff before={e.before} after={e.after} />
                </section>
              )}
              {e.details && (
                <section className="space-y-2">
                  <h3 className="font-medium">Details</h3>
                  <AuditDiff before={null} after={e.details} />
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** An object's own audit trail, newest first. Renders nothing for non-admins. */
export function HistoryPanel({
  targetType,
  targetId,
}: {
  targetType: AuditTargetType;
  targetId: string;
}) {
  const me = useQuery(meQuery);
  const isAdmin = me.data?.user.roles.includes("admin") === true;
  const query = { targetType, targetId, limit: "20" };
  const history = useQuery({
    queryKey: ["audit", "list", query],
    queryFn: async () => (await ok(api.audit.$get({ query }))).json(),
    enabled: isAdmin,
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!isAdmin) return null;
  const total = history.data?.total ?? 0;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">History</h2>
        {total > 0 && (
          <Link
            to="/admin/audit"
            search={{ targetType, targetId }}
            className="text-sm text-muted-foreground hover:underline"
          >
            {total > 20
              ? `All ${total.toLocaleString()} in the audit log`
              : "Open in the audit log"}
          </Link>
        )}
      </div>
      <ErrorAlert error={history.error} />
      {history.data && !history.data.items.length && (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      )}
      {history.data?.items.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {history.data.items.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline gap-x-3 px-3 py-2 text-left hover:bg-muted/50"
                onClick={() => setOpen(entry.id)}
              >
                <span className="tabular-nums text-muted-foreground">
                  {dayjs(entry.createdAt).format("YYYY-MM-DD HH:mm")}
                </span>
                <Badge variant="outline">{actionLabel(entry.action)}</Badge>
                <ActorCell entry={entry} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <AuditEntrySheet id={open} onClose={() => setOpen(null)} />
    </section>
  );
}
