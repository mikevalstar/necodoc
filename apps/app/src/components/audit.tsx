import type { AuditAction, AuditActorKind, AuditTargetType } from "@necodoc/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

// Spec: docs/features/audit-log.md. The entry drawer and the History panel object pages show;
// Admin › Audit log (routes/_app/admin/audit.tsx) uses both. Admins only, like the API.

const acronyms = new Set(["api", "ai", "pdf", "sso", "csv", "url", "ip", "html", "json"]);

/** "api_key" → "API key", "sign_in_failed" → "Sign in failed"; `lower` keeps the first word lower. */
export const words = (id: string, lower = false) =>
  id
    .split("_")
    .map((word, i) =>
      acronyms.has(word)
        ? word.toUpperCase()
        : i === 0 && !lower
          ? word.charAt(0).toUpperCase() + word.slice(1)
          : word,
    )
    .join(" ");

/** "theme.updated" → "Theme updated", "template.ai_requested" → "Template AI requested". */
export const actionLabel = (action: AuditAction) => {
  const [type = "", verb = ""] = action.split(".");
  return type === "auth" || type === "settings"
    ? words(verb)
    : `${words(type)} ${words(verb, true)}`;
};

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
      {entry.apiKeyId && <span className="text-ink-3"> · {actorKindLabels[entry.actorKind]}</span>}
      {entry.impersonatorId && (
        <span className="block text-xs text-ink-3">
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
  if (value === undefined) return <span className="text-ink-3">not set</span>;
  if (value === null) return <span className="text-ink-3">empty</span>;
  if (typeof value !== "object" && (typeof value !== "string" || isShort(value))) {
    return <span className="break-words">{String(value)}</span>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-tint p-2 font-mono text-xs whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

const isShort = (value: string) => value.length < 120 && !value.includes("\n");

type Fields = Record<string, unknown> | null;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Nested objects become dotted paths ("settings.fontSize"); arrays and scalars are leaves. */
function flatten(fields: Record<string, unknown>, prefix = "", into = new Map<string, unknown>()) {
  for (const [key, value] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && Object.keys(value).length) flatten(value, path, into);
    else into.set(path, value);
  }
  return into;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed. With both sides, only the paths that differ, before on a bad wash and after on an
 * ok wash, and "Show full value" for the nested objects they sit in. With one side (a create, a
 * delete or details), every field.
 */
function AuditDiff({ before, after }: { before: Fields; after: Fields }) {
  if (before && after) return <ChangedFields before={before} after={after} />;
  const fields = before ?? after ?? {};
  const keys = Object.keys(fields);
  if (!keys.length) return <p className="text-sm text-ink-3">No fields recorded.</p>;
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {keys.map((key) => (
        <div key={key} className="contents">
          <dt className="font-mono text-xs break-all text-ink-2">{key}</dt>
          <dd className="min-w-0">
            <Value value={fields[key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChangedFields({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const [full, setFull] = useState<string | null>(null);
  const old = flatten(before);
  const now = flatten(after);
  const changed = [...new Set([...old.keys(), ...now.keys()])].filter(
    (path) => !same(old.get(path), now.get(path)),
  );
  if (!changed.length) return <p className="text-sm text-ink-3">No field changes recorded.</p>;
  // Changed paths grouped under their top-level field, so a nested one can show the whole value.
  const groups = new Map<string, string[]>();
  for (const path of changed) {
    const key = path.split(".")[0] ?? path;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th className="w-[30%] pb-1.5 font-semibold">Field</th>
          <th className="pb-1.5 font-semibold">Before</th>
          <th className="pb-1.5 pl-2 font-semibold">After</th>
        </tr>
      </thead>
      {[...groups].map(([key, paths]) => {
        const nested = isPlainObject(before[key]) || isPlainObject(after[key]);
        return (
          <tbody key={key} className="border-t border-hair">
            {paths.map((path) => (
              <tr key={path} className="align-top">
                <td className="py-1.5 pr-2 font-mono text-xs break-all text-ink-2">{path}</td>
                <td className="py-1.5">
                  <Wash tone="bad" value={old.get(path)} />
                </td>
                <td className="py-1.5 pl-2">
                  <Wash tone="ok" value={now.get(path)} />
                </td>
              </tr>
            ))}
            {nested && (
              <tr>
                <td colSpan={3} className="pb-2">
                  <button
                    type="button"
                    aria-expanded={full === key}
                    className="text-xs font-semibold text-brand-ink hover:underline"
                    onClick={() => setFull(full === key ? null : key)}
                  >
                    {full === key ? "Hide full value" : `Show full value of ${key}`}
                  </button>
                </td>
              </tr>
            )}
            {nested && full === key && (
              <tr className="align-top">
                <td />
                <td className="pb-2">
                  <Value value={before[key]} />
                </td>
                <td className="pb-2 pl-2">
                  <Value value={after[key]} />
                </td>
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}

/** A changed value on its wash: bad for what it was, ok for what it became. */
function Wash({ tone, value }: { tone: "bad" | "ok"; value: unknown }) {
  if (value === undefined) return <span className="text-xs text-ink-3">not set</span>;
  return (
    <div
      className={cn(
        "rounded-md px-1.5 py-0.5 break-words [&_pre]:bg-transparent [&_pre]:p-0",
        tone === "bad" ? "bg-bad-wash" : "bg-ok-wash",
      )}
    >
      <Value value={value} />
    </div>
  );
}

/** The target's own page, when it has one and still exists. */
function TargetLink({
  type,
  id,
  deleted,
  children,
}: {
  type: AuditTargetType;
  id: string | null;
  deleted: boolean;
  children: ReactNode;
}) {
  const className = "text-brand-ink hover:underline";
  if (!id || deleted) return children;
  const params = { id };
  switch (type) {
    case "template":
      return (
        <Link to="/templates/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "theme":
      return (
        <Link to="/themes/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "snippet":
      return (
        <Link to="/snippets/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "share_link":
      return (
        <Link to="/share-links/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "service_account":
      return (
        <Link to="/admin/service-accounts/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "batch":
      return (
        <Link to="/batches/$id" params={params} className={className}>
          {children}
        </Link>
      );
    case "generation":
      return (
        <Link to="/generations/$id" params={params} className={className}>
          {children}
        </Link>
      );
    default:
      return children;
  }
}

/** An id in mono with a copy button, for quoting in support tickets. */
function CopyableId({ id, label }: { id: string | null; label: string }) {
  if (!id) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex items-start gap-2">
      <span className="min-w-0 pt-1 font-mono text-xs break-all">{id}</span>
      <CopyButton
        text={id}
        label=""
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="shrink-0"
      />
    </span>
  );
}

export function AuditEntrySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const entry = useQuery({ ...auditEntryQuery(id ?? ""), enabled: id !== null });
  const e = entry.data;
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="gap-2">
          <SheetTitle className="text-xl">
            {e ? (
              <>
                <span className="text-ink-3">{words(e.targetType)}</span>{" "}
                <TargetLink
                  type={e.targetType}
                  id={e.targetId}
                  deleted={e.action.endsWith(".deleted")}
                >
                  {e.targetName ?? e.targetId ?? ""}
                </TargetLink>
              </>
            ) : (
              "Audit entry"
            )}
          </SheetTitle>
          {e && (
            <SheetDescription render={<div />} className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{actionLabel(e.action)}</Badge>
              <span className="font-mono text-xs text-ink-3 tabular-nums">
                {dayjs(e.createdAt).format("YYYY-MM-DD HH:mm:ss")}
              </span>
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <ErrorAlert error={entry.error} />
          {e && (
            <>
              <dl className="grid grid-cols-[7rem_1fr] items-baseline gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-3">Actor</dt>
                <dd className="min-w-0">
                  <ActorCell entry={e} />
                  {e.actorId && <CopyableId id={e.actorId} label="actor ID" />}
                </dd>
                {e.apiKeyId && (
                  <>
                    <dt className="text-ink-3">API key</dt>
                    <dd className="min-w-0">
                      <CopyableId id={e.apiKeyId} label="API key ID" />
                    </dd>
                  </>
                )}
                <dt className="text-ink-3">Target ID</dt>
                <dd className="min-w-0">
                  <CopyableId id={e.targetId} label="target ID" />
                </dd>
                <dt className="text-ink-3">IP</dt>
                <dd className="font-mono text-xs">{e.ip ?? "—"}</dd>
                <dt className="text-ink-3">User agent</dt>
                <dd className="text-xs break-all text-ink-2">{e.userAgent ?? "—"}</dd>
                <dt className="text-ink-3">Request ID</dt>
                <dd className="min-w-0">
                  <CopyableId id={e.requestId} label="request ID" />
                </dd>
              </dl>
              {(e.before || e.after) && (
                <section className="space-y-2">
                  <h3 className="font-heading text-[15.5px] font-bold">Changes</h3>
                  <AuditDiff before={e.before} after={e.after} />
                </section>
              )}
              {e.details && (
                <section className="space-y-2">
                  <h3 className="font-heading text-[15.5px] font-bold">Details</h3>
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
    <Card className="gap-3 pb-2">
      <CardHeader className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-[17px] leading-snug font-bold tracking-tight">History</h2>
        {total > 0 && (
          <Link
            to="/admin/audit"
            search={{ targetType, targetId }}
            className="text-sm font-semibold text-brand-ink hover:underline"
          >
            {total > 20
              ? `All ${total.toLocaleString()} in the audit log`
              : "Open in the audit log"}
          </Link>
        )}
      </CardHeader>
      {history.error && (
        <CardContent>
          <ErrorAlert error={history.error} />
        </CardContent>
      )}
      {history.data && !history.data.items.length && (
        <CardContent className="pb-3 text-ink-3">Nothing recorded yet.</CardContent>
      )}
      {history.data?.items.length ? (
        <ul className="divide-y divide-hair border-t border-hair">
          {history.data.items.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-tint"
                onClick={() => setOpen(entry.id)}
              >
                <span className="font-mono text-xs text-ink-3 tabular-nums">
                  {dayjs(entry.createdAt).format("YYYY-MM-DD HH:mm")}
                </span>
                <Badge variant="secondary">{actionLabel(entry.action)}</Badge>
                <ActorCell entry={entry} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <AuditEntrySheet id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
