import { describe, expect, it } from "vitest";
import { forwardedClient, hostOf, ipAllowed, isAllowedAddress } from "./addresses";

describe("ipAllowed (API key allowlists)", () => {
  it("allows any address with an empty list", () => {
    expect(ipAllowed([], "198.51.100.7")).toBe(true);
  });

  it("matches single addresses and CIDR ranges, IPv4 and IPv6", () => {
    const list = ["203.0.113.7", "10.0.0.0/8", "2001:db8::/32"];
    expect(ipAllowed(list, "203.0.113.7")).toBe(true);
    expect(ipAllowed(list, "10.20.30.40")).toBe(true);
    expect(ipAllowed(list, "2001:db8::1")).toBe(true);
    expect(ipAllowed(list, "203.0.113.8")).toBe(false);
    expect(ipAllowed(list, "2001:db9::1")).toBe(false);
  });

  it("reads IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(ipAllowed(["127.0.0.1"], "::ffff:127.0.0.1")).toBe(true);
  });

  it("refuses what isn't an address", () => {
    expect(ipAllowed(["10.0.0.0/8"], "unknown")).toBe(false);
  });
});

describe("isAllowedAddress (webhook targets)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "::ffff:c0a8:101",
  ])("refuses %s", (address) => {
    expect(isAllowedAddress(address, false)).toBe(false);
  });

  it.each(["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"])("allows %s", (address) => {
    expect(isAllowedAddress(address, false)).toBe(true);
  });

  it("allows loopback only when asked, and nothing else private", () => {
    expect(isAllowedAddress("127.0.0.1", true)).toBe(true);
    expect(isAllowedAddress("::1", true)).toBe(true);
    expect(isAllowedAddress("10.0.0.1", true)).toBe(false);
  });
});

describe("hostOf", () => {
  it("keeps only the host and port", () => {
    expect(hostOf("https://user:secret@otel.example.com:4318/v1/traces?token=x")).toBe(
      "otel.example.com:4318",
    );
    expect(hostOf("http://tsa.example.com")).toBe("tsa.example.com");
  });

  it("is null for nothing or a non-URL", () => {
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf("")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("forwardedClient (TRUST_PROXY)", () => {
  it("reads nothing with no trusted proxies or no header", () => {
    expect(forwardedClient("203.0.113.7", 0)).toBeUndefined();
    expect(forwardedClient(undefined, 1)).toBeUndefined();
  });

  it("takes the hop added by the one proxy", () => {
    expect(forwardedClient("198.51.100.1, 203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("skips the TLS proxy nginx adds behind a second proxy", () => {
    // Client 203.0.113.7 -> TLS proxy 10.0.0.2 -> nginx -> API; the client forged the first hop.
    expect(forwardedClient("198.51.100.1, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
  });

  it("takes the first hop when there are fewer than the trusted count", () => {
    expect(forwardedClient("203.0.113.7", 2)).toBe("203.0.113.7");
  });
});
