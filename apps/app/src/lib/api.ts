import type { AppType } from "@necodoc/api/app";
import { hc } from "hono/client";

export const api = hc<AppType>("/").api;
