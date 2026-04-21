import { describe, expect, it } from "vitest";
import { assertUrlAllowed, nistFips197PdfUrl } from "./bench-tools.js";

describe("bench-tools allowlist", () => {
  it("allows only matching origin and /nist.fips.197.pdf", () => {
    const o = "http://127.0.0.1:21104";
    expect(nistFips197PdfUrl(o)).toBe("http://127.0.0.1:21104/nist.fips.197.pdf");
    expect(() => assertUrlAllowed(o, "http://127.0.0.1:21104/nist.fips.197.pdf")).not.toThrow();
    expect(() => assertUrlAllowed(o, "http://evil.test/nist.fips.197.pdf")).toThrow();
    expect(() => assertUrlAllowed(o, "http://127.0.0.1:21104/other.pdf")).toThrow();
  });
});
