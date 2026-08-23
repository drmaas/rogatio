import { describe, expect, it } from "vitest";
import {
  applyQueryTransform,
  queryParamsToDNR,
  type RogatioQueryAction,
} from "../src/index.js";

describe("@rogatio/compiler query transform", () => {
  const action: RogatioQueryAction = {
    type: "query",
    params: [{ name: "a", value: "1" }],
  };

  it("translates params into DNR addOrReplaceParams with replaceOnly false", () => {
    expect(queryParamsToDNR(action)).toEqual([
      { name: "a", value: "1", replaceOnly: false },
    ]);
  });

  it("adds a missing parameter and preserves unrelated params", () => {
    expect(applyQueryTransform("https://ex.com/p?b=2#frag", action)).toBe(
      "https://ex.com/p?b=2&a=1#frag",
    );
  });

  it("replaces all existing values for a configured name", () => {
    expect(
      applyQueryTransform("https://ex.com/p?b=9#frag", {
        type: "query",
        params: [{ name: "b", value: "2" }],
      }),
    ).toBe("https://ex.com/p?b=2#frag");
  });

  it("preserves scheme, authority, path, and fragment", () => {
    const url = "https://user.example.com:8443/path/to?x=1#section";
    expect(applyQueryTransform(url, action)).toBe(
      "https://user.example.com:8443/path/to?x=1&a=1#section",
    );
  });

  it("keeps unrelated duplicates and replaces only the configured name", () => {
    const result = applyQueryTransform("https://ex.com/p?b=1&b=2&c=3", {
      type: "query",
      params: [{ name: "b", value: "9" }],
    });
    expect(result).toBe("https://ex.com/p?b=9&c=3");
  });
});
