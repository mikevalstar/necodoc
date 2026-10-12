import type { AppType } from "@necodoc/api/app";
import { hc } from "hono/client";
import type { Person } from "./people.ts";

// The seed talks to the demo API the way the app does: the typed Hono client, signed in as a
// person, from their office address and browser (docs/features/demo-data-and-screenshots.md).

type Caller = { ip: string; userAgent: string };

export class HttpError extends Error {}

type ApiResponse = { ok: boolean; status: number; text(): Promise<string> };

/** Awaits a client call and narrows it to its successful responses. */
export async function ok<R extends ApiResponse>(
  request: Promise<R>,
  what = "request",
): Promise<Exclude<R, { ok: false }>> {
  const res = await request;
  if (res.ok) return res as Exclude<R, { ok: false }>;
  throw new HttpError(`${what}: ${res.status} ${await res.text()}`);
}

function callerFetch(origin: string, caller: Caller, extra: () => Record<string, string>) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    headers.set("x-forwarded-for", caller.ip);
    headers.set("user-agent", caller.userAgent);
    for (const [name, value] of Object.entries(extra())) headers.set(name, value);
    return fetch(input, { ...init, headers });
  };
}

export type Api = ReturnType<typeof hc<AppType>>["api"];

/** One signed-in person. `api` is the app's typed client; `auth` posts to Better Auth. */
export class Session {
  cookie = "";
  readonly api: Api;

  constructor(
    readonly apiUrl: string,
    readonly origin: string,
    readonly person: Pick<Person, "name" | "email" | "ip" | "userAgent">,
  ) {
    this.api = hc<AppType>(apiUrl, {
      fetch: callerFetch(origin, person, () => this.#cookieHeader()),
    }).api;
  }

  #cookieHeader(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }

  /** Better Auth's own endpoints aren't in AppType. */
  async auth<T>(path: string, body: unknown): Promise<T> {
    const res = await callerFetch(this.origin, this.person, () => this.#cookieHeader())(
      `${this.apiUrl}/api/auth${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new HttpError(`auth${path}: ${res.status} ${await res.text()}`);
    const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "");
    if (cookies.length) this.cookie = cookies.join("; ");
    return (await res.json()) as T;
  }

  async signIn(password: string) {
    await this.auth("/sign-in/email", { email: this.person.email, password });
    return this;
  }

  async signOut() {
    await this.auth("/sign-out", {});
    this.cookie = "";
  }
}
