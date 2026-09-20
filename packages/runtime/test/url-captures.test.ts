import { describe, expect, it } from "vitest";
import {
  rewriteHeadersWithUrlCaptures,
  rewriteQueryWithUrlCaptures,
} from "../src/url-captures.js";

describe("runtime URL action captures", () => {
  const context = {
    url: "https://example.com/users/alice?debug=true&keep=1",
    urlRegex: "^https://example\\.com/users/([^?]+)",
  };

  it("rewrites query set/remove values from URL captures", () => {
    const result = rewriteQueryWithUrlCaptures(context, {
      type: "query",
      params: [
        { name: "user", value: "$1" },
        { name: "debug", operation: "remove" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: "https://example.com/users/alice?keep=1&user=alice",
    });
  });

  it("rewrites and appends header values from URL captures", () => {
    const result = rewriteHeadersWithUrlCaptures(
      { ...context, url: "https://example.com/users/alice" },
      { "X-User": "existing" },
      [
        { operation: "set", name: "x-user", value: "$1" },
        { operation: "append", name: "X-Trace", value: "user=$1" },
      ],
    );
    expect(result).toEqual({
      ok: true,
      value: { "X-User": "alice", "X-Trace": "user=alice" },
    });
  });
});
