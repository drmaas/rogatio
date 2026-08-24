import { describe, expect, it } from "vitest";
import { generatePacScript } from "../src/f14-pac.js";
import { F14_MAX_PAC_ORIGINS } from "../src/f14-types.js";

describe("generatePacScript", () => {
  it("is deterministic and sorts origins", () => {
    const input = ["https://b.example", "https://a.example"];
    const a = generatePacScript(input, { host: "127.0.0.1", port: 8080 });
    const b = generatePacScript(input, { host: "127.0.0.1", port: 8080 });
    expect(a).toBe(b);
    expect(a).toContain(
      JSON.stringify(["https://a.example", "https://b.example"]),
    );
    expect(a).toContain("PROXY 127.0.0.1:8080");
  });

  it("drops invalid origins", () => {
    const script = generatePacScript(["not a url", "https://a.example"], {
      host: "127.0.0.1",
      port: 8080,
    });
    expect(script).toContain(JSON.stringify(["https://a.example"]));
    expect(script).not.toContain("not a url");
  });

  it("uses HTTPS proxy type when requested", () => {
    const script = generatePacScript(
      ["https://a.example"],
      { host: "127.0.0.1", port: 8443 },
      { proxyType: "HTTPS" },
    );
    expect(script).toContain("HTTPS 127.0.0.1:8443");
  });

  it("throws when origin count exceeds the maximum", () => {
    const origins = Array.from(
      { length: F14_MAX_PAC_ORIGINS + 1 },
      (_, index) => `https://origin-${index}.example`,
    );
    expect(() =>
      generatePacScript(origins, { host: "127.0.0.1", port: 8080 }),
    ).toThrow();
  });

  it("returns DIRECT for non-matching origins", () => {
    const script = generatePacScript(["https://a.example"], {
      host: "127.0.0.1",
      port: 8080,
    });
    expect(script).toContain("return 'DIRECT';");
  });
});
