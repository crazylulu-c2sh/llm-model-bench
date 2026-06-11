import { describe, expect, it } from "vitest";
import {
  approxOutputTokens,
  effectiveOutputTokens,
  outputTokensFromRun,
  tokensPerSecondFromRun,
  tpsSourceFromUsage,
} from "./tps";

describe("effectiveOutputTokens", () => {
  it("prefers provider usage tokens when present (>0)", () => {
    // 가시 텍스트는 짧지만(approx 1) usage가 크면 usage를 신뢰 — messages 라우트 숨은 추론 토큰 반영
    expect(effectiveOutputTokens("ok", 100)).toBe(100);
  });
  it("falls back to chars/4 when usage is null/0", () => {
    expect(effectiveOutputTokens("a".repeat(40), null)).toBe(10);
    expect(effectiveOutputTokens("a".repeat(40), 0)).toBe(10);
    expect(effectiveOutputTokens("a".repeat(40), undefined)).toBe(10);
  });
  it("matches approxOutputTokens on the fallback path", () => {
    const text = "hello world 한글";
    expect(effectiveOutputTokens(text, null)).toBe(approxOutputTokens(text));
  });
});

describe("tpsSourceFromUsage", () => {
  it("labels usage vs approx by presence of a positive count", () => {
    expect(tpsSourceFromUsage(42)).toBe("usage");
    expect(tpsSourceFromUsage(0)).toBe("approx");
    expect(tpsSourceFromUsage(null)).toBe("approx");
    expect(tpsSourceFromUsage(undefined)).toBe("approx");
  });
});

describe("outputTokensFromRun", () => {
  it("returns usage tokens when present", () => {
    expect(outputTokensFromRun("ok", 42)).toBe(42);
  });
  it("falls back to approx and returns null for empty output", () => {
    expect(outputTokensFromRun("a".repeat(40), null)).toBe(10);
    expect(outputTokensFromRun("", null)).toBeNull();
  });
});

describe("tokensPerSecondFromRun", () => {
  it("uses usage tokens over total seconds when provided", () => {
    // 100 토큰 / 2초 = 50 tok/s (가시 텍스트 길이와 무관)
    expect(tokensPerSecondFromRun(2000, "ok", 100)).toBe(50);
  });
  it("falls back to chars/4 when usage absent", () => {
    // 40자 → 10 토큰 / 2초 = 5 tok/s
    expect(tokensPerSecondFromRun(2000, "a".repeat(40))).toBe(5);
    expect(tokensPerSecondFromRun(2000, "a".repeat(40), null)).toBe(5);
  });
  it("returns 0 for non-positive time or empty output", () => {
    expect(tokensPerSecondFromRun(0, "abcd", 10)).toBe(0);
    expect(tokensPerSecondFromRun(1000, "", null)).toBe(0);
  });
});
