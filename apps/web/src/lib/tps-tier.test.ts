import { describe, expect, it } from "vitest";
import { formatStressTpsTooltip, getTpsTier, tpsTierColor } from "./tps-tier";

describe("getTpsTier", () => {
  it("returns null for null / NaN / undefined", () => {
    expect(getTpsTier(null, false)).toBeNull();
    expect(getTpsTier(undefined, false)).toBeNull();
    expect(getTpsTier(Number.NaN, false)).toBeNull();
  });
  it("returns null when unreliable regardless of value", () => {
    expect(getTpsTier(100, true)).toBeNull();
    expect(getTpsTier(0, true)).toBeNull();
  });
  it("boundary 30 → fast, 29.99 → good", () => {
    expect(getTpsTier(30, false)).toBe("fast");
    expect(getTpsTier(29.99, false)).toBe("good");
  });
  it("boundary 15 → good, 14.99 → okay", () => {
    expect(getTpsTier(15, false)).toBe("good");
    expect(getTpsTier(14.99, false)).toBe("okay");
  });
  it("boundary 5 → okay, 4.99 → slow", () => {
    expect(getTpsTier(5, false)).toBe("okay");
    expect(getTpsTier(4.99, false)).toBe("slow");
  });
  it("returns slow for 0 and negative", () => {
    expect(getTpsTier(0, false)).toBe("slow");
    expect(getTpsTier(-1, false)).toBe("slow");
  });
});

describe("tpsTierColor", () => {
  it("returns muted for null tier", () => {
    expect(tpsTierColor(null)).toBe("var(--muted)");
  });
  it("returns tier CSS var per tier", () => {
    expect(tpsTierColor("fast")).toBe("var(--tier-fast)");
    expect(tpsTierColor("slow")).toBe("var(--tier-slow)");
  });
});

describe("formatStressTpsTooltip", () => {
  it("returns '— (신뢰도 낮음)' when unreliable regardless of value", () => {
    expect(formatStressTpsTooltip(null, { unreliable: true, tier: null })).toBe("— (신뢰도 낮음)");
    expect(formatStressTpsTooltip(28.1, { unreliable: true, tier: "good" })).toBe("— (신뢰도 낮음)");
  });
  it("returns '—' for null / NaN when reliable", () => {
    expect(formatStressTpsTooltip(null, { unreliable: false, tier: null })).toBe("—");
    expect(formatStressTpsTooltip(Number.NaN, { unreliable: false, tier: null })).toBe("—");
  });
  it("returns plain value when tier is null (aggregate)", () => {
    expect(formatStressTpsTooltip(28.1, { unreliable: false, tier: null })).toBe("28.1");
  });
  it("appends tier label when tier provided (per-user)", () => {
    expect(formatStressTpsTooltip(28.1, { unreliable: false, tier: "good" })).toBe("28.1 (쓸만)");
    expect(formatStressTpsTooltip(3, { unreliable: false, tier: "slow" })).toBe("3 (너무 느림)");
  });
});
