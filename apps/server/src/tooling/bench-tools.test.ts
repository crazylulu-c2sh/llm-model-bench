import { describe, expect, it } from "vitest";
import { assertUrlAllowed, bitcoinWhitepaperUrl } from "./bench-tools.js";

describe("bench-tools allowlist", () => {
  it("allows only matching origin and /bitcoin.pdf", () => {
    const o = "http://127.0.0.1:21104";
    expect(bitcoinWhitepaperUrl(o)).toBe("http://127.0.0.1:21104/bitcoin.pdf");
    expect(() => assertUrlAllowed(o, "http://127.0.0.1:21104/bitcoin.pdf")).not.toThrow();
    expect(() => assertUrlAllowed(o, "http://evil.test/bitcoin.pdf")).toThrow();
    expect(() => assertUrlAllowed(o, "http://127.0.0.1:21104/other.pdf")).toThrow();
  });
});
