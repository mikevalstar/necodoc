import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Spec: docs/features/public-demo.md (Nightly reset), ADR 0045. Free of env and the database: the
// reset script (scripts/demo/src/reset.ts) shares the flag path, and the tests run it as is.

/** Raised by `pnpm demo:reset` while it rebuilds the database; the API answers 503 meanwhile. */
export const resetFlagPath = join(tmpdir(), "necodoc-demo-resetting");

/** A flag this old was left by a reset that was killed; the demo opens again. */
const STALE_MS = 30 * 60_000;

let checked = { at: 0, up: false };

/** Whether a reset is running. Checked at most once a second; every request asks. */
export function demoResetting(now = Date.now()) {
  if (now - checked.at < 1000) return checked.up;
  let up = false;
  try {
    up = now - statSync(resetFlagPath).mtimeMs < STALE_MS;
  } catch {
    // No flag.
  }
  checked = { at: now, up };
  return up;
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `timeZone` at `instant`, to the minute. */
function wallClock(instant: number, timeZone: string): Wall {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, format);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(format.formatToParts(instant).find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

const asUtc = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);

/**
 * The instant the wall clock in `timeZone` reads `wall`. A time skipped by a daylight saving
 * change runs at the same clock time after it (02:30 becomes 03:30); a repeated one runs the
 * first time.
 */
function zonedInstant(wall: Wall, timeZone: string) {
  const guess = asUtc(wall);
  const offsetAt = (instant: number) => asUtc(wallClock(instant, timeZone)) - instant;
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  return asUtc(wallClock(second, timeZone)) === guess ? second : Math.max(first, second);
}

/** The next time after `now` the clock in `timeZone` reads `time` ("HH:MM"). */
export function nextResetAt(now: Date, time: string, timeZone: string): Date {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const today = wallClock(now.getTime(), timeZone);
  for (let days = 0; ; days++) {
    // Date.UTC rolls the day over months and years.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
    const at = zonedInstant(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour,
        minute,
      },
      timeZone,
    );
    if (at > now.getTime()) return new Date(at);
  }
}
