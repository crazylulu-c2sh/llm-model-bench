import { describe, expect, it } from "vitest";
import { formatTtftMs } from "./metrics-display";

describe("formatTtftMs", () => {
  it("shows one decimal under 100ms", () => {
    expect(formatTtftMs(0.4)).toBe("0.4");
    expect(formatTtftMs(12.6)).toBe("12.6");
    expect(formatTtftMs(99.9)).toBe("99.9");
  });

  it("rounds to integer at 100ms and above", () => {
    expect(formatTtftMs(100.4)).toBe("100");
    expect(formatTtftMs(234.6)).toBe("235");
  });

  it("returns dash for nullish", () => {
    expect(formatTtftMs(null)).toBe("—");
    expect(formatTtftMs(undefined)).toBe("—");
  });
});
