import { z } from "zod";

// Spec: docs/features/single-sign-on.md (ADR 0031).

/** What the login page shows: whether password sign-in is on, and a button per provider. */
export const signInOptionsSchema = z.object({
  password: z.boolean(),
  providers: z.array(
    z.object({ id: z.string(), label: z.string(), type: z.enum(["oidc", "saml", "header"]) }),
  ),
});
export type SignInOptions = z.infer<typeof signInOptionsSchema>;

/** Admin › Users: the user ids on the page, comma-separated. */
export const signInMethodsQuerySchema = z.object({
  ids: z
    .string()
    .transform((ids) => ids.split(",").filter(Boolean))
    .pipe(z.array(z.string()).max(100)),
});
