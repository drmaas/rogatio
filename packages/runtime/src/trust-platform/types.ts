import type { TrustCapabilities, TrustPlatform } from "../trust.js";

export interface TrustPlatformAdapter {
  readonly platform: TrustPlatform;
  readonly defaultManifestDir: () => string;
  readonly defaultCaInstallPath: () => string;
  detect(): TrustCapabilities;
  caTrustInstaller(certPem: string): Promise<void>;
  caTrustRemover(): Promise<void>;
}
