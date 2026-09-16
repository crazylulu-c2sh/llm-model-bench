import { describe, expect, it } from "vitest";
import {
  MIN_DECODE_WINDOW_MS,
  approxOutputTokens,
  decodeTokensPerSecondFromRun,
  effectiveOutputTokens,
  outputTokensFromRun,
  prefillTokensPerSecondFromRun,
  roundTpsDisplay,
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

describe("decodeTokensPerSecondFromRun", () => {
  it("uses (output_tokens - 1) / (total_ms - ttft_ms)", () => {
    // 31 tok, 100ms TTFT, 1100ms total → 30 / 1s = 30
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1100, ttftMs: 100, outputText: "ok", usageTokens: 31 }),
    ).toBe(30);
  });
  it("falls back to chars/4 approx when usage is absent", () => {
    // 40자 → 10 tok, n-1=9, decode 2s → 4.5
    expect(
      decodeTokensPerSecondFromRun({
        totalMs: 2500,
        ttftMs: 500,
        outputText: "a".repeat(40),
        usageTokens: null,
      }),
    ).toBe(4.5);
  });
  it("returns null when ttft is missing", () => {
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1000, ttftMs: null, usageTokens: 10 }),
    ).toBeNull();
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1000, ttftMs: undefined, usageTokens: 10 }),
    ).toBeNull();
  });
  it("returns null when decode_ms <= 0", () => {
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 100, ttftMs: 100, usageTokens: 10 }),
    ).toBeNull();
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 90, ttftMs: 100, usageTokens: 10 }),
    ).toBeNull();
    expect(decodeTokensPerSecondFromRun({ totalMs: 0, ttftMs: 0, usageTokens: 10 })).toBeNull();
  });
  it("returns null when output tokens <= 1", () => {
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 2000, ttftMs: 100, usageTokens: 1 }),
    ).toBeNull();
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 2000, ttftMs: 100, outputText: "", usageTokens: null }),
    ).toBeNull();
  });
  it("prefers usage over approx for the numerator", () => {
    expect(
      decodeTokensPerSecondFromRun({
        totalMs: 1100,
        ttftMs: 100,
        outputText: "ok",
        usageTokens: 31,
      }),
    ).toBe(30);
  });
});

describe("decodeTokensPerSecondFromRun — single burst", () => {
  // Apple FM tool_weather 형태: 호출 전체(24 tok)가 생성 끝에 한 청크로 와서 total−ttft ≈ 2.5ms.
  const burst = { totalMs: 902.5, ttftMs: 900, usageTokens: 24 };

  it("returns null when all output arrived in one read batch (outputDeltaBatches ≤ 1)", () => {
    expect(decodeTokensPerSecondFromRun({ ...burst, outputDeltaBatches: 1 })).toBeNull();
    // 창이 10ms를 넘어도 배치가 1개면 여전히 단일 버스트다.
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1_200, ttftMs: 900, usageTokens: 24, outputDeltaBatches: 1 }),
    ).toBeNull();
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1_200, ttftMs: 900, usageTokens: 24, outputDeltaBatches: 0 }),
    ).toBeNull();
  });

  it("keeps a normal streamed run when batches > 1", () => {
    expect(
      decodeTokensPerSecondFromRun({ totalMs: 1100, ttftMs: 100, usageTokens: 31, outputDeltaBatches: 30 }),
    ).toBe(30);
  });

  it("drops a decode window under MIN_DECODE_WINDOW_MS for legacy runs without batches", () => {
    expect(MIN_DECODE_WINDOW_MS).toBe(10);
    // 구 런(필드 없음): 2.5ms 창 → 9,200 tok/s 대신 null
    expect(decodeTokensPerSecondFromRun(burst)).toBeNull();
    expect(decodeTokensPerSecondFromRun({ totalMs: 909.9, ttftMs: 900, usageTokens: 24 })).toBeNull();
    // 10ms 이상이면 기존 산식 그대로: 23 / 0.01s = 2300
    expect(decodeTokensPerSecondFromRun({ totalMs: 910, ttftMs: 900, usageTokens: 24 })).toBeCloseTo(2300, 6);
  });

  it("also drops a sub-10ms window when batches > 1 (e.g. parallel tool calls in back-to-back reads)", () => {
    expect(decodeTokensPerSecondFromRun({ ...burst, outputDeltaBatches: 2 })).toBeNull();
  });

  it("treats null/undefined batches as legacy (window rule only)", () => {
    const normal = { totalMs: 1100, ttftMs: 100, usageTokens: 31 };
    expect(decodeTokensPerSecondFromRun({ ...normal, outputDeltaBatches: null })).toBe(30);
    expect(decodeTokensPerSecondFromRun({ ...normal, outputDeltaBatches: undefined })).toBe(30);
  });
});

describe("prefillTokensPerSecondFromRun", () => {
  it("is prompt_tokens / (ttft_ms/1000)", () => {
    expect(prefillTokensPerSecondFromRun(200, 100)).toBe(500);
  });
  it("returns null for a tool call that arrived as a single burst (TTFT includes the whole call)", () => {
    expect(
      prefillTokensPerSecondFromRun(900, 120, { outputDeltaBatches: 1, firstOutputKind: "tool_call" }),
    ).toBeNull();
  });
  it("keeps prefill for a single-burst text reply, a streamed tool call, and legacy runs", () => {
    expect(prefillTokensPerSecondFromRun(200, 100, { outputDeltaBatches: 1, firstOutputKind: "text" })).toBe(500);
    expect(
      prefillTokensPerSecondFromRun(200, 100, { outputDeltaBatches: 5, firstOutputKind: "tool_call" }),
    ).toBe(500);
    expect(prefillTokensPerSecondFromRun(200, 100, { firstOutputKind: "tool_call" })).toBe(500);
    expect(prefillTokensPerSecondFromRun(200, 100, {})).toBe(500);
  });
  it("returns null without prompt tokens (no preview approx)", () => {
    expect(prefillTokensPerSecondFromRun(200, null)).toBeNull();
    expect(prefillTokensPerSecondFromRun(200, undefined)).toBeNull();
    expect(prefillTokensPerSecondFromRun(200, 0)).toBeNull();
  });
  it("returns null when ttft is missing or non-positive", () => {
    expect(prefillTokensPerSecondFromRun(null, 100)).toBeNull();
    expect(prefillTokensPerSecondFromRun(0, 100)).toBeNull();
    expect(prefillTokensPerSecondFromRun(-1, 100)).toBeNull();
  });
});

describe("roundTpsDisplay", () => {
  it("rounds positive finite values to 1 decimal", () => {
    expect(roundTpsDisplay(10.66)).toBe(10.7);
    expect(roundTpsDisplay(30)).toBe(30);
  });
  it("returns null for non-positive / non-finite", () => {
    expect(roundTpsDisplay(0)).toBeNull();
    expect(roundTpsDisplay(null)).toBeNull();
    expect(roundTpsDisplay(Number.NaN)).toBeNull();
  });
});
