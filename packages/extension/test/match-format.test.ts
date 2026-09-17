import { describe, expect, it } from "vitest";
import { formatMatchRecord } from "../src/match-format.js";
import type { MatchIndexEntry } from "../src/match-index.js";
import {
  isDenyListedHeaderName,
  LOG_STRING_MAX,
  redactUrl,
  sanitizeHeaderLogValue,
  sanitizeQueryTransformValue,
  truncateLogString,
} from "../src/match-log-redaction.js";

const PREFIX = "\x1B[1;34m[rogatio]\x1B[m";
const DIM = "\x1B[2m";
const RESET = "\x1B[m";

const QUERY_DENY_KEYS = [
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "api_key",
  "apikey",
  "key",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "auth",
  "session",
  "sid",
  "sig",
  "signature",
  "jwt",
  "assertion",
  "otp",
  "state",
  "nonce",
  "email",
] as const;

function urlWithQuery(key: string, value: string): string {
  return `https://example.com/path?${key}=${value}&plain=visible`;
}

describe("truncateLogString", () => {
  it("keeps 199 characters without ellipsis", () => {
    const value = "a".repeat(199);
    expect(truncateLogString(value)).toBe(value);
    expect(truncateLogString(value).endsWith("...")).toBe(false);
  });

  it("keeps exactly 200 characters without ellipsis", () => {
    const value = "b".repeat(200);
    expect(truncateLogString(value)).toBe(value);
    expect(truncateLogString(value).endsWith("...")).toBe(false);
  });

  it("truncates 201+ to at most 200 with trailing ellipsis when sensitive is false", () => {
    const value = "c".repeat(250);
    const truncated = truncateLogString(value);
    expect(truncated.length).toBeLessThanOrEqual(LOG_STRING_MAX);
    expect(truncated.endsWith("...")).toBe(true);
  });
});

describe("redactUrl", () => {
  it("removes userinfo and fragment for parseable URLs with flag on and off", () => {
    const url = "https://user:secret@example.com/path?token=abc#fragment";
    const off = redactUrl(url, { redactSensitive: false });
    const on = redactUrl(url, { redactSensitive: true });
    expect(off).not.toContain("user:secret@");
    expect(off).not.toContain("#fragment");
    expect(on).not.toContain("user:secret@");
    expect(on).not.toContain("#fragment");
  });

  it("preserves query parameter order when redacting", () => {
    const url = "https://example.com/?zebra=1&token=secret&alpha=2&plain=ok";
    const redacted = redactUrl(url, { redactSensitive: true });
    expect(redacted.indexOf("zebra=1")).toBeLessThan(
      redacted.indexOf("token=[redacted]"),
    );
    expect(redacted.indexOf("token=[redacted]")).toBeLessThan(
      redacted.indexOf("alpha=2"),
    );
    expect(redacted).toContain("plain=ok");
  });

  it.each(QUERY_DENY_KEYS)(
    "redacts deny-listed query key %s when sensitive is true",
    (key) => {
      const url = urlWithQuery(key, "super-secret-value");
      const redacted = redactUrl(url, { redactSensitive: true });
      expect(redacted).toContain("[redacted]");
      expect(redacted).not.toContain("super-secret-value");
      expect(redacted).toContain("plain=visible");
    },
  );

  it("matches deny-listed keys case-insensitively", () => {
    const redacted = redactUrl("https://example.com/?ACCESS_TOKEN=secret", {
      redactSensitive: true,
    });
    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("secret");
  });

  it("redacts substring query keys such as tokenizer, api_key, encode", () => {
    expect(
      redactUrl("https://example.com/?tokenizer=abc", {
        redactSensitive: true,
      }),
    ).toContain("tokenizer=[redacted]");
    expect(
      redactUrl("https://example.com/?api_key=abc", {
        redactSensitive: true,
      }),
    ).toContain("api_key=[redacted]");
    expect(
      redactUrl("https://example.com/?encode=abc", { redactSensitive: true }),
    ).toContain("encode=[redacted]");
  });

  it("keeps deny-listed query values as truncated plaintext when sensitive is false", () => {
    const url = urlWithQuery("access_token", "plain-secret");
    const redacted = redactUrl(url, { redactSensitive: false });
    expect(redacted).toContain("plain-secret");
    expect(redacted).not.toContain("[redacted]");
  });

  it("handles malformed, relative, and data URLs without throwing", () => {
    expect(() =>
      redactUrl("not-a-url", { redactSensitive: true }),
    ).not.toThrow();
    expect(() =>
      redactUrl("/relative/path?token=x", { redactSensitive: true }),
    ).not.toThrow();
    expect(() =>
      redactUrl("data:text/plain,hello", { redactSensitive: true }),
    ).not.toThrow();
  });

  it("treats redirect backref destinations as opaque bounded strings", () => {
    const destination = "\\1?token=secret";
    const redacted = redactUrl(destination, { redactSensitive: true });
    expect(redacted.length).toBeLessThanOrEqual(LOG_STRING_MAX);
    expect(redacted).toContain("\\1");
    expect(redacted).toContain("token=[redacted]");
  });

  it("preserves percent-format sequences as data", () => {
    const url = "https://example.com/?msg=%25s%25c";
    const redacted = redactUrl(url, { redactSensitive: false });
    expect(redacted).toContain("%25s%25c");
  });
});

describe("query and header value redaction helpers", () => {
  it("redacts query-transform values only when sensitive is true", () => {
    expect(sanitizeQueryTransformValue("access_token", "secret", true)).toBe(
      "[redacted]",
    );
    expect(sanitizeQueryTransformValue("access_token", "secret", false)).toBe(
      "secret",
    );
  });

  it("redacts header values by deny-listed name when sensitive is true", () => {
    expect(isDenyListedHeaderName("cookie")).toBe(true);
    expect(isDenyListedHeaderName("x-api-key")).toBe(true);
    expect(sanitizeHeaderLogValue("cookie", "session=abc", true)).toBe(
      "[redacted]",
    );
    expect(sanitizeHeaderLogValue("x-api-key", "abc123", true)).toBe(
      "[redacted]",
    );
    expect(sanitizeHeaderLogValue("x-custom", "visible", true)).toBe("visible");
  });

  it("truncates deny-listed header values without replacing them when sensitive is false", () => {
    const longSecret = "s".repeat(250);
    const value = sanitizeHeaderLogValue("cookie", longSecret, false);
    expect(value).not.toBe("[redacted]");
    expect(value.length).toBeLessThanOrEqual(LOG_STRING_MAX);
    expect(value.endsWith("...")).toBe(true);
  });

  it("redacts initiator and destination query values when sensitive is true", () => {
    const initiator = redactUrl("https://init.example/?token=secret", {
      redactSensitive: true,
    });
    const destination = redactUrl("https://dest.example/?api_key=secret", {
      redactSensitive: true,
    });
    expect(initiator).toContain("[redacted]");
    expect(destination).toContain("[redacted]");
  });
});

describe("formatMatchRecord", () => {
  const redirectEntry: MatchIndexEntry = {
    ruleId: "redirect-rule",
    kind: "redirect",
    redactSensitiveInLogs: false,
    intent: { destination: "https://dest.example/new-path" },
  };

  const queryEntry: MatchIndexEntry = {
    ruleId: "query-rule",
    kind: "query",
    redactSensitiveInLogs: false,
    intent: {
      params: [
        { name: "a", operation: "set", value: "1" },
        { name: "b", operation: "remove" },
      ],
    },
  };

  const headerEntry: MatchIndexEntry = {
    ruleId: "header-rule",
    kind: "header",
    redactSensitiveInLogs: true,
    intent: {
      direction: "request",
      operation: "set",
      name: "x-api-key",
      value: "super-secret",
    },
  };

  it("formats redirect, query, and header snapshots with ANSI and field order", () => {
    const redirectLine = formatMatchRecord(
      {
        url: "https://example.com/page",
        method: "GET",
        resourceType: "script",
        initiator: "https://example.com/",
      },
      redirectEntry,
    );
    expect(redirectLine).toMatchSnapshot("redirect");

    const queryLine = formatMatchRecord(
      {
        url: "https://example.com/page",
        method: "POST",
        resourceType: "xhr",
        initiator: "https://example.com/",
      },
      queryEntry,
    );
    expect(queryLine).toMatchSnapshot("query");

    const headerLine = formatMatchRecord(
      {
        url: "https://example.com/page",
        method: "GET",
        resourceType: "script",
      },
      headerEntry,
    );
    expect(headerLine).toMatchSnapshot("header");
  });

  it("uses lowercase [rogatio], ANSI SGR, and no %c or hex colors", () => {
    const line = formatMatchRecord(
      { url: "https://example.com/" },
      redirectEntry,
    );
    expect(line.startsWith(PREFIX)).toBe(true);
    expect(line).toContain(DIM);
    expect(line.endsWith(RESET)).toBe(true);
    expect(line).toContain("[rogatio]");
    expect(line).not.toContain("[Rogatio]");
    expect(line).not.toContain("%c");
    expect(line).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("mentions matched and never succeeded", () => {
    const line = formatMatchRecord(
      { url: "https://example.com/" },
      redirectEntry,
    );
    expect(line).toContain("matched");
    expect(line.toLowerCase()).not.toContain("succeeded");
  });

  it("omits method, resource type, and initiator placeholders when absent", () => {
    const line = formatMatchRecord(
      { url: "https://example.com/" },
      redirectEntry,
    );
    expect(line).not.toContain("initiator=");
    expect(line).not.toMatch(/matched [A-Z]+ /);
  });

  it("re-applies deny-list and bounds on tampered index values at format time", () => {
    const tampered: MatchIndexEntry = {
      ruleId: "tampered",
      kind: "query",
      redactSensitiveInLogs: true,
      intent: {
        params: [
          {
            name: "access_token",
            operation: "set",
            value: "x".repeat(300),
          },
        ],
      },
    };
    const line = formatMatchRecord(
      { url: "https://example.com/?access_token=plain" },
      tampered,
    );
    expect(line).toContain("[redacted]");
    expect(line).not.toContain("x".repeat(300));
    expect(line).not.toContain("plain");
    for (const segment of line.split(" ")) {
      if (segment.length > LOG_STRING_MAX) {
        expect(segment.endsWith("...")).toBe(true);
      }
    }
  });

  it("re-applies deny-list and bounds on tampered destination and header intents", () => {
    const destinationLine = formatMatchRecord(
      { url: "https://example.com/" },
      {
        ruleId: "tampered-redirect",
        kind: "redirect",
        redactSensitiveInLogs: true,
        intent: {
          destination: `https://user:pw@dest.example/?token=${"d".repeat(300)}#frag`,
        },
      },
    );
    expect(destinationLine).toContain("token=[redacted]");
    expect(destinationLine).not.toContain("user:pw@");
    expect(destinationLine).not.toContain("#frag");
    expect(destinationLine).not.toContain("d".repeat(300));

    const headerLine = formatMatchRecord(
      { url: "https://example.com/" },
      {
        ruleId: "tampered-header",
        kind: "header",
        redactSensitiveInLogs: true,
        intent: {
          direction: "request",
          operation: "set",
          name: "cookie",
          value: "h".repeat(300),
        },
      },
    );
    expect(headerLine).toContain("cookie=[redacted]");
    expect(headerLine).not.toContain("h".repeat(300));
  });

  it("bounds an oversize ruleId from a tampered index entry", () => {
    const line = formatMatchRecord(
      { url: "https://example.com/" },
      { ...redirectEntry, ruleId: "r".repeat(300) },
    );
    expect(line).not.toContain("r".repeat(300));
    // Bound is per logged string; strip SGR so escapes do not inflate a segment.
    const plain = line
      .replaceAll(PREFIX, "[rogatio]")
      .replaceAll(DIM, "")
      .replaceAll(RESET, "");
    for (const segment of plain.split(" ")) {
      expect(segment.length).toBeLessThanOrEqual(LOG_STRING_MAX);
    }
  });

  it("keeps literal %s and %c from the request URL as data", () => {
    const line = formatMatchRecord(
      { url: "https://example.com/?msg=%s%c", method: "GET" },
      redirectEntry,
    );
    expect(line).toContain("%s");
    expect(line).toContain("%c");
  });

  it("omits intent segments for non-string or missing intent fields", () => {
    const brokenRedirect = {
      ruleId: "broken-redirect",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: 123 },
    } as unknown as MatchIndexEntry;
    const redirectLine = formatMatchRecord(
      { url: "https://example.com/" },
      brokenRedirect,
    );
    expect(redirectLine).toContain("broken-redirect redirect");
    expect(redirectLine).not.toContain("→");

    const brokenHeader = {
      ruleId: "broken-header",
      kind: "header",
      redactSensitiveInLogs: false,
      intent: undefined,
    } as unknown as MatchIndexEntry;
    expect(() =>
      formatMatchRecord({ url: "https://example.com/" }, brokenHeader),
    ).not.toThrow();

    const throwingIntent = {
      ruleId: "throwing",
      kind: "query",
      redactSensitiveInLogs: false,
      intent: {
        get params(): never {
          throw new Error("boom");
        },
      },
    } as unknown as MatchIndexEntry;
    expect(() =>
      formatMatchRecord({ url: "https://example.com/" }, throwingIntent),
    ).not.toThrow();
  });

  it("ignores extra body fields and never emits body sentinels", () => {
    const entry = {
      ...redirectEntry,
      body: "BODY-SENTINEL-12345",
      requestBody: "REQUEST-BODY-SENTINEL-67890",
    } as MatchIndexEntry & { body: string; requestBody: string };
    const line = formatMatchRecord({ url: "https://example.com/" }, entry);
    expect(line).not.toContain("BODY-SENTINEL-12345");
    expect(line).not.toContain("REQUEST-BODY-SENTINEL-67890");
    expect(line.toLowerCase()).not.toContain("body");
  });

  it("handles adversarial non-string event fields without throwing", () => {
    expect(() =>
      formatMatchRecord(
        {
          url: undefined,
          method: 123 as unknown as string,
          initiator: { evil: true } as unknown as string,
          resourceType: null as unknown as string,
        },
        redirectEntry,
      ),
    ).not.toThrow();
  });

  it("handles duplicated query keys and accessor-shaped entries without throwing", () => {
    const accessorEntry = {
      ruleId: "accessor",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: Object.create({
        destination: "https://evil.example/",
      }),
    } as MatchIndexEntry;
    expect(() =>
      formatMatchRecord(
        {
          url: "https://example.com/?token=a&token=b",
        },
        accessorEntry,
      ),
    ).not.toThrow();
  });

  it("keeps deny-listed query plaintext in the line when redactSensitiveInLogs is false", () => {
    const entry: MatchIndexEntry = {
      ruleId: "plain-query",
      kind: "query",
      redactSensitiveInLogs: false,
      intent: {
        params: [{ name: "token", operation: "set", value: "visible-secret" }],
      },
    };
    const line = formatMatchRecord(
      { url: "https://example.com/?token=live-secret" },
      entry,
    );
    expect(line).toContain("visible-secret");
    expect(line).toContain("live-secret");
    expect(line).not.toContain("[redacted]");
  });
});
