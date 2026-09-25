import { parseRoles, type Role } from "@necodoc/shared";
import { keepPreviousData, queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import type { UserWithRole } from "better-auth/plugins";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { RoleBadges } from "@/components/role-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient, unwrap, useSessionChange, useUserMutation } from "@/lib/auth";
import { dayjs } from "@/lib/date";
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

const searchSchema = z.object({
  q: z.string().optional(),
  field: z.enum(["name", "email"]).default("email"),
  page: z.number().int().min(1).default(1),
});

type UsersSearch = z.infer<typeof searchSchema>;

function usersQuery({ q, field, page }: UsersSearch) {
  return queryOptions({
    queryKey: ["admin", "users", { q, field, page }],
    queryFn: () =>
      unwrap(
        authClient.admin.listUsers({
          query: {
            searchValue: q || undefined,
            searchField: field,
            searchOperator: "contains",
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            sortBy: "createdAt",
            sortDirection: "desc",
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

export const Route = createFileRoute("/_app/admin/users")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: Users,
});

type Dialog =
  | { kind: "create" }
  | { kind: "details" | "roles" | "ban" | "password" | "delete"; user: UserWithRole };

function Users() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const users = useQuery(usersQuery(search));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState(search.q ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
  };

  const unban = useUserMutation(
    (user: UserWithRole) => unwrap(authClient.admin.unbanUser({ userId: user.id })),
    (user) => setNotice(`Unbanned ${user.name}.`),
  );
  const revokeSessions = useUserMutation(
    (user: UserWithRole) => unwrap(authClient.admin.revokeUserSessions({ userId: user.id })),
    (user) => setNotice(`Signed ${user.name} out everywhere.`),
  );
  const sessionChanged = useSessionChange();
  const impersonate = useMutation({
    mutationFn: (userId: string) => unwrap(authClient.admin.impersonateUser({ userId })),
    onSuccess: () => sessionChanged("/"),
  });
  const rowError = unban.error ?? revokeSessions.error ?? impersonate.error;

  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Button onClick={() => setDialog({ kind: "create" })}>Create user</Button>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: { ...search, q: query || undefined, page: 1 } });
        }}
      >
        <Input
          className="max-w-xs"
          aria-label="Search users"
          placeholder="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Search by"
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={search.field}
          onChange={(e) =>
            navigate({
              search: { ...search, field: e.target.value === "name" ? "name" : "email", page: 1 },
            })
          }
        >
          <option value="email">Email</option>
          <option value="name">Name</option>
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <ErrorAlert error={users.error ?? rowError} />
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Email</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Created</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data?.users.map((user) => {
            const roles = parseRoles(user.role);
            const isSelf = user.id === me.user.id;
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.name}
                  {isSelf && <span className="ml-1 text-muted-foreground">(you)</span>}
                  <div className="text-xs font-normal text-muted-foreground sm:hidden">
                    {user.email}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{user.email}</TableCell>
                <TableCell>
                  <RoleBadges roles={roles} />
                </TableCell>
                <TableCell>
                  <UserStatus user={user} roles={roles} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {dayjs(user.createdAt).format("YYYY-MM-DD")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Your own name is edited in Settings; your own email only by another admin. */}
                      {!isSelf && (
                        <DropdownMenuItem onClick={() => setDialog({ kind: "details", user })}>
                          Edit details
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setDialog({ kind: "roles", user })}>
                        Edit roles
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDialog({ kind: "password", user })}>
                        Set password
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => revokeSessions.mutate(user)}>
                        Revoke sessions
                      </DropdownMenuItem>
                      {/* The admin role can't impersonate other admins (Better Auth default). */}
                      {!isSelf && !roles.includes("admin") && !user.banned && (
                        <DropdownMenuItem onClick={() => impersonate.mutate(user.id)}>
                          Impersonate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {user.banned ? (
                        <DropdownMenuItem onClick={() => unban.mutate(user)}>
                          Unban
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDialog({ kind: "ban", user })}
                        >
                          Ban
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDialog({ kind: "delete", user })}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
          {users.data?.users.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No users found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} {total === 1 ? "user" : "users"}
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
    </main>
  );
}

function UserStatus({ user, roles }: { user: UserWithRole; roles: Role[] }) {
  if (user.banned) {
    return (
      <div className="space-y-1">
        <Badge variant="destructive">Banned</Badge>
        {user.banReason && <div className="text-xs text-muted-foreground">{user.banReason}</div>}
      </div>
    );
  }
  if (roles.length === 0) return <Badge variant="outline">Pending</Badge>;
  return <span className="text-sm text-muted-foreground">Active</span>;
}
