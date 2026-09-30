import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeExtensionIdMismatch,
  extensionIdFromPublicKey,
  extensionOriginListed,
  RELEASE_EXTENSION_ID,
} from "../src/extension-id.js";

describe("extensionIdFromPublicKey", () => {
  it("maps the empty SHA-256 prefix onto Chrome's a–p alphabet", () => {
    expect(extensionIdFromPublicKey("")).toBe(
      "odlameecjipmbmbejkplpemijjgpljce",
    );
  });

  it("derives the release ID from the extension manifest public key", () => {
    const manifestPath = resolve(
      import.meta.dirname,
      "../../extension/public/manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      key?: string;
    };
    expect(manifest.key).toEqual(expect.any(String));
    expect(extensionIdFromPublicKey(manifest.key ?? "")).toBe(
      RELEASE_EXTENSION_ID,
    );
  });
});

describe("extensionOriginListed", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";

  it("accepts the installer origin with or without a trailing slash", () => {
    expect(extensionOriginListed(id, [`chrome-extension://${id}/`])).toBe(true);
    expect(extensionOriginListed(id, [`chrome-extension://${id}`])).toBe(true);
  });

  it("rejects a different extension and a non-origin string", () => {
    expect(
      extensionOriginListed(id, [
        "chrome-extension://bcdefghijklmnopabcdefghijklmnopa/",
      ]),
    ).toBe(false);
    expect(extensionOriginListed(id, [`chrome-extension://${id}/extra`])).toBe(
      false,
    );
    expect(
      extensionOriginListed("not-an-id", [`chrome-extension://${id}/`]),
    ).toBe(false);
  });
});

describe("describeExtensionIdMismatch", () => {
  it("tells a release install to re-pin without --extension-id", () => {
    const text = describeExtensionIdMismatch(RELEASE_EXTENSION_ID, [
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
    ]);
    expect(text).toContain(
      `Extension ID ${RELEASE_EXTENSION_ID} is not in the host manifest allowed_origins.`,
    );
    expect(text).toContain(
      "The host manifest allows: chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.",
    );
    expect(text).toContain(
      "Access to the specified native messaging host is forbidden",
    );
    expect(text).toContain("Run: rogatio runtime install");
    expect(text).not.toContain("--extension-id");
  });

  it("includes --extension-id for a dev or forked build", () => {
    const devId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const text = describeExtensionIdMismatch(devId, [
      `chrome-extension://${RELEASE_EXTENSION_ID}/`,
    ]);
    expect(text).toContain(
      `Run: rogatio runtime install --extension-id ${devId}`,
    );
  });
});
