import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import type { TrustPlatformAdapter } from "./types.js";

export const unsupportedAdapter: TrustPlatformAdapter = {
  platform: "unsupported",
  defaultManifestDir: () => "",
  defaultCaInstallPath: () => "",
  detect(): TrustCapabilities {
    return {
      manifest: false,
      caTrust: false,
      reasons: ["no-capability-provider"],
    };
  },
  async caTrustInstaller(): Promise<void> {
    throw new TrustError("trust.internal", "unsupported-platform", [
      "no-capability-provider",
    ]);
  },
  async caTrustRemover(): Promise<void> {
    throw new TrustError("trust.internal", "unsupported-platform", [
      "no-capability-provider",
    ]);
  },
};
