import type { TrustPlatform } from "../trust.js";
import darwinAdapter from "./darwin.js";
import linuxAdapter from "./linux.js";
import type { TrustPlatformAdapter } from "./types.js";
import { unsupportedAdapter } from "./unsupported.js";
import win32Adapter from "./win32.js";

export function selectTrustPlatformAdapter(
  platform: TrustPlatform,
): TrustPlatformAdapter {
  switch (platform) {
    case "darwin":
      return darwinAdapter;
    case "linux":
      return linuxAdapter;
    case "win32":
      return win32Adapter;
    default:
      return unsupportedAdapter;
  }
}
