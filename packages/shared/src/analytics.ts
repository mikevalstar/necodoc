import { z } from "zod";
import { generationSourceSchema } from "./generation";

// Spec: docs/features/analytics-dashboards.md. Queries for the dashboards; responses are typed
// through the Hono client.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const analyticsBuckets = ["hour", "day", "week"] as const;
export type AnalyticsBucket = (typeof analyticsBuckets)[number];

/** Hours up to 2 days, days up to 90, weeks beyond. */
export function analyticsBucket(from: Date, to: Date): AnalyticsBucket {
  const span = to.getTime() - from.getTime();
  return span <= 2 * DAY ? "hour" : span <= 90 * DAY ? "day" : "week";
}

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const rangeFields = {
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  /** IANA zone the buckets start in (the viewer's). */
  tz: z.string().max(64).refine(isTimeZone, "Unknown time zone").default("UTC"),
};

/** Up to about 13 months, so a bucketed series stays a few hundred points. */
const MAX_SPAN = 400 * DAY;
const validRange = ({ from, to }: { from: string; to: string }) => {
  const span = Date.parse(to) - Date.parse(from);
  return span > 0 && span <= MAX_SPAN;
};
const rangeError = { message: "`from` must be before `to`, at most 400 days apart" };

export const analyticsRangeSchema = z.object(rangeFields).refine(validRange, rangeError);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/** GET /analytics/documents (admin). */
export const documentAnalyticsQuerySchema = z
  .object({
    ...rangeFields,
    source: generationSourceSchema.optional(),
    templateId: z.uuid().optional(),
    userId: z.string().optional(),
    apiKeyId: z.string().optional(),
  })
  .refine(validRange, rangeError);
export type DocumentAnalyticsQuery = z.infer<typeof documentAnalyticsQuerySchema>;

/**
 * How someone signed in. SSO sign-ins are split by the provider's configured protocol; `sso` is
 * a provider that's no longer configured.
 */
export const signInChannels = ["password", "oidc", "saml", "trusted_header", "sso"] as const;
export type SignInChannel = (typeof signInChannels)[number];
