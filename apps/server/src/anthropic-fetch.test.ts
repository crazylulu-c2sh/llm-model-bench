import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_MIN_THINKING_BUDGET,
  _resetThinkingCacheForTests,
  anthropicMessagesPostWithThinking,
  looksLikeThinkingRejection,
  shouldRequestThinking,
  thinkingBudgetTokens,
} from "./anthropic-fetch.js";

const URL_ = "http://127.0.0.1:1234/v1/messages";
const BASE = "http://127.0.0.1:1234";
const THINKING = { type: "enabled" as const, budget_tokens: 1024 };

beforeEach(() => _resetThinkingCacheForTests());
afterEach(() => {
  _resetThinkingCacheForTests();
  delete process.env.BENCH_ANTHROPIC_THINKING;
});

describe("thinkingBudgetTokens", () => {
  it("1024 ≤ budget < max_tokens 를 지킨다", () => {
    expect(thinkingBudgetTokens(4096)).toBe(2048);
    expect(thinkingBudgetTokens(131_072)).toBe(65_536);
    // 절반이 최솟값보다 작으면 최솟값으로 올리되 여유(512)는 남긴다.
    expect(thinkingBudgetTokens(2048)).toBe(1024);
    for (const max of [4096, 2048, 1536]) {
      expect(thinkingBudgetTokens(max)!).toBeLessThan(max);
      expect(thinkingBudgetTokens(max)!).toBeGreaterThanOrEqual(ANTHROPIC_MIN_THINKING_BUDGET);
    }
  });

  it("여유가 없으면 null — 필드 자체를 생략한다 (#174 이후 살아나는 분기)", () => {
    expect(thinkingBudgetTokens(1535)).toBeNull();
    expect(thinkingBudgetTokens(293)).toBeNull();
    expect(thinkingBudgetTokens(20)).toBeNull();
    expect(thinkingBudgetTokens(Number.NaN)).toBeNull();
  });
});

describe("looksLikeThinkingRejection", () => {
  it("thinking 관련 거절 문구를 잡는다", () => {
    expect(looksLikeThinkingRejection(400, "unknown field: thinking")).toBe(true);
    expect(looksLikeThinkingRejection(400, "budget_tokens must be less than max_tokens")).toBe(true);
    expect(looksLikeThinkingRejection(422, "extended thinking not supported")).toBe(true);
  });

  it("무관한 오류는 잡지 않는다", () => {
    expect(looksLikeThinkingRejection(400, "model not loaded")).toBe(false);
    expect(looksLikeThinkingRejection(200, "thinking")).toBe(false);
  });
});

describe("shouldRequestThinking", () => {
  it("킬 스위치로 끌 수 있다", () => {
    expect(shouldRequestThinking(BASE)).toBe(true);
    process.env.BENCH_ANTHROPIC_THINKING = "0";
    expect(shouldRequestThinking(BASE)).toBe(false);
  });
});

describe("anthropicMessagesPostWithThinking", () => {
  function ok() {
    return new Response("{}", { status: 200 });
  }
  function reject(status = 400, body = "unknown field: thinking") {
    return new Response(body, { status });
  }

  it("정상 응답이면 thinking 을 실은 채 한 번만 호출한다", async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(
      fetchImpl, URL_, BASE, {}, { model: "m" }, THINKING,
    );
    expect(r.usedThinking).toBe(true);
    expect(r.retriedAfterThinkingRejection).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body));
    expect(body.thinking).toEqual(THINKING);
  });

  it("거절하면 thinking 을 빼고 한 번 재시도한다", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return calls.length === 1 ? reject() : ok();
    }) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(
      fetchImpl, URL_, BASE, {}, { model: "m" }, THINKING,
    );
    expect(r.retriedAfterThinkingRejection).toBe(true);
    expect(r.usedThinking).toBe(false);
    expect(r.response.status).toBe(200);
    expect((calls[0] as Record<string, unknown>).thinking).toEqual(THINKING);
    expect((calls[1] as Record<string, unknown>).thinking).toBeUndefined();
  });

  it("거절한 base_url 은 캐시돼 두 번째 런은 thinking 없이 1회만 호출한다", async () => {
    const first = vi.fn(async () => reject()) as unknown as typeof fetch;
    await anthropicMessagesPostWithThinking(first, URL_, BASE, {}, { model: "m" }, THINKING);
    expect(shouldRequestThinking(BASE)).toBe(false);

    const second = vi.fn(async () => ok()) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(second, URL_, BASE, {}, { model: "m" }, THINKING);
    expect(second).toHaveBeenCalledTimes(1);
    expect(r.usedThinking).toBe(false);
    const body = JSON.parse(String((second as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body));
    expect(body.thinking).toBeUndefined();
  });

  it("5xx 도 한 번 재시도한다 — 알 수 없는 필드에 500을 내는 shim 방어", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? reject(500, "boom") : ok())) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(
      fetchImpl, URL_, BASE, {}, { model: "m" }, THINKING,
    );
    expect(r.retriedAfterThinkingRejection).toBe(true);
    expect(r.response.status).toBe(200);
  });

  it("thinking 무관한 4xx 는 그대로 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => reject(404, "model not loaded")) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(
      fetchImpl, URL_, BASE, {}, { model: "m" }, THINKING,
    );
    expect(r.retriedAfterThinkingRejection).toBe(false);
    expect(r.response.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(shouldRequestThinking(BASE)).toBe(true);
  });

  it("thinking 이 null 이면 주입도 재시도도 하지 않는다", async () => {
    const fetchImpl = vi.fn(async () => reject()) as unknown as typeof fetch;
    const r = await anthropicMessagesPostWithThinking(
      fetchImpl, URL_, BASE, {}, { model: "m" }, null,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.usedThinking).toBe(false);
    expect(shouldRequestThinking(BASE)).toBe(true);
  });
});
