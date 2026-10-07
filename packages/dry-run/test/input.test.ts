import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CASES,
  normalizeOptions,
  readCaseBatch,
  validateCase,
} from "../src/input.js";

describe("validateCase", () => {
  it("accepts a plain case with url only", () => {
    const result = validateCase({ url: "https://example.com/" }, 0);
    expect(result).toEqual({
      ok: true,
      value: { url: "https://example.com/" },
    });
  });

  it("accepts a null prototype", () => {
    const raw = Object.create(null) as Record<string, unknown>;
    raw.url = "https://example.com/";
    const result = validateCase(raw, 3);
    expect(result).toEqual({
      ok: true,
      value: { url: "https://example.com/" },
    });
  });

  it("does not invoke accessor url, method, or resourceType", () => {
    let urlInvoked = false;
    let methodInvoked = false;
    let resourceInvoked = false;
    const hostile = {
      get url() {
        urlInvoked = true;
        return "https://example.com/";
      },
      get method() {
        methodInvoked = true;
        return "GET";
      },
      get resourceType() {
        resourceInvoked = true;
        return "main_frame";
      },
    };
    const result = validateCase(hostile, 0);
    expect(urlInvoked).toBe(false);
    expect(methodInvoked).toBe(false);
    expect(resourceInvoked).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("dryrun.invalid-case");
      expect(result.error.index).toBe(0);
    }
  });

  it("rejects a non-enumerable url property", () => {
    const raw = {};
    Object.defineProperty(raw, "url", {
      value: "https://example.com/",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const result = validateCase(raw, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("dryrun.invalid-case");
      expect(result.error.index).toBe(1);
    }
  });

  it("rejects a non-plain prototype", () => {
    class Case {
      url = "https://example.com/";
    }
    const result = validateCase(new Case(), 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("dryrun.invalid-case");
    }
  });

  it("rejects symbol keys", () => {
    const sym = Symbol("x");
    const raw = { url: "https://example.com/", [sym]: true };
    const result = validateCase(raw, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("dryrun.invalid-case");
    }
  });

  it("rejects unknown keys", () => {
    const result = validateCase(
      { url: "https://example.com/", extra: true },
      0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("dryrun.invalid-case");
    }
  });

  it("rejects invalid method and resourceType enum values", () => {
    const badMethod = validateCase(
      { url: "https://example.com/", method: "FOO" },
      4,
    );
    expect(badMethod.ok).toBe(false);
    if (!badMethod.ok) {
      expect(badMethod.error.code).toBe("dryrun.invalid-case");
      expect(badMethod.error.index).toBe(4);
    }

    const badResource = validateCase(
      { url: "https://example.com/", resourceType: "not-a-type" },
      5,
    );
    expect(badResource.ok).toBe(false);
    if (!badResource.ok) {
      expect(badResource.error.code).toBe("dryrun.invalid-case");
    }
  });

  it("reports non-string and empty url as dryrun.invalid-url", () => {
    const nonString = validateCase({ url: 42 }, 2);
    expect(nonString).toEqual({
      ok: false,
      error: {
        code: "dryrun.invalid-url",
        message: "Test case URL is invalid",
        index: 2,
      },
    });
    const empty = validateCase({ url: "" }, 3);
    expect(empty).toEqual({
      ok: false,
      error: {
        code: "dryrun.invalid-url",
        message: "Test case URL is invalid",
        index: 3,
      },
    });
  });
});

describe("normalizeOptions", () => {
  it("defaults maxCases when options are omitted", () => {
    expect(normalizeOptions(undefined)).toEqual({
      ok: true,
      maxCases: DEFAULT_MAX_CASES,
    });
    expect(DEFAULT_MAX_CASES).toBe(256);
  });

  it("accepts a positive safe-integer maxCases and a function previewAction", () => {
    const previewAction = () => null;
    const result = normalizeOptions({ maxCases: 10, previewAction });
    expect(result).toEqual({ ok: true, maxCases: 10, previewAction });
  });

  it("rejects a non-function previewAction", () => {
    expect(normalizeOptions({ previewAction: "nope" }).ok).toBe(false);
  });

  it("rejects non-safe-integer or non-positive maxCases", () => {
    expect(normalizeOptions({ maxCases: Number.NaN }).ok).toBe(false);
    expect(normalizeOptions({ maxCases: 1.5 }).ok).toBe(false);
    expect(normalizeOptions({ maxCases: 0 }).ok).toBe(false);
    expect(normalizeOptions({ maxCases: -1 }).ok).toBe(false);
    expect(normalizeOptions({ maxCases: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(
      false,
    );
  });

  it("does not invoke option getters", () => {
    let invoked = false;
    const hostile = {
      get maxCases() {
        invoked = true;
        return 1;
      },
    };
    expect(normalizeOptions(hostile).ok).toBe(false);
    expect(invoked).toBe(false);
  });
});

describe("readCaseBatch", () => {
  it("rejects a non-array cases value", () => {
    const result = readCaseBatch({ url: "https://example.com/" }, 256);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "dryrun.invalid-case",
        message: "Test cases must be an array",
      },
    });
  });

  it("rejects a sparse array", () => {
    const cases = [];
    cases[1] = { url: "https://example.com/" };
    const result = readCaseBatch(cases, 256);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "dryrun.invalid-case",
        message: "Test case is invalid",
        index: 0,
      });
    }
  });

  it("rejects an array longer than maxCases", () => {
    const cases = [
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
      { url: "https://example.com/c" },
    ];
    const result = readCaseBatch(cases, 2);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "dryrun.batch-limit",
        message: "Test batch exceeds maxCases (2)",
      },
    });
  });

  it("collects per-case validation errors and valid entries in index order", () => {
    const result = readCaseBatch(
      [
        { url: "https://example.com/" },
        { resourceType: "main_frame" },
        { url: 42 },
      ],
      256,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.valid).toEqual([
      { value: { url: "https://example.com/" }, index: 0 },
    ]);
    expect(result.errors).toEqual([
      {
        code: "dryrun.invalid-case",
        message: "Test case is invalid",
        index: 1,
      },
      {
        code: "dryrun.invalid-url",
        message: "Test case URL is invalid",
        index: 2,
      },
    ]);
  });
});
