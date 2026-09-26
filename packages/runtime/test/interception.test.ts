import { describe, expect, it, vi } from "vitest";
import {
  createPlatformInterceptionProvider,
  createUnsupportedPlatformProvider,
  type PlatformInterceptionAdapter,
} from "../src/interception.js";

function adapter(overrides: Partial<PlatformInterceptionAdapter> = {}) {
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
    startTlsProxy: vi.fn(async () => ({ host: "127.0.0.1", port: 9999 })),
    stopTlsProxy: vi.fn(async () => undefined),
    ...overrides,
  } satisfies PlatformInterceptionAdapter;
}

const activation = {
  state: "running" as const,
  startedAt: 1,
  presetDigest: "sha256:example" as const,
  pacRoutes: ["example.com"],
  proxy: { host: "127.0.0.1", port: 8443 },
};

describe(" interception provider", () => {
  it("starts the proxy first, installs PAC for its endpoint, and removes routing on stop", async () => {
    const platform = adapter();
    const provider = createPlatformInterceptionProvider(platform);

    expect(provider.status()).toBe("stopped");
    expect(provider.detect()).toEqual({ supported: true, reasons: [] });
    const endpoint = await provider.start(activation, ["example.com"]);
    expect(endpoint).toEqual({ host: "127.0.0.1", port: 9999 });
    expect(provider.status()).toBe("running");
    expect(platform.startTlsProxy).toHaveBeenCalledWith(activation);
    expect(platform.installPac).toHaveBeenCalledOnce();
    const pacScript = vi.mocked(platform.installPac).mock
      .calls[0]?.[0] as string;
    expect(pacScript).toContain("127.0.0.1:9999");
    expect(pacScript).toContain('"example.com"');
    // Proxy must be listening before PAC routes traffic to it.
    const proxyOrder = vi.mocked(platform.startTlsProxy).mock
      .invocationCallOrder[0];
    const pacOrder = vi.mocked(platform.installPac).mock.invocationCallOrder[0];
    expect(proxyOrder).toBeDefined();
    expect(pacOrder).toBeDefined();
    expect(proxyOrder).toBeLessThan(pacOrder as number);

    await provider.stop();
    await provider.stop();
    expect(provider.status()).toBe("stopped");
    expect(platform.stopTlsProxy).toHaveBeenCalledOnce();
    expect(platform.removePac).toHaveBeenCalledOnce();
    // Stop routing before tearing down the listener.
    const stopProxyOrder = vi.mocked(platform.stopTlsProxy).mock
      .invocationCallOrder[0];
    const removePacOrder = vi.mocked(platform.removePac).mock
      .invocationCallOrder[0];
    expect(removePacOrder).toBeDefined();
    expect(stopProxyOrder).toBeDefined();
    expect(removePacOrder).toBeLessThan(stopProxyOrder as number);
  });

  it("fails closed when the proxy cannot start and never installs PAC", async () => {
    const platform = adapter({
      startTlsProxy: vi.fn(async () => {
        throw new Error("platform failure");
      }),
    });
    const provider = createPlatformInterceptionProvider(platform);

    await expect(
      provider.start(activation, ["https://example.com"]),
    ).rejects.toThrow("platform failure");
    expect(provider.status()).toBe("stopped");
    expect(platform.installPac).not.toHaveBeenCalled();
    expect(platform.removePac).not.toHaveBeenCalled();
  });

  it("rolls the proxy back when PAC installation fails", async () => {
    const platform = adapter({
      installPac: vi.fn(async () => {
        throw new Error("pac install failure");
      }),
    });
    const provider = createPlatformInterceptionProvider(platform);

    await expect(
      provider.start(activation, ["https://example.com"]),
    ).rejects.toThrow("pac install failure");
    expect(provider.status()).toBe("stopped");
    expect(platform.startTlsProxy).toHaveBeenCalledOnce();
    expect(platform.stopTlsProxy).toHaveBeenCalledOnce();
    expect(platform.removePac).not.toHaveBeenCalled();
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
    const provider = createPlatformInterceptionProvider(platform);

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
    const provider = createUnsupportedPlatformProvider();
    expect(provider.detect()).toEqual({
      supported: false,
      reasons: ["device-local-ca-untrusted", "no-platform-adapter"],
    });
  });
});
