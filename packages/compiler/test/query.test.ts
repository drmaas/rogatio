import { describe, expect, it } from "vitest";
import {
  applyQueryTransform,
  queryActionToDNR,
  type RogatioQueryAction,
} from "../src/index.js";

describe("@rogatio/compiler query transform", () => {
  const setAction: RogatioQueryAction = {
    type: "query",
    params: [{ name: "a", value: "1" }],
  };

  it("translates set params into DNR addOrReplaceParams with replaceOnly false", () => {
    expect(queryActionToDNR(setAction)).toEqual({
      addOrReplaceParams: [{ name: "a", value: "1", replaceOnly: false }],
    });
  });

  it("translates remove params into DNR removeParams and omits empty arrays", () => {
    expect(
      queryActionToDNR({
        type: "query",
        params: [{ name: "b", operation: "remove" }],
      }),
    ).toEqual({ removeParams: ["b"] });
  });

  it("emits both DNR fields for mixed set and remove params", () => {
    expect(
      queryActionToDNR({
        type: "query",
        params: [
          { name: "a", operation: "set", value: "1" },
          { name: "b", operation: "remove" },
        ],
      }),
    ).toEqual({
      addOrReplaceParams: [{ name: "a", value: "1", replaceOnly: false }],
      removeParams: ["b"],
    });
  });

  it("adds a missing parameter and preserves unrelated params", () => {
    expect(applyQueryTransform("https://ex.com/p?b=2#frag", setAction)).toBe(
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

  it("removes configured names without re-adding them", () => {
    expect(
      applyQueryTransform("https://ex.com/p?a=1&b=2&c=3", {
        type: "query",
        params: [{ name: "b", operation: "remove" }],
      }),
    ).toBe("https://ex.com/p?a=1&c=3");
  });

  it("applies mixed set and remove while preserving unrelated keys", () => {
    expect(
      applyQueryTransform("https://ex.com/p?a=old&b=drop&c=keep", {
        type: "query",
        params: [
          { name: "a", operation: "set", value: "new" },
          { name: "b", operation: "remove" },
        ],
      }),
    ).toBe("https://ex.com/p?a=new&c=keep");
  });

  it("preserves scheme, authority, path, and fragment", () => {
    const url = "https://user.example.com:8443/path/to?x=1#section";
    expect(applyQueryTransform(url, setAction)).toBe(
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
