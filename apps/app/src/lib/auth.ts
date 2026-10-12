import { ssoClient } from "@better-auth/sso/client";
import { ac, hasPermission, type ReturnPath, roles, type statements } from "@necodoc/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ApiError, api, ok } from "./api";

// Spec: docs/features/user-management-and-roles.md
export const authClient = createAuthClient({ plugins: [adminClient({ ac, roles }), ssoClient()] });

/** Password on or off, and the SSO providers to offer (docs/features/single-sign-on.md). */
export const signInOptionsQuery = queryOptions({
  queryKey: ["sign-in-options"],
  queryFn: async () => (await ok(api.sso.options.$get())).json(),
  staleTime: Number.POSITIVE_INFINITY,
});

/** The signed-in user with parsed roles, or null when signed out. */
async function fetchMe() {
  const res = await api.me.$get();
  if (res.status === 401) return null;
  // The public demo limits sign-ins per address (ADR 0046): show the API's message.
  if (res.status === 429) await ok(res);
  if (!res.ok) throw new ApiError(`Couldn't load your account (${res.status})`, res.status);
  return res.json();
}

export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;
type Roles = Me["user"]["roles"];

/** Who may open a page: admins, or anyone granted at least one of these document actions. */
export type Access = "admin" | readonly (typeof statements.document)[number][];

export function canAccess(roles: Roles, access: Access) {
  return access === "admin"
    ? roles.includes("admin")
    : access.some((action) => hasPermission(roles, { document: [action] }));
}

/**
 * Route guard for `beforeLoad`. Throws a 403 so the route's error screen says "You don't have
 * access to this" at the URL that was asked for, instead of silently redirecting.
 */
export function requireAccess(me: Me, access: Access) {
  if (!canAccess(me.user.roles, access)) {
    throw new ApiError("You don't have access to this", 403);
  }
}

// Every route waits on this, so ride out an API restart (502s for a few seconds) instead of
// failing the page. ensureQueryData doesn't retry unless the query says so.
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: fetchMe,
  retry: (failures, error) => failures < 5 && !(error instanceof ApiError && error.status === 429),
  retryDelay: (failures) => Math.min(1000 * failures, 4000),
});

type AuthResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message?: string; statusText: string } };

/** Better Auth resolves `{ data, error }`; TanStack Query wants a thrown Error. */
export async function unwrap<T>(result: Promise<AuthResult<T>>): Promise<T> {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? error.statusText);
  return data;
}

/**
 * After the session changes (sign in/out, impersonation): refetch `me`, go to `to`, then drop
 * what the old session cached. Not `queryClient.clear()`: that detaches mounted observers,
 * like the impersonation banner's, which then keep showing the old session.
 */
export function useSessionChange() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (to: "/" | "/login" | "/admin/users" | ReturnPath) => {
    await queryClient.resetQueries({ queryKey: meQuery.queryKey });
    await navigate({ href: to });
    queryClient.removeQueries({ type: "inactive" });
  };
}

export function useSignOut() {
  const sessionChanged = useSessionChange();
  return useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    onSuccess: () => sessionChanged("/login"),
  });
}

/**
 * Runs a change to a user, then refetches everything: lists, and `me` plus the route context
 * built from it, so your own name and roles update when you changed yourself.
 */
export function useUserMutation<T>(
  mutationFn: (value: T) => Promise<unknown>,
  onDone?: (value: T) => void,
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn,
    onSuccess: async (_, value) => {
      await queryClient.invalidateQueries();
      await router.invalidate();
      onDone?.(value);
    },
  });
}
