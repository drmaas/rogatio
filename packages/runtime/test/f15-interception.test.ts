import { describe, expect, it, vi } from "vitest";
import {
  createF15InterceptionProvider,
  createUnsupportedF15Provider,
  type F15InterceptionAdapter,
} from "../src/f15-interception.js";

function adapter(overrides: Partial<F15InterceptionAdapter> = {}) {
  return {
    platform: "test",
    detect: () => ({
      supported: true,
      reasons: [],
      trustedDeviceLocalCa: true,
      controllingProxy: false,
      controllingPac: false,
      controllingExtension: false,
      enterprisePolicy: false,
    }),
    provisionOrVerifyCa: vi.fn(async () => true),
    installPac: vi.fn(async () => undefined),
    removePac: vi.fn(async () => undefined),
    startTlsProxy: vi.fn(async () => undefined),
    stopTlsProxy: vi.fn(async () => undefined),
    ...overrides,
  } satisfies F15InterceptionAdapter;
}

const activation = {
  state: "running" as const,
  startedAt: 1,
  pacOrigins: ["https://example.com"],
  proxy: { host: "127.0.0.1", port: 8443 },
};

describe("F15 interception provider", () => {
  it("requires capability and explicit start, then removes PAC on stop", async () => {
    const platform = adapter();
    const provider = createF15InterceptionProvider(platform);

    expect(provider.status()).toBe("stopped");
    expect(provider.detect()).toEqual({ supported: true, reasons: [] });
    await provider.start(activation, ["https://example.com"]);
    expect(provider.status()).toBe("running");
    expect(platform.installPac).toHaveBeenCalledOnce();
    expect(platform.startTlsProxy).toHaveBeenCalledWith(activation);

    await provider.stop();
    await provider.stop();
    expect(provider.status()).toBe("stopped");
    expect(platform.stopTlsProxy).toHaveBeenCalledOnce();
    expect(platform.removePac).toHaveBeenCalledOnce();
  });

  it("fails closed and leaves routing installed state rolled back when TLS start fails", async () => {
    const platform = adapter({
      startTlsProxy: vi.fn(async () => {
        throw new Error("platform failure");
      }),
    });
    const provider = createF15InterceptionProvider(platform);

    await expect(
      provider.start(activation, ["https://example.com"]),
    ).rejects.toThrow("platform failure");
    expect(provider.status()).toBe("stopped");
    expect(platform.removePac).toHaveBeenCalledOnce();
  });

  it("reports unsupported capability without provisioning or routing", async () => {
    const platform = adapter({
      detect: () => ({
        supported: true,
        reasons: [],
        trustedDeviceLocalCa: false,
        controllingProxy: false,
        controllingPac: false,
        controllingExtension: false,
        enterprisePolicy: false,
      }),
    });
    const provider = createF15InterceptionProvider(platform);

    expect(provider.detect()).toEqual({
      supported: false,
      reasons: ["device-local-ca-untrusted"],
    });
    await expect(
      provider.start(activation, ["https://example.com"]),
    ).rejects.toThrow("runtime.platform-unsupported");
    expect(platform.provisionOrVerifyCa).not.toHaveBeenCalled();
    expect(platform.installPac).not.toHaveBeenCalled();
    expect(provider.status()).toBe("unsupported");
  });

  it("provides an unsupported default provider", () => {
    const provider = createUnsupportedF15Provider();
    expect(provider.detect()).toEqual({
      supported: false,
      reasons: ["device-local-ca-untrusted", "no-platform-adapter"],
    });
  });
});
