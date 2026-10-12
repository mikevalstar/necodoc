import { z } from "zod";

// Spec: docs/features/app-shell-and-navigation.md (deep links survive sign-in).

// Pages that bounce signed-in users away; returning to one would loop.
const authPages = ["/login", "/register", "/pending"];

/** A path checked by {@link safeReturnPath}; only it makes one. */
export type ReturnPath = string & { readonly __brand: "ReturnPath" };

/**
 * A same-origin relative path (`/templates/abc?tab=fields`), or undefined. Anything that could
 * leave the site is dropped (absolute URLs, `//host`, any backslash, and control characters,
 * which browsers strip, turning `/\t/host` into `//host`), so `?redirect=` can't be an open
 * redirect.
 */
export function safeReturnPath(value: string | null | undefined): ReturnPath | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point.
  if (!value || !/^\/(?!\/)/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return;
  const [pathname = ""] = value.split(/[?#]/, 1);
  if (pathname === "/" || authPages.includes(pathname)) return;
  return value as ReturnPath;
}

/** `?redirect=` on the sign-in pages: unsafe or malformed values become undefined. */
export const returnPathSchema = z
  .string()
  .optional()
  .transform((value) => safeReturnPath(value))
  .catch(undefined);
