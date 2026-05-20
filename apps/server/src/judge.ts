/**
 * LLM-as-Judge — meme/wireframe 시나리오의 0~3 루브릭 채점.
 *
 * 환경변수:
 *   LLM_JUDGE_ENABLED  — "1"/"true"일 때만 활성
 *   LLM_JUDGE_MODEL    — 기본 "claude-opus-4-7"
 *   ANTHROPIC_API_KEY  — 필수 (현재 Anthropic만 지원)
 *
 * 호출 스펙: temperature 0, timeout 30s, 재시도 0회.
 */
import { extractFirstJsonObject } from "./scoring/normalize.js";

const JUDGE_TIMEOUT_MS = 30_000;

export type JudgeImage = {
  bytes: Buffer;
  mediaType: "image/webp";
};

export type JudgeRequest = {
  image: JudgeImage;
  modelOutput: string;
  criterion: string;
  model?: string;
  /** 테스트 / proxy 주입용. 미지정 시 global fetch. */
  fetchImpl?: typeof fetch;
};

export type JudgeResult =
  | { enabled: false }
  | { enabled: true; rubric: 0 | 1 | 2 | 3; reason: string }
  | { enabled: true; error: "judge_timeout" | "judge_parse_error" | "judge_network_error"; reason: string };

export function isJudgeEnabled(): boolean {
  const v = process.env.LLM_JUDGE_ENABLED?.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

function judgeModel(): string {
  return process.env.LLM_JUDGE_MODEL?.trim() || "claude-opus-4-7";
}

export async function runLlmJudge(req: JudgeRequest): Promise<JudgeResult> {
  if (!isJudgeEnabled()) return { enabled: false };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      enabled: true,
      error: "judge_network_error",
      reason: "ANTHROPIC_API_KEY missing — judge requires Anthropic API key",
    };
  }

  const data = req.image.bytes.toString("base64");
  const body = {
    model: req.model ?? judgeModel(),
    max_tokens: 256,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: req.image.mediaType, data },
          },
          {
            type: "text",
            text: [
              req.criterion,
              "",
              "Model output to score:",
              "<<<",
              req.modelOutput,
              ">>>",
              "",
              "Reply with JSON only: {\"score\": 0|1|2|3, \"reason\": \"<short>\"}",
            ].join("\n"),
          },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  const doFetch = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(to);
    const msg = e instanceof Error ? e.message : String(e);
    if (controller.signal.aborted || /aborted/i.test(msg)) {
      return { enabled: true, error: "judge_timeout", reason: `judge_timeout: ${msg.slice(0, 120)}` };
    }
    return { enabled: true, error: "judge_network_error", reason: `judge_network_error: ${msg.slice(0, 120)}` };
  }
  clearTimeout(to);

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    return {
      enabled: true,
      error: "judge_network_error",
      reason: `judge_http_${response.status}: ${txt.slice(0, 120)}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { enabled: true, error: "judge_parse_error", reason: "judge response is not JSON" };
  }

  // Anthropic 메시지 스키마: { content: [{ type: "text", text: "..." }, ...] }
  const blocks = (payload as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  const objStr = extractFirstJsonObject(text);
  if (!objStr) {
    return { enabled: true, error: "judge_parse_error", reason: "no JSON object in judge response" };
  }
  let obj: { score?: unknown; reason?: unknown };
  try {
    obj = JSON.parse(objStr);
  } catch {
    return { enabled: true, error: "judge_parse_error", reason: "judge JSON parse failed" };
  }
  const score = obj.score;
  if (score !== 0 && score !== 1 && score !== 2 && score !== 3) {
    return { enabled: true, error: "judge_parse_error", reason: `invalid judge score: ${String(score)}` };
  }
  const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 200) : "";
  return { enabled: true, rubric: score as 0 | 1 | 2 | 3, reason };
}
