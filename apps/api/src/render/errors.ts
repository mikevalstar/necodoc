// ADR 0020: only infrastructure failures retry. A template or data error fails the same way every
// time, so it fails once; a crashed browser or a dropped database connection may not happen again.

/** Browser or connection trouble, as Playwright and postgres.js report it. */
const INFRASTRUCTURE = [
  /target page, context or browser has been closed/i,
  /browser has been closed/i,
  /browser has disconnected/i,
  /browserType\.launch/i,
  /protocol error/i,
  /crash/i,
  /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT/,
  /connection terminated|CONNECTION_(CLOSED|ENDED|DESTROYED)|CONNECT_TIMEOUT/i,
];

/** Error codes from postgres.js and Node's socket layer. */
const INFRASTRUCTURE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
]);

/**
 * True when the error says nothing about the input, so another attempt may succeed. Render
 * timeouts don't count: a template that takes too long usually takes too long every time.
 */
export function isInfrastructureError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "TargetClosedError") return true;
  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && INFRASTRUCTURE_CODES.has(code)) return true;
  return INFRASTRUCTURE.some((pattern) => pattern.test(error.message));
}
