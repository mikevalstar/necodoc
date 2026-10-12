import {
  type SavedView,
  type SavedViewSearch,
  type SavedViewTable,
  savedViewSearchSchema,
} from "@necodoc/shared";
import {
  ArrowsClockwiseIcon,
  BookmarkSimpleIcon,
  TrashIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ok } from "@/lib/api";

// Spec: docs/features/saved-views.md. A view is the table's URL search under a name. The menu sits
// in the data table's toolbar; `SavedViewList` is the same list for a sidebar.

export const savedViewsQuery = (table: SavedViewTable) =>
  queryOptions({
    queryKey: ["saved-views", table],
    queryFn: async () => (await ok(api["saved-views"].$get({ query: { table } }))).json(),
  });

/** URL state minus `omit` (page, an open drawer) and unset values, ready to store or compare. */
export function viewSearch(search: object, omit: readonly string[]): SavedViewSearch | null {
  const kept = Object.fromEntries(
    Object.entries(search).filter(([key, value]) => value !== undefined && !omit.includes(key)),
  );
  return savedViewSearchSchema.safeParse(kept).data ?? null;
}

/** Same filters, whatever the key order. */
const sameSearch = (a: SavedViewSearch, b: SavedViewSearch) => {
  const sorted = (search: SavedViewSearch) =>
    JSON.stringify(Object.entries(search).sort(([x], [y]) => x.localeCompare(y)));
  return sorted(a) === sorted(b);
};

export function SavedViews({
  table,
  search,
  onApply,
  isAdmin,
  omit = ["page"],
}: {
  table: SavedViewTable;
  /** The table's URL search as the route parsed it. */
  search: object;
  /** Replace the URL search with the view's (validate it with the route's schema). */
  onApply: (search: SavedViewSearch) => void;
  isAdmin: boolean;
  /** Search keys that aren't part of a view. */
  omit?: readonly string[];
}) {
  const views = useQuery(savedViewsQuery(table));
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const current = viewSearch(search, omit);
  const matching = current
    ? views.data?.find((view) => sameSearch(view.search, current))
    : undefined;
  const mine = views.data?.filter((view) => !view.shared) ?? [];
  const shared = views.data?.filter((view) => view.shared) ?? [];

  const group = (label: string, list: SavedView[]) =>
    list.length > 0 && (
      <DropdownMenuGroup>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {list.map((view) => (
          <DropdownMenuRadioItem key={view.id} value={view.id}>
            <span className="truncate">{view.name}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuGroup>
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="secondary" size="sm" className="max-w-48" />}
          aria-label={matching ? `Saved views, showing ${matching.name}` : "Saved views"}
        >
          <BookmarkSimpleIcon weight={matching ? "fill" : "regular"} />
          <span className="truncate">{matching?.name ?? "Views"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuRadioGroup
            value={matching?.id ?? ""}
            onValueChange={(id) => {
              const view = views.data?.find((v) => v.id === id);
              if (view) onApply(view.search);
            }}
          >
            {group("My views", mine)}
            {mine.length > 0 && shared.length > 0 && <DropdownMenuSeparator />}
            {group("Shared", shared)}
          </DropdownMenuRadioGroup>
          {views.data?.length === 0 && (
            <p className="px-2 py-1.5 text-[13px] text-ink-3">
              No saved views yet. Set filters, sort and columns, then save them here.
            </p>
          )}
          {views.error && <p className="px-2 py-1.5 text-[13px] text-bad">Couldn't load views.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!current} onClick={() => setDialog("save")}>
            Save current view…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!views.data?.some((view) => view.canEdit)}
            onClick={() => setDialog("manage")}
          >
            Manage views…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "save" && current && (
        <SaveViewDialog
          table={table}
          search={current}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && current && (
        <ManageViewsDialog
          table={table}
          views={views.data?.filter((view) => view.canEdit) ?? []}
          current={current}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** The views as plain links (a sidebar under the table's nav entry). */
export function SavedViewList({
  table,
  link,
}: {
  table: SavedViewTable;
  /** A router link to the table with the view's search. */
  link: (view: SavedView) => ReactNode;
}) {
  const views = useQuery(savedViewsQuery(table));
  if (!views.data?.length) return null;
  return (
    <ul className="space-y-0.5">
      {views.data.map((view) => (
        <li key={view.id}>{link(view)}</li>
      ))}
    </ul>
  );
}

const saveSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  shared: z.boolean(),
});

function SaveViewDialog({
  table,
  search,
  isAdmin,
  onClose,
}: {
  table: SavedViewTable;
  search: SavedViewSearch;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: async (value: z.infer<typeof saveSchema>) =>
      (await ok(api["saved-views"].$post({ json: { table, search, ...value } }))).json(),
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-views", table] });
      toast.success(`Saved view “${view.name}”`);
      onClose();
    },
  });
  const form = useAppForm({
    defaultValues: { name: "", shared: false },
    validators: { onChange: saveSchema },
    onSubmit: ({ value }) => create.mutate(value),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Keeps the current filters, sort, page size and columns under a name.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" autoFocus placeholder="Failed API renders" />
              )}
            </form.AppField>
            {isAdmin && (
              <form.AppField name="shared">
                {(field) => (
                  <field.SwitchField label="Share with everyone who can open this table" />
                )}
              </form.AppField>
            )}
          </FieldGroup>
          <ErrorAlert error={create.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageViewsDialog({
  table,
  views,
  current,
  isAdmin,
  onClose,
}: {
  table: SavedViewTable;
  views: SavedView[];
  current: SavedViewSearch;
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage views</DialogTitle>
          <DialogDescription>
            Rename, update to the current filters, {isAdmin ? "share, " : ""}or delete. Shared views
            show for everyone{isAdmin ? "; changes to them are audited" : ""}.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-hair">
          {views.map((view) => (
            <ManageViewRow
              key={view.id}
              table={table}
              view={view}
              current={current}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageViewRow({
  table,
  view,
  current,
  isAdmin,
}: {
  table: SavedViewTable;
  view: SavedView;
  current: SavedViewSearch;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(view.name);
  const done = () => queryClient.invalidateQueries({ queryKey: ["saved-views", table] });
  const update = useMutation({
    mutationFn: async (json: { name?: string; search?: SavedViewSearch; shared?: boolean }) =>
      (await ok(api["saved-views"][":id"].$patch({ param: { id: view.id }, json }))).json(),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => ok(api["saved-views"][":id"].$delete({ param: { id: view.id } })),
    onSuccess: done,
  });
  const trimmed = name.trim();
  const upToDate = sameSearch(view.search, current);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-48 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && trimmed !== view.name) update.mutate({ name: trimmed });
          }}
        >
          <Input
            aria-label={`Name of ${view.name}`}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          {trimmed !== view.name && (
            <Button type="submit" variant="secondary" disabled={!trimmed || update.isPending}>
              Rename
            </Button>
          )}
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          title={upToDate ? "Matches the current filters" : "Update to the current filters"}
          aria-label={`Update ${view.name} to the current filters`}
          disabled={upToDate || update.isPending}
          onClick={() => update.mutate({ search: current })}
        >
          <ArrowsClockwiseIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete"
          aria-label={`Delete ${view.name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <TrashIcon />
        </Button>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <Switch
            id={`shared-${view.id}`}
            checked={view.shared}
            disabled={update.isPending}
            onCheckedChange={(shared) => update.mutate({ shared })}
          />
          <UsersThreeIcon aria-hidden className="size-4 text-ink-3" />
          <label htmlFor={`shared-${view.id}`}>Shared with everyone</label>
          {view.shared && view.ownerName && (
            <span className="text-ink-3">· by {view.ownerName}</span>
          )}
        </div>
      )}
      <ErrorAlert error={update.error ?? remove.error} />
    </li>
  );
}
