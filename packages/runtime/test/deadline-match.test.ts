import { describe, expect, it } from "vitest";
import {
  matchUrlCapturesWithinDeadline,
  sourceMatchesWithinDeadline,
} from "../src/deadline-match.js";
import {
  __failNextRegexWorkerBootForTests,
  __resetRegexWorkerForTests,
  runRegexExec,
  runRegexTest,
} from "../src/regex-replace.js";

describe("deadline-bound URL source matching", () => {
  it("matches ordinary literal and linear URL and host patterns", async () => {
    await expect(
      sourceMatchesWithinDeadline(
        {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/api$",
        },
        "https://example.com/api",
      ),
    ).resolves.toBe(true);
    await expect(
      sourceMatchesWithinDeadline(
        {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/api$",
        },
        "https://evil.com/?x=example.com",
      ),
    ).resolves.toBe(false);
    await expect(
      sourceMatchesWithinDeadline(
        { key: "host", operator: "regex", value: "^example\\.com$" },
        "https://Example.com:8443/a",
      ),
    ).resolves.toBe(true);
    await expect(
      sourceMatchesWithinDeadline(
        { key: "host", operator: "regex", value: "^example\\.com$" },
        "https://evil.com/?x=example.com",
      ),
    ).resolves.toBe(false);
    await expect(
      sourceMatchesWithinDeadline(
        {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/([^/]+)$",
        },
        "https://example.com/users",
      ),
    ).resolves.toBe(true);

    const captures = await matchUrlCapturesWithinDeadline(
      "^https://example\\.com/users/([^/]+)$",
      "https://example.com/users/alice",
    );
    expect(captures).toEqual(["alice"]);
    const optional = await matchUrlCapturesWithinDeadline(
      "^https://example\\.com/(a)?(b)$",
      "https://example.com/b",
    );
    expect(optional).toEqual([undefined, "b"]);
  });

  it("returns no match within the deadline for a failing nested quantifier", async () => {
    await sourceMatchesWithinDeadline(
      { key: "url", operator: "regex", value: "^https://example\\.com/$" },
      "https://example.com/",
    );

    const nestedStart = Date.now();
    const nestedMatched = await sourceMatchesWithinDeadline(
      { key: "url", operator: "regex", value: "^(a+)+$" },
      `${"a".repeat(30)}!`,
    );
    expect(nestedMatched).toBe(false);
    expect(Date.now() - nestedStart).toBeLessThan(2000);

    await sourceMatchesWithinDeadline(
      { key: "url", operator: "regex", value: "^https://example\\.com/$" },
      "https://example.com/",
    );
    const alternationStart = Date.now();
    const alternationMatched = await sourceMatchesWithinDeadline(
      {
        key: "url",
        operator: "regex",
        value: "^http://example\\.com/(a|aa)+$",
      },
      `http://example.com/${"a".repeat(60)}!`,
    );
    expect(alternationMatched).toBe(false);
    expect(Date.now() - alternationStart).toBeLessThan(2000);

    await expect(
      sourceMatchesWithinDeadline(
        {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/api$",
        },
        "https://example.com/api",
      ),
    ).resolves.toBe(true);
  });

  it("returns a non-match promptly when the worker fails to boot", async () => {
    const pattern = "^(a+)+$";
    const text = `${"a".repeat(30)}!`;

    __failNextRegexWorkerBootForTests();
    try {
      const start = Date.now();
      await expect(runRegexTest(text, pattern, 250)).resolves.toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      __resetRegexWorkerForTests();
    }

    __failNextRegexWorkerBootForTests();
    try {
      const start = Date.now();
      await expect(runRegexExec(text, pattern, 250)).resolves.toBeNull();
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      __resetRegexWorkerForTests();
    }

    await expect(runRegexTest("abc", "^ab", 250)).resolves.toBe(true);
  });
});
