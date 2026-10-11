// ADR 0025: applies apps/api/drizzle (copied to ./drizzle in the image) with drizzle-orm's
// migrator. Same journal table as `drizzle-kit migrate`, so dev and production agree.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), {
  migrationsFolder: new URL("./drizzle", import.meta.url).pathname,
});
await client.end();
console.log("migrate: database is up to date");
