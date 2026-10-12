import { parseRoles, type Role, roleSchema } from "@necodoc/shared";
import {
  CaretLeftIcon,
  CaretRightIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  UserCircleCheckIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import type { UserWithRole } from "better-auth/plugins";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { activeFilter, DebouncedInput, DensityToggle, FilterSelect } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { authClient, unwrap, useSessionChange, useUserMutation } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  BanUserDialog,
  CreateUserDialog,
  DeleteUserDialog,
  EditDetailsDialog,
  EditRolesDialog,
  SetPasswordDialog,
} from "./-user-dialogs";

// Spec: docs/features/user-management-and-roles.md
const PAGE_SIZE = 20;
/** Filtered views are refined in the browser (see usersQuery), over at most this many matches. */
const FILTER_LIMIT = 1000;
/** Pending users shown in the "Waiting for access" card before it links to the full list. */
const PENDING_SHOWN = 5;

const statusSchema = z.enum(["active", "pending", "banned"]);
type Status = z.infer<typeof statusSchema>;

const searchSchema = z.object({
  q: z.string().optional(),
  field: z.enum(["name", "email"]).default("email"),
  role: roleSchema.optional(),
  status: statusSchema.optional(),
  page: z.number().int().min(1).default(1),
});

type UsersSearch = z.infer<typeof searchSchema>;

const statusOf = (user: UserWithRole): Status =>
  user.banned ? "banned" : parseRoles(user.role).length === 0 ? "pending" : "active";

// Service accounts have their own page (ADR 0029). The API returns the flag; Better Auth's type doesn't know it.
const isServiceAccount = (user: UserWithRole) =>
  "serviceAccount" in user && user.serviceAccount === true;

type ListQuery = NonNullable<Parameters<typeof authClient.admin.listUsers>[0]>["query"];
type Filter = Pick<ListQuery, "filterField" | "filterValue" | "filterOperator">;

async function listUsers(query: ListQuery) {
  const result = await unwrap(authClient.admin.listUsers({ query }));
  return { users: result?.users ?? [], total: result?.total ?? 0 };
}

/**
 * Better Auth's listUsers takes a single filter, and the unfiltered list spends it on hiding
 * service accounts. A role or status view spends it on the narrowest condition instead, then the
 * browser drops service accounts, applies the rest exactly (role "viewer" is a substring of
 * "reviewer") and pages the result.
 */
function serverFilter({ role, status }: UsersSearch): Filter {
  if (status === "pending") return { filterField: "role", filterValue: "", filterOperator: "eq" };
  if (status === "banned")
    return { filterField: "banned", filterValue: true, filterOperator: "eq" };
  if (role) return { filterField: "role", filterValue: role, filterOperator: "contains" };
  return { filterField: "banned", filterValue: false, filterOperator: "eq" };
}

function usersQuery(search: UsersSearch) {
  const { q, field, role, status, page } = search;
  const filtered = role !== undefined || status !== undefined;
  return queryOptions({
    queryKey: ["admin", "users", { q, field, role, status, page: filtered ? 0 : page }],
    queryFn: async () => {
      const result = await listUsers({
        searchValue: q || undefined,
        searchField: field,
        searchOperator: "contains",
        ...(filtered
          ? { ...serverFilter(search), limit: FILTER_LIMIT }
          : {
              filterField: "serviceAccount",
              filterValue: false,
              filterOperator: "eq",
              limit: PAGE_SIZE,
              offset: (page - 1) * PAGE_SIZE,
            }),
        sortBy: "createdAt",
        sortDirection: "desc",
      });
      if (!filtered) return { ...result, truncated: false };
      const matches = result.users.filter(
        (user) =>
          !isServiceAccount(user) &&
          (role === undefined || parseRoles(user.role).includes(role)) &&
          (status === undefined || statusOf(user) === status),
      );
      return { users: matches, total: matches.length, truncated: result.total > FILTER_LIMIT };
    },
    placeholderData: keepPreviousData,
  });
}

const pendingQuery = queryOptions({
  queryKey: ["admin", "users", "pending"],
  queryFn: async () => {
    const { users } = await listUsers({
      filterField: "role",
      filterValue: "",
      filterOperator: "eq",
      limit: FILTER_LIMIT,
      sortBy: "createdAt",
      sortDirection: "asc",
    });
    return users.filter((user) => !isServiceAccount(user) && !user.banned);
  },
});

export const Route = createFileRoute("/_app/admin/users")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: Users,
});

type Dialog =
  | { kind: "create" }
  | {
      kind: "details" | "roles" | "ban" | "password" | "delete" | "revoke" | "impersonate";
      user: UserWithRole;
    };

function Users() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const users = useQuery(usersQuery(search));
  const pending = useQuery(pendingQuery);
  const filtered = search.role !== undefined || search.status !== undefined;
  const rows = filtered
    ? users.data?.users.slice((search.page - 1) * PAGE_SIZE, search.page * PAGE_SIZE)
    : users.data?.users;
  const ids = rows?.map((u) => u.id).join(",") ?? "";
  // How each user signs in: password and/or SSO providers (docs/features/single-sign-on.md).
  const methods = useQuery({
    queryKey: ["admin", "sign-in-methods", ids],
    queryFn: async () => (await ok(api.sso["sign-in-methods"].$get({ query: { ids } }))).json(),
    enabled: ids !== "",
    placeholderData: keepPreviousData,
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    toast.success(message);
  };
  const setFilter = (next: Partial<UsersSearch>) =>
    navigate({ search: { ...search, ...next, page: 1 } });

  const unban = useUserMutation(
    (user: UserWithRole) => unwrap(authClient.admin.unbanUser({ userId: user.id })),
    (user) => toast.success(`Unbanned ${user.name}.`),
  );
  const revokeSessions = useUserMutation(
    (user: UserWithRole) => unwrap(authClient.admin.revokeUserSessions({ userId: user.id })),
    (user) => done(`Signed ${user.name} out everywhere.`),
  );
  const sessionChanged = useSessionChange();
  const impersonate = useMutation({
    mutationFn: (userId: string) => unwrap(authClient.admin.impersonateUser({ userId })),
    onSuccess: () => sessionChanged("/"),
  });

  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goTo = (page: number) => navigate({ search: { ...search, page } });
  const createUser = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <PlusIcon weight="bold" />
      Create user
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="Users"
        description="People who can sign in, their roles and how they sign in. New registrations wait here without a role until you give them one."
        actions={
          <>
            <FaqLink feature="Users and roles" />
            {createUser}
          </>
        }
      />

      <ErrorAlert error={pending.error ?? unban.error} />

      {!!pending.data?.length && (
        <Card className="gap-0 py-0" aria-labelledby="pending-title">
          <div className="flex flex-wrap items-center gap-3 border-b border-hair px-5 py-3.5">
            <UserCircleCheckIcon className="size-5 text-brand-ink" aria-hidden />
            <h2 id="pending-title" className="font-heading text-[17px] font-bold tracking-tight">
              Waiting for access
            </h2>
            <Badge variant="sun">{pending.data.length}</Badge>
            <p className="text-sm text-ink-3">
              They signed up and see only a "waiting for access" page until you grant a role.
            </p>
          </div>
          <ul className="divide-y divide-hair">
            {pending.data.slice(0, PENDING_SHOWN).map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 compact:py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{user.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {user.email} · signed up{" "}
                    <time dateTime={dayjs(user.createdAt).toISOString()}>
                      {dayjs(user.createdAt).fromNow()}
                    </time>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDialog({ kind: "delete", user })}
                  >
                    Delete…
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: "roles", user })}
                  >
                    Grant access…
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {pending.data.length > PENDING_SHOWN && search.status !== "pending" && (
            <div className="border-t border-hair px-5 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => setFilter({ status: "pending" })}>
                Show all {pending.data.length} pending users
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <DebouncedInput
              type="search"
              aria-label={`Search users by ${search.field}`}
              className={cn("w-48 pl-9", search.q && activeFilter)}
              placeholder={search.field === "email" ? "Search email…" : "Search name…"}
              title="Matches part of the name or email. Case-sensitive."
              value={search.q ?? ""}
              onCommit={(q) => setFilter({ q: q.trim() || undefined })}
            />
          </div>
          <NativeSelect
            aria-label="Search by"
            title="Search by"
            value={search.field}
            onChange={(e) => setFilter({ field: e.target.value === "name" ? "name" : "email" })}
          >
            <NativeSelectOption value="email">By email</NativeSelectOption>
            <NativeSelectOption value="name">By name</NativeSelectOption>
          </NativeSelect>
          <FilterSelect
            label="Role"
            value={search.role}
            options={roleSchema.options.map((role) => ({
              value: role,
              label: role.charAt(0).toUpperCase() + role.slice(1),
            }))}
            onChange={(value) => setFilter({ role: roleSchema.safeParse(value).data })}
          />
          <FilterSelect
            label="Status"
            value={search.status}
            options={[
              { value: "active", label: "Active" },
              { value: "pending", label: "Pending" },
              { value: "banned", label: "Banned" },
            ]}
            onChange={(value) => setFilter({ status: statusSchema.safeParse(value).data })}
          />
          <div className="ml-auto">
            <DensityToggle />
          </div>
        </div>

        {users.error && (
          <div className="p-4">
            <ErrorAlert error={users.error} />
          </div>
        )}
        {users.isPending && <ListSkeleton className="p-4" />}
        {rows?.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            className="m-4"
            title={search.q || filtered ? "No users match" : "No users yet"}
            description={
              search.q || filtered
                ? "Nobody matches this search and these filters. Search is case-sensitive."
                : "Create an account for someone, or send them to the sign-up page."
            }
            action={
              search.q || filtered ? (
                <Button
                  variant="outline"
                  onClick={() => setFilter({ q: undefined, role: undefined, status: undefined })}
                >
                  Clear filters
                </Button>
              ) : (
                createUser
              )
            }
          />
        )}
        {!!rows?.length && (
          <Table className={cn("transition-opacity", users.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="hidden xl:table-cell">Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Sign-in</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => {
                const roles = parseRoles(user.role);
                const isSelf = user.id === me.user.id;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="max-w-72">
                      <p className="truncate font-semibold">
                        {user.name}
                        {isSelf && <span className="ml-1 font-normal text-ink-3">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-ink-3 xl:hidden">{user.email}</p>
                    </TableCell>
                    <TableCell className="hidden text-ink-2 xl:table-cell">{user.email}</TableCell>
                    <TableCell>
                      {roles.length ? (
                        <RoleBadges roles={roles} />
                      ) : (
                        <span className="text-sm text-ink-3">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserStatus user={user} roles={roles} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {methods.data?.[user.id]?.map((method) => (
                          <Badge key={method} variant="secondary">
                            {method}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <time
                        dateTime={dayjs(user.createdAt).toISOString()}
                        className="font-mono text-xs text-ink-2"
                      >
                        {dayjs(user.createdAt).format("MMM D, YYYY")}
                      </time>
                    </TableCell>
                    <TableCell>
                      <UserActions
                        user={user}
                        roles={roles}
                        isSelf={isSelf}
                        open={(kind) => setDialog({ kind, user })}
                        unban={() => unban.mutate(user)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hair px-4 py-3 text-[13px] text-ink-3">
          <span aria-live="polite">
            {users.data &&
              `${total.toLocaleString()} ${total === 1 ? "user" : "users"}${
                users.data.truncated
                  ? ` in the first ${FILTER_LIMIT.toLocaleString()} matches; search to narrow it`
                  : ""
              }`}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="px-2 font-semibold text-ink-2 tabular-nums">
              Page {search.page} of {pages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              title="Previous page"
              disabled={search.page <= 1}
              onClick={() => goTo(Math.min(search.page, pages) - 1)}
            >
              <CaretLeftIcon weight="bold" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              title="Next page"
              disabled={search.page >= pages}
              onClick={() => goTo(search.page + 1)}
            >
              <CaretRightIcon weight="bold" />
            </Button>
          </div>
        </div>
      </Card>

      {dialog?.kind === "create" && <CreateUserDialog onClose={close} onDone={done} />}
      {dialog?.kind === "details" && (
        <EditDetailsDialog user={dialog.user} onClose={close} onDone={done} />
      )}
      {dialog?.kind === "roles" && (
        <EditRolesDialog user={dialog.user} onClose={close} onDone={done} />
      )}
      {dialog?.kind === "ban" && <BanUserDialog user={dialog.user} onClose={close} onDone={done} />}
      {dialog?.kind === "password" && (
        <SetPasswordDialog user={dialog.user} onClose={close} onDone={done} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteUserDialog user={dialog.user} onClose={close} onDone={done} />
      )}
      {dialog?.kind === "revoke" && (
        <ConfirmDialog
          title={`Sign ${dialog.user.name} out everywhere?`}
          description="Every session they have ends now, on every device. They can sign in again straight away; ban them to keep them out."
          confirmLabel="Revoke sessions"
          pending={revokeSessions.isPending}
          error={revokeSessions.error}
          onConfirm={() => revokeSessions.mutate(dialog.user)}
          onClose={close}
        />
      )}
      {dialog?.kind === "impersonate" && (
        <ConfirmDialog
          title={`Impersonate ${dialog.user.name}?`}
          description="You'll see necodoc as they do, with their roles, and anything you do happens as them. The audit log records you as the admin behind it. Stop from the banner at the top of every page."
          confirmLabel="Impersonate"
          destructive={false}
          pending={impersonate.isPending}
          error={impersonate.error}
          onConfirm={() => impersonate.mutate(dialog.user.id)}
          onClose={close}
        />
      )}
    </Page>
  );
}

function UserActions({
  user,
  roles,
  isSelf,
  open,
  unban,
}: {
  user: UserWithRole;
  roles: Role[];
  isSelf: boolean;
  open: (kind: Exclude<Dialog["kind"], "create">) => void;
  unban: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`} />}
      >
        <DotsThreeIcon weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Your own name, password and sessions live in Settings; your own email only another admin changes. */}
        {!isSelf && (
          <DropdownMenuItem onClick={() => open("details")}>Edit details…</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => open("roles")}>
          {roles.length === 0 ? "Grant access…" : "Edit roles…"}
        </DropdownMenuItem>
        {!isSelf && (
          <>
            <DropdownMenuItem onClick={() => open("password")}>Set password…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => open("revoke")}>Revoke sessions…</DropdownMenuItem>
          </>
        )}
        {/* The admin role can't impersonate other admins (Better Auth default). */}
        {!isSelf && !roles.includes("admin") && !user.banned && (
          <DropdownMenuItem onClick={() => open("impersonate")}>Impersonate…</DropdownMenuItem>
        )}
        {/* The API refuses to ban or delete yourself (admin-guard.ts). */}
        {!isSelf && (
          <>
            <DropdownMenuSeparator />
            {user.banned ? (
              <DropdownMenuItem onClick={unban}>Unban</DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => open("ban")}>
                Ban…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => open("delete")}>
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserStatus({ user, roles }: { user: UserWithRole; roles: Role[] }) {
  if (user.banned) {
    return (
      <div className="space-y-1">
        <Badge variant="bad" dot>
          Banned
        </Badge>
        {user.banReason && (
          <p className="max-w-48 truncate text-xs text-ink-3" title={user.banReason}>
            {user.banReason}
          </p>
        )}
      </div>
    );
  }
  if (roles.length === 0) {
    return (
      <Badge variant="warn" dot>
        Pending
      </Badge>
    );
  }
  return (
    <Badge variant="ok" dot>
      Active
    </Badge>
  );
}
