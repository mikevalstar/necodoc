import {
  type AuditSort,
  auditActionSchema,
  auditActorKindSchema,
  type auditFilterSchema,
  auditTargetTypeSchema,
} from "@necodoc/shared";
import { DownloadSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { InferResponseType } from "hono/client";
import { z } from "zod";
import {
  ActorCell,
  AuditEntrySheet,
  actionLabel,
  actorKindLabels,
  targetTypeLabel,
} from "@/components/audit";
import {
  activeFilter,
  DataTable,
  type DataTableFeatures,
  DebouncedInput,
  dataTableSearchSchema,
  FilterSelect,
} from "@/components/data-table";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ok } from "@/lib/api";
import { authClient, requireAccess, unwrap } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";

// Spec: docs/features/audit-log.md. The API filters, sorts and pages; the URL holds the view.

const sortable = [
  "createdAt",
  "action",
  "targetType",
  "actorName",
] as const satisfies readonly AuditSort[];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchSchema = dataTableSearchSchema(sortable, "createdAt").extend({
  q: z.string().optional(),
  actorId: z.string().optional(),
  actorKind: auditActorKindSchema.optional(),
  action: auditActionSchema.optional(),
  targetType: auditTargetTypeSchema.optional(),
  /** Object pages' History panels link here with their target. */
  targetId: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
  /** The entry open in the drawer. */
  entry: z.uuid().optional(),
});
type AuditSearch = z.infer<typeof searchSchema>;

function toFilter(search: AuditSearch) {
  const { q, actorId, actorKind, action, targetType, targetId, from, to } = search;
  return {
    q: q?.trim() || undefined,
    actorId,
    actorKind,
    action,
    targetType,
    targetId,
    from: from && dayjs(from).startOf("day").toISOString(),
    to: to && dayjs(to).endOf("day").toISOString(),
  } satisfies z.input<typeof auditFilterSchema>;
}

function exportUrl(search: AuditSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toFilter(search))) {
    if (value !== undefined) params.set(key, value);
  }
  return `/api/audit/export.csv?${params}`;
}

function auditQuery(search: AuditSearch) {
  const query = {
    ...toFilter(search),
    sort: search.sort,
    order: search.order,
    limit: String(search.pageSize),
    offset: String((search.page - 1) * search.pageSize),
  };
  return queryOptions({
    queryKey: ["audit", "list", query],
    queryFn: async () => (await ok(api.audit.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
}

const usersQuery = queryOptions({
  queryKey: ["admin", "users", "all"],
  queryFn: () => unwrap(authClient.admin.listUsers({ query: { limit: 500, sortBy: "name" } })),
});

type Entry = InferResponseType<typeof api.audit.$get, 200>["items"][number];

const column = createColumnHelper<DataTableFeatures, Entry>();
const columns = column.columns([
  column.accessor("createdAt", {
    header: "Time",
    // A link as well as the row click, so the entry opens from the keyboard.
    cell: ({ getValue, row: { original } }) => (
      <Link
        from="/admin/audit"
        to="."
        search={(prev) => ({ ...prev, entry: original.id })}
        className="font-mono text-[13px] whitespace-nowrap tabular-nums hover:underline"
      >
        {dayjs(getValue()).format("YYYY-MM-DD HH:mm:ss")}
      </Link>
    ),
    enableHiding: false,
  }),
  column.accessor("action", {
    header: "Action",
    // Failed sign-ins are what a security review scans for; everything else is a plain tag.
    cell: ({ getValue }) => (
      <Badge variant={getValue() === "auth.sign_in_failed" ? "bad" : "secondary"}>
        {actionLabel(getValue())}
      </Badge>
    ),
  }),
  column.accessor("targetType", {
    header: "Target type",
    cell: ({ getValue }) => <span className="text-ink-2">{targetTypeLabel(getValue())}</span>,
    meta: { className: "max-lg:hidden" },
  }),
  column.accessor("targetName", {
    header: "Target",
    cell: ({ row: { original } }) => (
      <span title={original.targetId ?? undefined} className="font-semibold">
        {original.targetName ?? original.targetId ?? "—"}
      </span>
    ),
    meta: { className: "max-w-56 truncate" },
  }),
  column.accessor("actorName", {
    header: "Actor",
    cell: ({ row: { original } }) => <ActorCell entry={original} />,
  }),
  column.accessor("ip", {
    header: "IP",
    cell: ({ getValue }) => <span className="font-mono text-[13px]">{getValue() ?? "—"}</span>,
    meta: { className: "max-lg:hidden" },
  }),
  column.accessor("requestId", {
    header: "Request id",
    cell: ({ getValue }) => <span className="font-mono text-[13px]">{getValue() ?? "—"}</span>,
    meta: { hiddenByDefault: true, className: "max-w-40 truncate" },
  }),
  column.accessor("targetId", {
    header: "Target id",
    cell: ({ getValue }) => <span className="font-mono text-[13px]">{getValue() ?? "—"}</span>,
    meta: { hiddenByDefault: true, className: "max-w-40 truncate" },
  }),
]);

export const Route = createFileRoute("/_app/admin/audit")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => requireAccess(context.me, "admin"),
  component: AuditLog,
});

function AuditLog() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const entries = useQuery(auditQuery(search));
  const users = useQuery(usersQuery);
  const setSearch = (next: Partial<AuditSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  const setFilter = (next: Partial<AuditSearch>) => setSearch({ ...next, page: 1 });
  const hasFilter = Object.values(toFilter(search)).some((value) => value !== undefined);
  // History panels link here by target id; every row then shares the target, so name it.
  const targetName = search.targetId
    ? (entries.data?.items.find((entry) => entry.targetId === search.targetId)?.targetName ??
      search.targetId)
    : undefined;

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Every change to configuration and access, and every sign-in. Entries can't be edited or deleted."
        actions={
          <>
            <FaqLink feature="Audit log" />
            <a href={exportUrl(search)} className={buttonVariants({ variant: "outline" })}>
              <DownloadSimpleIcon />
              Export CSV
            </a>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={entries.data?.items}
        total={entries.data?.total}
        getRowId={(entry) => entry.id}
        state={search}
        onStateChange={setSearch}
        sortable={sortable}
        isFetching={entries.isPlaceholderData}
        error={entries.error}
        noun="event"
        onRowClick={(entry) => setSearch({ entry: entry.id })}
        empty={hasFilter ? "No events match these filters." : "Nothing recorded yet."}
        toolbar={
          <>
            <div className="relative">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <DebouncedInput
                type="search"
                aria-label="Search the audit log"
                className={cn("w-64 pl-9", search.q && activeFilter)}
                placeholder="Target, actor, request ID, IP…"
                title="Target or actor name, request ID, IP, or an exact target ID"
                value={search.q ?? ""}
                onCommit={(q) => setFilter({ q: q.trim() || undefined })}
              />
            </div>
            <FilterSelect
              label="Action"
              value={search.action}
              options={auditActionSchema.options.map((value) => ({
                value,
                label: actionLabel(value),
              }))}
              onChange={(value) => setFilter({ action: auditActionSchema.safeParse(value).data })}
            />
            <FilterSelect
              label="Target type"
              value={search.targetType}
              options={auditTargetTypeSchema.options.map((value) => ({
                value,
                label: targetTypeLabel(value),
              }))}
              onChange={(value) =>
                setFilter({ targetType: auditTargetTypeSchema.safeParse(value).data })
              }
            />
            <FilterSelect
              label="Actor"
              value={search.actorId}
              options={(users.data?.users ?? []).map((user) => ({
                value: user.id,
                label: user.name,
              }))}
              onChange={(value) => setFilter({ actorId: value || undefined })}
            />
            <FilterSelect
              label="Actor kind"
              value={search.actorKind}
              options={auditActorKindSchema.options.map((value) => ({
                value,
                label: actorKindLabels[value],
              }))}
              onChange={(value) =>
                setFilter({ actorKind: auditActorKindSchema.safeParse(value).data })
              }
            />
            {/* biome-ignore lint/a11y/useSemanticElements: a fieldset can't be a flex row in every browser */}
            <div role="group" aria-label="Date range" className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="From"
                title="From (inclusive)"
                className={cn("w-36", search.from && activeFilter)}
                max={search.to}
                value={search.from ?? ""}
                onChange={(e) => setFilter({ from: e.target.value || undefined })}
              />
              <span className="text-[13px] text-ink-3">to</span>
              <Input
                type="date"
                aria-label="To"
                title="To (inclusive)"
                className={cn("w-36", search.to && activeFilter)}
                min={search.from}
                value={search.to ?? ""}
                onChange={(e) => setFilter({ to: e.target.value || undefined })}
              />
            </div>
            {search.targetId && (
              <Button
                variant="ghost"
                className={cn("max-w-64", activeFilter)}
                title={`Target ${search.targetId}. Click to remove this filter.`}
                aria-label={`Remove target filter: ${targetName}`}
                onClick={() => setFilter({ targetId: undefined })}
              >
                <span className="truncate">Target: {targetName}</span>
                <XIcon weight="bold" />
              </Button>
            )}
            {hasFilter && (
              <Button
                variant="ghost"
                onClick={() =>
                  navigate({
                    search: ({ sort, order, pageSize, columns }) => ({
                      sort,
                      order,
                      pageSize,
                      columns,
                    }),
                  })
                }
              >
                <XIcon weight="bold" />
                Clear
              </Button>
            )}
          </>
        }
      />

      <AuditEntrySheet id={search.entry ?? null} onClose={() => setSearch({ entry: undefined })} />
    </Page>
  );
}
