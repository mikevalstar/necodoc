import { ac, roles } from "@necodoc/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { api } from "./api";

// Spec: docs/features/user-management-and-roles.md
export const authClient = createAuthClient({ plugins: [adminClient({ ac, roles })] });

/** The signed-in user with parsed roles, or null when signed out. */
async function fetchMe() {
  const res = await api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Couldn't load your account (${res.status})`);
  return res.json();
}

export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe });

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
  return async (to: "/" | "/login" | "/admin/users") => {
    await queryClient.resetQueries({ queryKey: meQuery.queryKey });
    await navigate({ to });
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
