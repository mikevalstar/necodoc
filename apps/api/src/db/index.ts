import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../env";
import * as schema from "./schema";

export const db = drizzle(env.DATABASE_URL, { schema, casing: "snake_case" });

/** Escapes `\`, `%` and `_` so text matches literally inside a LIKE pattern. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
