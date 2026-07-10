import { afterEach, describe, expect, it, vi } from "vitest";
import { runLlmJudge } from "./judge.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function anthropicJudgeResponse(score: number, reason = "ok"): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ score, reason }) }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("runLlmJudge generalization (#79)", () => {
  it("disabled when LLM_JUDGE_ENABLED is off", async () => {
    delete process.env.LLM_JUDGE_ENABLED;
    const r = await runLlmJudge({ modelOutput: "x", criterion: "c" });
    expect(r).toEqual({ enabled: false });
  });

  it("text (no image) 0-3 judge: no image block in request, accepts 0-3", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    let sentBody: { messages?: Array<{ content?: Array<{ type?: string }> }> } = {};
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return anthropicJudgeResponse(2);
    });
    const r = await runLlmJudge({
      modelOutput: '{"title":"x"}',
      criterion: "score the JSON",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ enabled: true, rubric: 2 });
    const parts = sentBody.messages?.[0]?.content ?? [];
    expect(parts.some((p) => p.type === "image")).toBe(false);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });

  it("binary scale: accepts 0|1, rejects 2", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const ok = await runLlmJudge({
      modelOutput: "answer",
      criterion: "pass?",
      scale: "binary",
      fetchImpl: (async () => anthropicJudgeResponse(1)) as unknown as typeof fetch,
    });
    expect(ok).toMatchObject({ enabled: true, rubric: 1 });

    const bad = await runLlmJudge({
      modelOutput: "answer",
      criterion: "pass?",
      scale: "binary",
      fetchImpl: (async () => anthropicJudgeResponse(2)) as unknown as typeof fetch,
    });
    expect("error" in bad && bad.error).toBe("judge_parse_error");
  });

  it("vision path unchanged: image block present when image provided", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    let sentBody: { messages?: Array<{ content?: Array<{ type?: string }> }> } = {};
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return anthropicJudgeResponse(3);
    });
    const r = await runLlmJudge({
      image: { bytes: Buffer.from([1, 2, 3]), mediaType: "image/jpeg" },
      modelOutput: "desc",
      criterion: "score the image description",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ enabled: true, rubric: 3 });
    const parts = sentBody.messages?.[0]?.content ?? [];
    expect(parts.some((p) => p.type === "image")).toBe(true);
  });
});
