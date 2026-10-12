import type { Role } from "@necodoc/shared";

// Who works at Harbour Surety in the demo (docs/features/demo-data-and-screenshots.md). Fictional
// people on .example addresses; each has an office address and a browser so the audit log reads
// like a real one.

export const DEMO_PASSWORD = "harbour-demo-2026";

const chromeMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const edgeWin =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";
const firefoxWin =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0";
const safariMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15";

export type Person = {
  name: string;
  email: string;
  roles: Role[];
  /** Office address, sent as X-Forwarded-For (the demo API trusts the proxy header). */
  ip: string;
  userAgent: string;
};

const person = (name: string, roles: Role[], ip: string, userAgent: string): Person => ({
  name,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@harbour-surety.example`,
  roles,
  ip,
  userAgent,
});

export const people = {
  /** Platform team; installs and runs it. The screenshots are taken as this person. */
  jordan: person("Jordan Ellis", ["admin"], "10.20.1.12", chromeMac),
  /** Forms lead: builds and publishes templates. */
  priya: person("Priya Natarajan", ["editor", "publisher"], "10.20.4.17", edgeWin),
  /** Surety underwriting manager: publishes. */
  samuel: person("Samuel Okafor", ["publisher"], "10.20.4.31", edgeWin),
  /** Compliance: reviews every change before it's published. */
  marc: person("Marc Tremblay", ["reviewer"], "10.40.2.8", firefoxWin),
  /** Forms designer. */
  elena: person("Elena Rossi", ["editor"], "10.20.4.22", chromeMac),
  /** Fillers: underwriting assistants, a surety agent, claims, the Montréal office. */
  hannah: person("Hannah Lee", ["viewer"], "10.20.6.45", edgeWin),
  tom: person("Tom Bergeron", ["viewer"], "10.30.1.19", safariMac),
  aisha: person("Aisha Rahman", ["viewer"], "10.20.7.63", edgeWin),
  luc: person("Luc Gagnon", ["viewer"], "10.40.3.27", firefoxWin),
} as const satisfies Record<string, Person>;

export type PersonKey = keyof typeof people;

/** Signs up on their own and waits for an admin to give them a role. */
export const pendingPerson = person("Noah Fischer", [], "10.20.6.88", chromeMac);

export const serviceAccounts = {
  policyAdmin: {
    name: "svc-policy-admin",
    description: "Policy administration system: declarations and endorsements at issue.",
    contact: "Policy systems team, #policy-admin-oncall",
  },
  brokerPortal: {
    name: "svc-broker-portal",
    description: "Broker portal: certificates of insurance on demand.",
    contact: "Digital channels, broker-portal@harbour-surety.example",
  },
  renewals: {
    name: "svc-renewals",
    description: "Month-end renewal run.",
    contact: "Personal and commercial lines operations",
  },
  claims: {
    name: "svc-claims-intake",
    description: "Claims intake: acknowledgement letters when a claim is opened.",
    contact: "Claims systems, claims-it@harbour-surety.example",
  },
} as const;

/** Where the integrations call from (the data centre's egress). */
export const systemIp = "10.60.0.14";
export const systemAgent = "harbour-policy-admin/7.4 (+node-fetch)";
