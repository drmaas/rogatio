import { describe, expect, it } from "vitest";
import { generatePacScript, pacRoutesFromSources } from "../src/pac.js";
import { isPacSafeSource } from "../src/pac-safety.js";
import { MAX_PAC_ROUTES } from "../src/types.js";

describe("generatePacScript", () => {
  it("is deterministic and sorts host routes", () => {
    const routes = [{ hostname: "b.example" }, { hostname: "a.example" }];
    const a = generatePacScript(routes, { host: "127.0.0.1", port: 8080 });
    const b = generatePacScript(routes, { host: "127.0.0.1", port: 8080 });
    expect(a).toBe(b);
    expect(a).toContain('"a.example"');
    expect(a).toContain('"b.example"');
    expect(a).toContain("PROXY 127.0.0.1:8080");
    expect(a).not.toMatch(/RegExp/);
    expect(a).not.toMatch(/new URL/);
  });

  it("proxies only the literal host route", () => {
    const script = generatePacScript([{ hostname: "127.0.0.1" }], {
      host: "127.0.0.1",
      port: 8080,
    });
    expect(script).toContain('if (host === "127.0.0.1")');
    expect(script).toContain("return 'DIRECT';");
  });

  it("steers scheme and host without a path regex or RegExp", () => {
    const script = generatePacScript(
      [{ steer: { scheme: "https", host: "example.com" } }],
      { host: "127.0.0.1", port: 8080 },
    );
    expect(script).toContain(
      'if (host === "example.com" && url.indexOf("https://example.com") === 0)',
    );
    expect(script).not.toContain("data.json");
    expect(script).not.toMatch(/RegExp/);
    expect(script).not.toMatch(/new URL/);
  });

  it("pins an explicit port so a longer port is not steered", () => {
    const script = generatePacScript(
      [{ steer: { scheme: "http", host: "127.0.0.1", port: 8080 } }],
      { host: "127.0.0.1", port: 9 },
    );
    expect(script).toContain('url.indexOf("http://127.0.0.1:8080/") === 0');
    expect(script).toContain('url === "http://127.0.0.1:8080"');
    expect(script).not.toContain("data.json");
  });

  it("proxies an exact URL with string equality and no RegExp", () => {
    const script = generatePacScript(
      [{ url: "https://example.com/data.json" }],
      { host: "127.0.0.1", port: 8080 },
    );
    expect(script).toContain('if (url === "https://example.com/data.json")');
    expect(script).not.toMatch(/RegExp/);
    expect(script).not.toMatch(/new URL/);
  });

  it("uses HTTPS proxy type when requested", () => {
    const script = generatePacScript(
      [{ hostname: "a.example" }],
      {
        host: "127.0.0.1",
        port: 8443,
      },
      { proxyType: "HTTPS" },
    );
    expect(script).toContain("HTTPS 127.0.0.1:8443");
  });

  it("throws when route count exceeds the maximum", () => {
    const routes = Array.from({ length: MAX_PAC_ROUTES + 1 }, (_, index) => ({
      hostname: `origin-${index}.example`,
    }));
    expect(() =>
      generatePacScript(routes, { host: "127.0.0.1", port: 8080 }),
    ).toThrow("runtime.pac-route-limit");
  });
});

describe("pacRoutesFromSources", () => {
  it("derives literal host routes only", () => {
    const routes = pacRoutesFromSources([
      { key: "host", operator: "regex", value: "^127\\.0\\.0\\.1$" },
      {
        key: "url",
        operator: "regex",
        value: "^http://127\\.0\\.0\\.1:8080/data\\.json$",
      },
    ]);
    expect(routes).toEqual([
      { hostname: "127.0.0.1" },
      { steer: { scheme: "http", host: "127.0.0.1", port: 8080 } },
    ]);
  });

  it("steers one literal host and omits an unsafe path and top-level alternation", () => {
    const routes = pacRoutesFromSources([
      {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/data\\.json/([^/]+)",
      },
      {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/.*$",
      },
      {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/x/((a+)+)",
      },
      {
        key: "url",
        operator: "regex",
        value: "^https://a\\.example\\.com/|^https://b\\.example\\.com/",
      },
    ]);
    expect(routes).toEqual([
      { steer: { scheme: "https", host: "example.com" } },
    ]);
  });

  it("refuses a quantified group that contains an unbounded quantifier", () => {
    expect(
      isPacSafeSource({
        key: "host",
        operator: "regex",
        value: "^(a+)+$",
      }),
    ).toBe(false);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/data\\.json/([^/]+)",
      }),
    ).toBe(true);
  });
});
