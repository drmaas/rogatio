import { describe, expect, it } from "vitest";
import { canonicalPresetBytes, digestBytes } from "../src/canonical.js";
import { mintToken } from "../src/mock.js";
import type { RuntimePresetV1 } from "../src/types.js";
import { makeMatcher, makePresetInput } from "./helpers.js";

function withMock(body: string): RuntimePresetV1 {
  return makePresetInput({
    mocks: [{ ruleId: "rule-main", status: 200, body }],
  });
}

describe("canonical mock preset bytes", () => {
  it("keeps the digest stable and free of minted tokens", () => {
    const first = canonicalPresetBytes(withMock("hello"));
    const second = canonicalPresetBytes(withMock("hello"));
    const token = mintToken();
    const text = new TextDecoder().decode(first);

    expect(digestBytes(first)).toBe(digestBytes(second));
    expect(text).not.toContain(token);
    expect(text).toContain('"body":"hello"');
  });

  it("changes the digest when mock config changes", () => {
    const original = digestBytes(canonicalPresetBytes(withMock("hello")));
    const changed = digestBytes(canonicalPresetBytes(withMock("goodbye")));
    const matchers = [makeMatcher("rule-a"), makeMatcher("rule-b")];
    const reordered = digestBytes(
      canonicalPresetBytes(
        makePresetInput({
          matchers,
          mocks: [
            { ruleId: "rule-b", status: 200, body: "b" },
            { ruleId: "rule-a", status: 200, body: "a" },
          ],
        }),
      ),
    );
    const swapped = digestBytes(
      canonicalPresetBytes(
        makePresetInput({
          matchers,
          mocks: [
            { ruleId: "rule-a", status: 200, body: "a" },
            { ruleId: "rule-b", status: 200, body: "b" },
          ],
        }),
      ),
    );

    expect(changed).not.toBe(original);
    expect(reordered).toBe(swapped);
  });
});
