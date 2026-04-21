import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_SCENARIO_IDS as SHARED_ALL_SCENARIO_IDS,
  getScenarioUserPromptPreview,
  type ScenarioId,
} from "@llm-bench/shared";
import { z } from "zod";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/conx_whitepaper_excerpt.txt",
);

let excerptCache: string | null = null;

/** 벤치/DB 프롬프트 미리보기용 — fixtures 발췌 */
export function conxExcerpt(): string {
  if (excerptCache) return excerptCache;
  try {
    excerptCache = readFileSync(fixturePath, "utf8").trim().slice(0, 800);
  } catch {
    excerptCache =
      "The network connects systems and enables coordination across distributed components.";
  }
  return excerptCache;
}

export type { ScenarioId };
export const ALL_SCENARIO_IDS = SHARED_ALL_SCENARIO_IDS;

/** 벤치 요청·UI `scenario_start`와 동일한 user 텍스트(번역 시 fixtures 발췌 포함). */
export function scenarioUserMessageContent(id: ScenarioId): string {
  return id === "translate_roundtrip_stub"
    ? getScenarioUserPromptPreview(id, { translationExcerpt: conxExcerpt() })
    : getScenarioUserPromptPreview(id);
}

export function buildMessages(
  id: ScenarioId,
): { messages: { role: "system" | "user"; content: string }[]; tools?: unknown; tool_choice?: unknown } {
  const userContent = scenarioUserMessageContent(id);

  switch (id) {
    case "tool_weather":
      return {
        messages: [{ role: "user", content: userContent }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
        tool_choice: "auto",
      };
    default:
      return { messages: [{ role: "user", content: userContent }] };
  }
}

const ActionSchema = z.object({
  action: z.string(),
  confidence: z.number().min(0).max(1),
});

function toolWeatherOutputPass(output: string): boolean {
  if (/"name"\s*:\s*"get_weather"/.test(output) || /\bget_weather\b/.test(output)) return true;
  const fromJson = (raw: string): boolean => {
    try {
      const parsed = JSON.parse(raw) as { tool_calls?: { function?: { name?: string } }[] };
      const calls = parsed.tool_calls;
      return Array.isArray(calls) && calls.some((c) => c.function?.name === "get_weather");
    } catch {
      return false;
    }
  };
  const trimmed = output.trim();
  if (fromJson(trimmed)) return true;
  for (const line of trimmed.split(/\n+/)) {
    const s = line.trim();
    if (s.startsWith("{") && fromJson(s)) return true;
  }
  return false;
}

export function scoreScenario(id: ScenarioId, output: string): { pass: boolean; score?: number; reason?: string } {
  const t = output.trim().toLowerCase();
  switch (id) {
    case "chat_hello":
      return { pass: /\bhello\b/.test(t), reason: t.slice(0, 200) };
    case "chat_ping":
      return { pass: /\bpong\b/.test(t), reason: t.slice(0, 200) };
    case "code_sort_js": {
      const m = output.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i);
      const code = m?.[1] ?? output;
      const ok =
        /function\s+sortNums|const\s+sortNums|sortNums\s*=/.test(code) &&
        /sort|\.sort\(/.test(code);
      return { pass: ok, score: ok ? 1 : 0, reason: ok ? undefined : "missing sortNums or sort" };
    }
    case "code_sort_py": {
      const m = output.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
      const code = m?.[1] ?? output;
      const ok = /def\s+sort_nums/.test(code) && /sorted|\.sort/.test(code);
      return { pass: ok, score: ok ? 1 : 0, reason: ok ? undefined : "missing def sort_nums" };
    }
    case "translate_roundtrip_stub": {
      const hasHangul = /[\u3131-\u318E\uAC00-\uD7A3]/.test(output);
      return { pass: hasHangul && output.length < 120, reason: output.slice(0, 200) };
    }
    case "tool_weather": {
      const pass = toolWeatherOutputPass(output);
      return { pass, score: pass ? 1 : 0, reason: pass ? undefined : "expected tool call signal" };
    }
    case "structured_action": {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { pass: false, reason: "no json object" };
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        ActionSchema.parse(parsed);
        return { pass: true, score: 1 };
      } catch (e) {
        return { pass: false, reason: String(e) };
      }
    }
    default:
      return { pass: false, reason: "unknown scenario" };
  }
}

export function anthropicMessagesForScenario(id: ScenarioId): {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools?: unknown;
} {
  const { messages, tools } = buildMessages(id);
  const sys = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: string }[];
  return {
    system: sys?.content,
    messages: rest.length ? rest : [{ role: "user", content: "ping" }],
    tools: tools as unknown,
  };
}
