import { join } from "node:path";
import {
  createRequestBodyTrustController,
  defaultTrustInstallRoot,
} from "./trust.js";
import { selectTrustPlatformAdapter } from "./trust-platform/index.js";

/**
 * The trust controller `rogatio runtime verify` uses: platform manifest
 * directory, install root, and the `runtime-host` wrapper path.
 */
export function createInstalledTrustController() {
  const platform = process.platform;
  const adapter = selectTrustPlatformAdapter(platform);
  const installRoot = defaultTrustInstallRoot(platform);
  return createRequestBodyTrustController({
    platform,
    installRoot,
    hostPath: join(installRoot, "runtime-host"),
    hostName: "com.rogatio.runtime",
    allowedOrigins: [],
    manifestDir: adapter.defaultManifestDir(),
    detectCapabilities: () => adapter.detect(),
    caTrustInstaller: (cert) => adapter.caTrustInstaller(cert),
    caTrustRemover: () => adapter.caTrustRemover(),
    caTrustAnchorRemover: (fingerprint, certPem) =>
      adapter.caTrustAnchorRemover(fingerprint, certPem),
  });
}
