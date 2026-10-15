import type { TrustCapabilities, TrustPlatform } from "../trust.js";

export interface TrustPlatformAdapter {
  readonly platform: TrustPlatform;
  readonly defaultManifestDir: () => string;
  /**
   * Directories that can receive a native-messaging manifest on this run.
   * When omitted, install uses `defaultManifestDir()` only.
   */
  readonly manifestDirs?: () => readonly string[];
  readonly defaultCaInstallPath: () => string;
  detect(): TrustCapabilities;
  caTrustInstaller(certPem: string): Promise<void>;
  caTrustRemover(): Promise<void>;
  caTrustAnchorRemover(fingerprintSha1: string, certPem: string): Promise<void>;
}
