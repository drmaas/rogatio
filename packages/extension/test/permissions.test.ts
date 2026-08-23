import { describe, expect, it } from "vitest";
import { declaredPermissionOrigins } from "../src/permissions.js";

describe("F7 permission projection", () => {
  it("returns sorted normalized effective origins", () => {
    expect(
      declaredPermissionOrigins({
        operations: [
          { matcher: { origins: ["HTTPS://B.example:443/"] } },
          { matcher: { origins: ["https://a.example", "https://b.example"] } },
        ],
      }),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("rejects broad or malformed origins", () => {
    expect(() =>
      declaredPermissionOrigins({
        operations: [{ matcher: { origins: ["<all_urls>"] } }],
      }),
    ).toThrowError("extension.invalid-origin");
  });
});
