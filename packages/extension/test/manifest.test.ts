import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifestPath = resolve(import.meta.dirname, "../public/manifest.json");

describe("extension manifest", () => {
  it("includes match-logging permissions and preserves optional_host_permissions", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      permissions?: string[];
      optional_host_permissions?: string[];
    };
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        "storage",
        "declarativeNetRequest",
        "declarativeNetRequestFeedback",
        "scripting",
        "nativeMessaging",
        "proxy",
      ]),
    );
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.optional_host_permissions).toEqual([
      "http://*/*",
      "https://*/*",
    ]);
  });
});
