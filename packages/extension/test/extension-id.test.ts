import { describe, expect, it } from "vitest";
import {
  isNativeHostOriginForbiddenMessage,
  nativeHostOriginMismatchMessage,
  RELEASE_EXTENSION_ID,
  runtimeInstallCommand,
} from "../src/extension-id.js";

describe("runtimeInstallCommand", () => {
  it("omits --extension-id for the pinned release ID", () => {
    expect(runtimeInstallCommand(RELEASE_EXTENSION_ID)).toBe(
      "rogatio runtime install",
    );
  });

  it("passes --extension-id for a dev or forked ID", () => {
    const devId = "b".repeat(32);
    expect(runtimeInstallCommand(devId)).toBe(
      `rogatio runtime install --extension-id ${devId}`,
    );
  });
});

describe("nativeHostOriginMismatchMessage", () => {
  it("names allowed_origins and the one command that re-pins the host", () => {
    const devId = "c".repeat(32);
    const text = nativeHostOriginMismatchMessage(devId);
    expect(text).toContain(`This extension ID (${devId})`);
    expect(text).toContain("allowed_origins");
    expect(text).toContain("Chrome refused the connection");
    expect(text).toContain(
      `Run \`rogatio runtime install --extension-id ${devId}\``,
    );
  });

  it("uses the flagless install command for a release build", () => {
    expect(nativeHostOriginMismatchMessage(RELEASE_EXTENSION_ID)).toContain(
      "Run `rogatio runtime install`",
    );
    expect(nativeHostOriginMismatchMessage(RELEASE_EXTENSION_ID)).not.toContain(
      "--extension-id",
    );
  });
});

describe("isNativeHostOriginForbiddenMessage", () => {
  it("matches Chrome's native-messaging refusal", () => {
    expect(
      isNativeHostOriginForbiddenMessage(
        "Access to the specified native messaging host is forbidden.",
      ),
    ).toBe(true);
  });

  it("does not treat a missing host as an origin mismatch", () => {
    expect(
      isNativeHostOriginForbiddenMessage(
        "Specified native messaging host not found.",
      ),
    ).toBe(false);
    expect(
      isNativeHostOriginForbiddenMessage("extension.native-host-missing"),
    ).toBe(false);
  });
});
