import {
  type GenerationFilter,
  generationSourceSchema,
  generationStatusSchema,
} from "@necodoc/shared";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, generationPdfUrl, ok } from "@/lib/api";
import { authClient, unwrap } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { formatBytes } from "@/lib/utils";
import { DeleteGenerationDialog, StatusBadge, sourceLabels, useRerun } from "./-generation-actions";

// Spec: docs/features/generation-log.md. The API scopes non-admins to their own entries.
const PAGE_SIZE = 25;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchSchema = z.object({
  source: generationSourceSchema.optional(),
  status: generationStatusSchema.optional(),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  /** Inclusive days, YYYY-MM-DD in local time. */
  from: day.optional(),
  to: day.optional(),
  sort: z.enum(["startedAt", "durationMs"]).default("startedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
});
type GenerationsSearch = z.infer<typeof searchSchema>;

/** The API filter for the URL's filters: whole local days become instants. */
function toFilter({ source, status, userId, templateId, from, to }: GenerationsSearch) {
  return {
    source,
    status,
    userId,
    templateId,
    from: from && dayjs(from).startOf("day").toISOString(),
    to: to && dayjs(to).endOf("day").toISOString(),
  } satisfies GenerationFilter;
}

function generationsQuery(search: GenerationsSearch) {
  return queryOptions({
    queryKey: ["generations", "list", search],
    queryFn: async () =>
      (
        await ok(
          api.generations.$get({
            query: {
              ...toFilter(search),
              sort: search.sort,
              order: search.order,
              limit: String(PAGE_SIZE),
              offset: String((search.page - 1) * PAGE_SIZE),
            },
          }),
        )
      ).json(),
    placeholderData: keepPreviousData,
  });
}

const usersQuery = queryOptions({
  queryKey: ["admin", "users", "all"],
  queryFn: () => unwrap(authClient.admin.listUsers({ query: { limit: 500, sortBy: "name" } })),
});

export const Route = createFileRoute("/_app/generations/")({
  validateSearch: searchSchema,
  component: Generations,
});

type Dialog = { kind: "delete"; generation: { id: string; filename: string } } | { kind: "bulk" };

function Generations() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const isAdmin = me.user.roles.includes("admin");
  const generations = useQuery(generationsQuery(search));
  const users = useQuery({ ...usersQuery, enabled: isAdmin });
  const rerun = useRerun();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setDialog(null);

  const setSearch = (next: Partial<GenerationsSearch>) =>
    navigate({ search: { ...search, page: 1, ...next } });
  const hasFilter = Object.values(toFilter(search)).some(Boolean);
  const total = generations.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortHeader = (column: GenerationsSearch["sort"], label: string) => {
    const active = search.sort === column;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() =>
          setSearch({
            sort: column,
            order: active && search.order === "desc" ? "asc" : "desc",
          })
        }
      >
        {label}
        {active &&
          (search.order === "desc" ? (
            <ArrowDownIcon className="size-3.5" />
          ) : (
            <ArrowUpIcon className="size-3.5" />
          ))}
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{isAdmin ? "Generations" : "My generations"}</h1>
          <p className="text-sm text-muted-foreground">
            Every PDF rendered{isAdmin ? "" : " by you"}, with its input and output. Previews aren't
            logged.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            className="text-destructive"
            disabled={!hasFilter || total === 0}
            title={hasFilter ? undefined : "Pick at least one filter first"}
            onClick={() => setDialog({ kind: "bulk" })}
          >
            Delete matching…
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Source"
          value={search.source}
          options={generationSourceSchema.options.map((value) => ({
            value,
            label: sourceLabels[value],
          }))}
          onChange={(value) => setSearch({ source: generationSourceSchema.safeParse(value).data })}
        />
        <FilterSelect
          label="Status"
          value={search.status}
          options={[
            { value: "success", label: "Success" },
            { value: "error", label: "Error" },
          ]}
          onChange={(value) => setSearch({ status: generationStatusSchema.safeParse(value).data })}
        />
        {isAdmin && (
          <FilterSelect
            label="User"
            value={search.userId}
            options={(users.data?.users ?? []).map((user) => ({
              value: user.id,
              label: user.name,
            }))}
            onChange={(value) => setSearch({ userId: value || undefined })}
          />
        )}
        <Field className="w-auto">
          <FieldLabel htmlFor="templateId">Template id</FieldLabel>
          <Input
            id="templateId"
            className="w-44 font-mono text-xs"
            placeholder="Any"
            defaultValue={search.templateId ?? ""}
            onBlur={(e) =>
              setSearch({ templateId: z.uuid().safeParse(e.target.value.trim()).data })
            }
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="from">From</FieldLabel>
          <Input
            id="from"
            type="date"
            value={search.from ?? ""}
            onChange={(e) => setSearch({ from: e.target.value || undefined })}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="to">To</FieldLabel>
          <Input
            id="to"
            type="date"
            value={search.to ?? ""}
            onChange={(e) => setSearch({ to: e.target.value || undefined })}
          />
        </Field>
        {hasFilter && (
          <Button variant="ghost" onClick={() => navigate({ search: { page: 1 } })}>
            Clear filters
          </Button>
        )}
      </div>

      <ErrorAlert error={generations.error ?? rerun.error} />
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{sortHeader("startedAt", "Started")}</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Source</TableHead>
            {isAdmin && <TableHead className="hidden md:table-cell">User</TableHead>}
            <TableHead className="hidden md:table-cell">Pages</TableHead>
            <TableHead className="hidden md:table-cell">Size</TableHead>
            <TableHead className="hidden sm:table-cell">
              {sortHeader("durationMs", "Duration")}
            </TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {generations.data?.items.map((generation) => (
            <TableRow key={generation.id}>
              <TableCell className="whitespace-nowrap">
                <Link
                  to="/generations/$id"
                  params={{ id: generation.id }}
                  className="font-medium hover:underline"
                >
                  {dayjs(generation.startedAt).format("YYYY-MM-DD HH:mm:ss")}
                </Link>
              </TableCell>
              <TableCell className="max-w-48 truncate" title={generation.filename}>
                {generation.filename}
                {generation.templateId && (
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {generation.templateId}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={generation.status} />
                {generation.warnings.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {generation.warnings.length} warning{generation.warnings.length > 1 && "s"}
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {sourceLabels[generation.source]}
              </TableCell>
              {isAdmin && (
                <TableCell className="hidden md:table-cell">{generation.userName ?? "—"}</TableCell>
              )}
              <TableCell className="hidden md:table-cell">{generation.pageCount ?? "—"}</TableCell>
              <TableCell className="hidden md:table-cell">
                {generation.size === null ? "—" : formatBytes(generation.size)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {(generation.durationMs / 1000).toFixed(2)} s
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={<Link to="/generations/$id" params={{ id: generation.id }} />}
                    >
                      Open
                    </DropdownMenuItem>
                    {generation.hasOutput && (
                      <DropdownMenuItem
                        render={
                          <a
                            href={generationPdfUrl(generation.id)}
                            download={generation.filename}
                          />
                        }
                      >
                        Download PDF
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={rerun.isPending}
                      onClick={() => rerun.mutate(generation.id)}
                    >
                      Re-run
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDialog({ kind: "delete", generation })}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {generations.data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No generations found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} {total === 1 ? "generation" : "generations"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={search.page <= 1}
            onClick={() => navigate({ search: { ...search, page: search.page - 1 } })}
          >
            Previous
          </Button>
          <span>
            Page {search.page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={search.page >= pages}
            onClick={() => navigate({ search: { ...search, page: search.page + 1 } })}
          >
            Next
          </Button>
        </div>
      </div>

      {dialog?.kind === "delete" && (
        <DeleteGenerationDialog
          generation={dialog.generation}
          onClose={close}
          onDeleted={() => {
            close();
            setNotice(`Deleted ${dialog.generation.filename}.`);
          }}
        />
      )}
      {dialog?.kind === "bulk" && (
        <BulkDeleteDialog
          search={search}
          total={total}
          onClose={close}
          onDone={(deleted) => {
            close();
            setNotice(`Deleted ${deleted} ${deleted === 1 ? "generation" : "generations"}.`);
          }}
        />
      )}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">Any</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

/** Admins only. The API refuses an empty filter, so the whole log can't go in one click. */
function BulkDeleteDialog({
  search,
  total,
  onClose,
  onDone,
}: {
  search: GenerationsSearch;
  total: number;
  onClose: () => void;
  onDone: (deleted: number) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => (await ok(api.generations.$delete({ query: toFilter(search) }))).json(),
    onSuccess: async ({ deleted }) => {
      await queryClient.invalidateQueries({ queryKey: ["generations"] });
      onDone(deleted);
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {total} {total === 1 ? "generation" : "generations"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every entry matching the current filters is deleted with its input and PDF, across all
            pages of results. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete {total}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
