import { describe, expect, it } from "vitest";
import {
  authorizeExact,
  classifyAddress,
  fetchAuthorized,
  isPublicAddress,
  normalizeRuntimePreset,
  type OutboundTransport,
  type ResolvedAddress,
} from "../src/index.js";
import { makeGrant, makePresetInput } from "./helpers.js";

function networkOperation(
  overrides: Partial<ReturnType<typeof makeGrant>> = {},
) {
  const normalized = normalizeRuntimePreset(
    makePresetInput({ grants: [makeGrant(overrides)] }),
  );
  expect(normalized.ok).toBe(true);
  if (!normalized.ok) throw new Error("Expected a valid network grant");
  const authorized = authorizeExact(normalized.value, makeGrant(overrides));
  expect(authorized.ok).toBe(true);
  if (!authorized.ok) throw new Error("Expected an authorized operation");
  return authorized.value;
}

function fakeTransport(
  response: Awaited<ReturnType<OutboundTransport["request"]>>,
  calls: unknown[],
): OutboundTransport {
  return {
    async request(options) {
      calls.push(options);
      return response;
    },
  };
}

describe("F6 outbound address and transport policy", () => {
  it("classifies loopback, private, special-use, mapped, and public addresses", () => {
    const unsafe = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
    ];
    for (const address of unsafe) {
      expect(isPublicAddress(address), address).toBe(false);
      expect(classifyAddress(address), address).not.toBe("public");
    }
    for (const address of ["93.184.216.34", "2001:4860:4860::8888"]) {
      expect(isPublicAddress(address), address).toBe(true);
      expect(classifyAddress(address), address).toBe("public");
    }
  });

  it("rejects unsafe or mixed resolver answers before transport", async () => {
    const calls: unknown[] = [];
    const operation = networkOperation();
    const resolver = {
      async lookup(): Promise<readonly ResolvedAddress[]> {
        return [
          { address: "93.184.216.34", family: 4 },
          { address: "192.168.1.1", family: 4 },
        ];
      },
    };
    const result = await fetchAuthorized(operation, {
      resolver,
      transport: fakeTransport(
        {
          status: 200,
          headers: [],
          body: (async function* () {
            yield new Uint8Array([1]);
          })(),
        },
        calls,
      ),
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.address-denied" },
    });
    expect(calls).toHaveLength(0);
  });

  it("pins one deterministic public address and strips caller credentials", async () => {
    const calls: unknown[] = [];
    let lookups = 0;
    const operation = networkOperation();
    const resolver = {
      async lookup(): Promise<readonly ResolvedAddress[]> {
        lookups += 1;
        return [
          { address: "2001:4860:4860::8888", family: 6 },
          { address: "93.184.216.34", family: 4 },
        ];
      },
    };
    const result = await fetchAuthorized(operation, {
      resolver,
      transport: fakeTransport(
        {
          status: 200,
          headers: [["content-type", "text/plain"]],
          body: (async function* () {
            yield new TextEncoder().encode("body");
          })(),
        },
        calls,
      ),
    });

    expect(result.ok).toBe(true);
    expect(lookups).toBe(1);
    expect(calls).toHaveLength(1);
    const call = calls[0] as Record<string, unknown>;
    expect(call.protocol).toBe("https:");
    expect(call.address).toBe("93.184.216.34");
    expect(call.hostname).toBe("example.com");
    expect(call.path).toBe("/data");
    expect(call.method).toBe("GET");
    expect(call.port).toBe(443);
    expect(call.servername).toBe("example.com");
    expect(call.headers).toEqual({
      host: "example.com",
      "accept-encoding": "identity",
    });
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call).not.toHaveProperty("authorization");
    expect(call).not.toHaveProperty("cookie");
    expect(call).not.toHaveProperty("proxy");
    expect(calls[0]).not.toHaveProperty("authorization");
    expect(calls[0]).not.toHaveProperty("cookie");
    expect(calls[0]).not.toHaveProperty("proxy");
    if (result.ok)
      expect(new TextDecoder().decode(result.value.body)).toBe("body");
  });

  it("does not re-resolve, race addresses, retry, or use a second address", async () => {
    const calls: unknown[] = [];
    let lookups = 0;
    const operation = networkOperation();
    const result = await fetchAuthorized(operation, {
      resolver: {
        async lookup() {
          lookups += 1;
          return [
            { address: "93.184.216.34", family: 4 },
            { address: "93.184.216.35", family: 4 },
          ];
        },
      },
      transport: {
        async request(options) {
          calls.push(options);
          throw new Error("connection failed");
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.internal" },
    });
    expect(lookups).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("rejects redirects, unsupported encodings, and oversized responses", async () => {
    for (const response of [
      {
        status: 302,
        headers: [["location", "http://private.test"]] as const,
        body: (async function* () {})(),
      },
      {
        status: 200,
        headers: [["content-encoding", "gzip"]] as const,
        body: (async function* () {})(),
      },
      {
        status: 200,
        headers: [],
        body: (async function* () {
          yield new Uint8Array(4_194_305);
        })(),
      },
    ]) {
      const result = await fetchAuthorized(networkOperation(), {
        resolver: {
          async lookup() {
            return [{ address: "93.184.216.34", family: 4 }];
          },
        },
        transport: fakeTransport(response, []),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["runtime.redirect-rejected", "runtime.size-limit"]).toContain(
          result.error.code,
        );
      }
    }
  });

  it("aborts a stalled response at the operation deadline", async () => {
    let aborted = false;
    const result = await fetchAuthorized(networkOperation(), {
      resolver: {
        async lookup() {
          return [{ address: "93.184.216.34", family: 4 }];
        },
      },
      transport: {
        async request({ signal }) {
          signal?.addEventListener("abort", () => {
            aborted = true;
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error("aborted");
        },
      },
      operationTimeoutMs: 1,
    });

    expect(result).toEqual({ ok: false, error: { code: "runtime.timeout" } });
    expect(aborted).toBe(true);
  });
});
