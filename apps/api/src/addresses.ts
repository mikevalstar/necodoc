import { BlockList, isIP } from "node:net";

// Address rules, kept free of env and the database so they're unit-tested
// (addresses.test.ts). API key allowlists: ADR 0029. Webhook targets: docs/features/webhooks.md.

/** Everything that isn't the public internet: private, loopback, link-local, CGNAT, reserved. */
const nonPublic = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublic.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  // No ::ffff:0:0/96 rule: BlockList checks IPv4-mapped addresses (in any spelling) against the
  // IPv4 rules, and treats every IPv4 address as mapped, so such a rule would refuse them all.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  nonPublic.addSubnet(net, prefix, "ipv6");
}

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** Unwraps IPv4-mapped IPv6 (`::ffff:10.0.0.1`), which would otherwise dodge the IPv4 ranges. */
function normalize(address: string) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return mapped ?? address;
}

/** Whether necodoc may connect to this address (webhooks). Loopback only when allowed. */
export function isAllowedAddress(raw: string, allowLoopback: boolean) {
  const address = normalize(raw);
  const family = isIP(address);
  if (!family) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  if (allowLoopback && loopback.check(address, type)) return true;
  return !nonPublic.check(address, type);
}

/** Matches an address against allowlist entries (addresses or CIDR ranges); empty allows all. */
export function ipAllowed(entries: readonly string[], ip: string) {
  if (!entries.length) return true;
  const address = normalize(ip);
  const family = isIP(address);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of entries) {
    const [net = "", prefix] = entry.split("/");
    const type = isIP(net) === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) list.addAddress(net, type);
    else list.addSubnet(net, Number(prefix), type);
  }
  return list.check(address, family === 6 ? "ipv6" : "ipv4");
}
