import {
  ALL_SCENARIO_IDS as SHARED_ALL_SCENARIO_IDS,
  getScenarioUserPromptPreview,
  type ScenarioId,
} from "@llm-bench/shared";
import { z } from "zod";
import { resolvePublicAssetsOrigin } from "./tooling/bench-tools.js";

export type { ScenarioId };
export const ALL_SCENARIO_IDS = SHARED_ALL_SCENARIO_IDS;

const translateToolsOpenAi = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "HTTP GET the URL and return the body decoded as UTF-8 text (truncated). Do not use for PDF files; use fetch_pdf_text instead.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_pdf_text",
      description:
        "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the Bitcoin whitepaper PDF.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL to a .pdf" } },
        required: ["url"],
      },
    },
  },
] as const;

const translateToolsAnthropic = [
  {
    name: "fetch_url",
    description:
      "HTTP GET the URL and return the body decoded as UTF-8 text (truncated). Do not use for PDF files; use fetch_pdf_text instead.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "fetch_pdf_text",
    description:
      "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the Bitcoin whitepaper PDF.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
] as const;

export function isTranslateBitcoinPdfToolsScenario(id: ScenarioId): boolean {
  return id === "translate_bitcoin_pdf_tools";
}

export function openAiToolsForScenario(id: ScenarioId): unknown[] | undefined {
  if (id === "tool_weather") {
    return [
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
    ];
  }
  if (isTranslateBitcoinPdfToolsScenario(id)) {
    return [...translateToolsOpenAi];
  }
  return undefined;
}

export function anthropicToolsForScenario(id: ScenarioId): unknown[] | undefined {
  if (id === "tool_weather") {
    return [
      {
        name: "get_weather",
        description: "Get weather for a city",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
  }
  if (isTranslateBitcoinPdfToolsScenario(id)) {
    return [...translateToolsAnthropic];
  }
  return undefined;
}

export type ScenarioPromptContext = {
  publicAssetsOrigin?: string;
  /** 벤치 루프에서 주입 — `chat_time_calendar` 프롬프트·채점에 사용 */
  referenceAt?: Date;
  /** IANA — 기본 Asia/Seoul */
  calendarTimeZone?: string;
};

/** 벤치 요청·UI `scenario_start`와 동일한 user 텍스트 */
export function scenarioUserMessageContent(id: ScenarioId, ctx?: ScenarioPromptContext): string {
  const base = ctx?.publicAssetsOrigin?.trim()
    ? ctx.publicAssetsOrigin.trim()
    : resolvePublicAssetsOrigin({ publicAssetsOrigin: ctx?.publicAssetsOrigin });
  const tz = ctx?.calendarTimeZone ?? "Asia/Seoul";
  const refIso = ctx?.referenceAt?.toISOString();
  return getScenarioUserPromptPreview(id, {
    publicAssetBaseUrl: base,
    referenceIso: refIso,
    calendarTimeZone: tz,
  });
}

export function buildMessages(
  id: ScenarioId,
  ctx?: ScenarioPromptContext,
): {
  messages: { role: "system" | "user" | "assistant" | "tool"; content?: string | null; tool_calls?: unknown; tool_call_id?: string }[];
  tools?: unknown;
  tool_choice?: unknown;
} {
  const userContent = scenarioUserMessageContent(id, ctx);

  const tools = openAiToolsForScenario(id);
  if (tools) {
    return {
      messages: [{ role: "user", content: userContent }],
      tools: [...tools],
      tool_choice: "auto",
    };
  }

  return { messages: [{ role: "user", content: userContent }] };
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

function ymdPartsInTimeZone(iso: string, timeZone: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const [ys, ms, ds] = parts;
  const y = Number(ys);
  const m = Number(ms);
  const day = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  return { y, m, d: day };
}

function calendarYmdAddDays(y: number, mo: number, d: number, deltaDays: number): string {
  const x = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** [yesterday, today, tomorrow] YYYY-MM-DD in `timeZone` for instant `iso` */
export function expectedCalendarTriple(iso: string, timeZone: string): [string, string, string] | null {
  const today = ymdPartsInTimeZone(iso, timeZone);
  if (!today) return null;
  const todayStr = `${String(today.y).padStart(4, "0")}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;
  const yest = calendarYmdAddDays(today.y, today.m, today.d, -1);
  const tom = calendarYmdAddDays(today.y, today.m, today.d, 1);
  return [yest, todayStr, tom];
}

function scoreChatTimeCalendar(output: string, iso: string | undefined, timeZone: string | undefined): {
  pass: boolean;
  score?: number;
  reason?: string;
} {
  const tz = timeZone ?? "Asia/Seoul";
  const trimmed = output.trim();
  if (!trimmed) return { pass: false, score: 0, reason: "empty output" };
  if (!iso) return { pass: false, score: 0, reason: "missing calendar reference" };
  const triple = expectedCalendarTriple(iso, tz);
  if (!triple) return { pass: false, score: 0, reason: "invalid calendar reference" };
  const norm = trimmed.toLowerCase();
  const missing = triple.filter((ymd) => !norm.includes(ymd.toLowerCase()));
  if (missing.length === 0) return { pass: true, score: 1 };
  return { pass: false, score: 0, reason: `missing dates: ${missing.join(", ")}` };
}

export type ScoreContext = {
  invokedBenchTools?: string[];
  calendarReferenceIso?: string;
  calendarTimeZone?: string;
};

function scoreChatMinimal(output: string): { pass: boolean; reason?: string } {
  const trimmed = output.trim();
  if (!trimmed) return { pass: false, reason: "empty output" };
  return { pass: true };
}

export function scoreScenario(
  id: ScenarioId,
  output: string,
  ctx?: ScoreContext,
): { pass: boolean; score?: number; reason?: string } {
  switch (id) {
    case "chat_hello":
    case "chat_ping": {
      const r = scoreChatMinimal(output);
      return r;
    }
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
    case "translate_bitcoin_pdf_tools": {
      const hasHangul = /[\u3131-\u318E\uAC00-\uD7A3]/.test(output);
      const usedPdf = ctx?.invokedBenchTools?.includes("fetch_pdf_text") === true;
      const ok = hasHangul && usedPdf && output.length < 200;
      return {
        pass: ok,
        score: ok ? 1 : 0,
        reason: ok ? undefined : `hangul=${hasHangul} fetch_pdf_text=${usedPdf} len=${output.length}`,
      };
    }
    case "chat_time_calendar":
      return scoreChatTimeCalendar(output, ctx?.calendarReferenceIso, ctx?.calendarTimeZone);
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

export function anthropicMessagesForScenario(
  id: ScenarioId,
  ctx?: ScenarioPromptContext,
): {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
} {
  const { messages, tools } = buildMessages(id, ctx);
  void tools;
  const sys = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: string }[];
  return {
    system: typeof sys?.content === "string" ? sys.content : undefined,
    messages: rest.length ? rest : [{ role: "user", content: "ping" }],
  };
}
