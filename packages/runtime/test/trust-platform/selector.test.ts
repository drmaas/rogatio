import { describe, expect, it } from "vitest";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";

describe("selectTrustPlatformAdapter", () => {
  it("returns darwin adapter for darwin platform", () => {
    const adapter = selectTrustPlatformAdapter("darwin");
    expect(adapter.platform).toBe("darwin");
  });

  it("returns linux adapter for linux platform", () => {
    const adapter = selectTrustPlatformAdapter("linux");
    expect(adapter.platform).toBe("linux");
  });

  it("returns win32 adapter for win32 platform", () => {
    const adapter = selectTrustPlatformAdapter("win32");
    expect(adapter.platform).toBe("win32");
  });

  it("returns unsupported adapter for unknown platform", () => {
    const adapter = selectTrustPlatformAdapter("freebsd");
    expect(adapter.platform).toBe("unsupported");
  });

  it("selects correctly for current process.platform", () => {
    const adapter = selectTrustPlatformAdapter(process.platform);
    if (process.platform === "darwin") expect(adapter.platform).toBe("darwin");
    else if (process.platform === "linux")
      expect(adapter.platform).toBe("linux");
    else if (process.platform === "win32")
      expect(adapter.platform).toBe("win32");
    else expect(adapter.platform).toBe("unsupported");
  });
});
