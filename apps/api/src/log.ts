import { env } from "./env";
import { createLogger } from "./observability/logger";

// ADR 0036: the process's logger. Pretty output loads pino-pretty, synchronously, only when asked.

const pretty =
  env.LOG_FORMAT === "pretty"
    ? (await import("pino-pretty")).default({
        sync: true,
        translateTime: "SYS:HH:MM:ss.l",
        singleLine: true,
        ignore: "pid,hostname,role",
      })
    : undefined;

export const log = createLogger({ level: env.LOG_LEVEL, base: { role: env.ROLE } }, pretty);
