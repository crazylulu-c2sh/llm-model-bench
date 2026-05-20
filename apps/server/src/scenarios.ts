import {
  ALL_SCENARIO_IDS as SHARED_ALL_SCENARIO_IDS,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isVisionScenario,
  rubricToScore,
  stripThinkingBlocks,
  type ScenarioId,
} from "@llm-bench/shared";
import { z } from "zod";
import { resolvePublicAssetsOrigin } from "./tooling/bench-tools.js";
import {
  extractFirstJsonObject,
  normalizeProduct,
  normalizeQuarter,
  parseSignedPercent,
} from "./scoring/normalize.js";
import { buildImagePart } from "./vision-assets.js";

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
        "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the NIST FIPS 197 PDF.",
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
      "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the NIST FIPS 197 PDF.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
] as const;

export function isTranslateNistFips197PdfToolsScenario(id: ScenarioId): boolean {
  return id === "translate_nist_fips197_pdf_tools";
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
  if (isTranslateNistFips197PdfToolsScenario(id)) {
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
  if (isTranslateNistFips197PdfToolsScenario(id)) {
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

export function scenarioSystemMessageContent(id: ScenarioId): string {
  return getScenarioSystemPromptPreview(id);
}

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export function buildMessages(
  id: ScenarioId,
  ctx?: ScenarioPromptContext,
): {
  messages: OpenAiMessage[];
  tools?: unknown;
  tool_choice?: unknown;
} {
  const systemContent = scenarioSystemMessageContent(id);
  const userTextContent = scenarioUserMessageContent(id, ctx);

  const messages: OpenAiMessage[] = [{ role: "system", content: systemContent }];

  if (isVisionScenario(id)) {
    const origin = ctx?.publicAssetsOrigin?.trim()
      ? ctx.publicAssetsOrigin.trim()
      : resolvePublicAssetsOrigin({ publicAssetsOrigin: ctx?.publicAssetsOrigin });
    const imagePart = buildImagePart(id, origin, "openai");
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userTextContent },
        imagePart,
      ],
    });
  } else {
    messages.push({ role: "user", content: userTextContent });
  }

  const tools = openAiToolsForScenario(id);
  if (tools) {
    return { messages, tools: [...tools], tool_choice: "auto" };
  }
  return { messages };
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

/** NFKC + zero-width 제거 후 소문자 — 복제 유니코드 날짜와 ASCII `YYYY-MM-DD` 채점 정합 */
function normalizeForCalendarDateMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();
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
  const norm = normalizeForCalendarDateMatch(trimmed);
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

/** 응답 텍스트의 주요 스크립트를 판정. stress KO/JA 워크로드의 `script_match` 라벨용. */
export function detectScript(text: string): "ko" | "ja" | "latin" | "mixed" | "unknown" {
  if (!text) return "unknown";
  const stripped = text.replace(/\s+/g, "");
  const total = stripped.length;
  if (total === 0) return "unknown";
  let hangul = 0;
  let hiraKata = 0;
  let han = 0;
  let latin = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp >= 0xac00 && cp <= 0xd7a3) hangul++;
    else if ((cp >= 0x3041 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) hiraKata++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) han++;
    else if ((cp >= 0x0041 && cp <= 0x005a) || (cp >= 0x0061 && cp <= 0x007a) || (cp >= 0x0030 && cp <= 0x0039))
      latin++;
  }
  const hangulRate = hangul / total;
  const hiraKataRate = hiraKata / total;
  const latinRate = latin / total;
  if (hangulRate >= 0.3) return "ko";
  if (hiraKataRate >= 0.2) return "ja";
  if (latinRate >= 0.9) return "latin";
  if (hangul + hiraKata + han + latin >= total * 0.5) return "mixed";
  return "unknown";
}

/** Heuristic: quicksort-style implementation cues (not a correctness proof). */
const CODE_SORT_QUICKSORT_CUE_RE =
  /partition|pivot|quicksort|quick_sort|quick\s*sort|lomuto|hoare/i;

function scoreCodeSortJs(code: string): { pass: boolean; score: number; reason?: string } {
  const hasEntry = /function\s+sortNums|const\s+sortNums|sortNums\s*=/.test(code);
  if (!hasEntry) return { pass: false, score: 0, reason: "missing sortNums" };
  if (/\.sort\s*\(/.test(code)) return { pass: false, score: 0, reason: "builtin sort not allowed" };
  if (!CODE_SORT_QUICKSORT_CUE_RE.test(code))
    return { pass: false, score: 0, reason: "missing quicksort cues" };
  return { pass: true, score: 1 };
}

function scoreCodeSortPy(code: string): { pass: boolean; score: number; reason?: string } {
  if (!/def\s+sort_nums/.test(code)) return { pass: false, score: 0, reason: "missing def sort_nums" };
  if (/\bsorted\s*\(/.test(code)) return { pass: false, score: 0, reason: "builtin sort not allowed" };
  if (/\.sort\s*\(/.test(code)) return { pass: false, score: 0, reason: "builtin sort not allowed" };
  if (!CODE_SORT_QUICKSORT_CUE_RE.test(code))
    return { pass: false, score: 0, reason: "missing quicksort cues" };
  return { pass: true, score: 1 };
}

export function scoreScenario(
  id: ScenarioId,
  output: string,
  ctx?: ScoreContext,
): { pass: boolean; score?: number; reason?: string } {
  switch (id) {
    case "chat_hello":
    case "chat_ping":
    case "stress_ping":
    case "stress_short_reply":
    case "stress_short_reply_ko":
    case "stress_short_reply_ja":
    case "stress_long_context":
    case "stress_long_context_ko":
    case "stress_long_context_ja": {
      const r = scoreChatMinimal(output);
      return r;
    }
    case "code_sort_js": {
      const base = stripThinkingBlocks(output);
      const m = base.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i);
      const code = m?.[1] ?? base;
      return scoreCodeSortJs(code);
    }
    case "code_sort_py": {
      const base = stripThinkingBlocks(output);
      const m = base.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
      const code = m?.[1] ?? base;
      return scoreCodeSortPy(code);
    }
    case "translate_nist_fips197_pdf_tools": {
      const response = stripThinkingBlocks(output);
      const hasHangul = /[\u3131-\u318E\uAC00-\uD7A3]/.test(response);
      const usedPdf = ctx?.invokedBenchTools?.includes("fetch_pdf_text") === true;
      const ok = hasHangul && usedPdf && response.length < 1000;
      return {
        pass: ok,
        score: ok ? 1 : 0,
        reason: ok
          ? undefined
          : `hangul=${hasHangul} fetch_pdf_text=${usedPdf} len=${response.length} rawLen=${output.length}`,
      };
    }
    case "chat_time_calendar":
      return scoreChatTimeCalendar(output, ctx?.calendarReferenceIso, ctx?.calendarTimeZone);
    case "tool_weather": {
      const pass = toolWeatherOutputPass(output);
      return { pass, score: pass ? 1 : 0, reason: pass ? undefined : "expected tool call signal" };
    }
    case "structured_action": {
      const jsonMatch = stripThinkingBlocks(output).match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { pass: false, reason: "no json object" };
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        ActionSchema.parse(parsed);
        return { pass: true, score: 1 };
      } catch (e) {
        return { pass: false, reason: String(e) };
      }
    }
    case "vision_table_ocr_a":
      return scoreVisionTableOcr(output, { net_income_2024: 2373.9, net_income_yoy_percent: 11.3 });
    case "vision_table_ocr_b":
      return scoreVisionTableOcr(output, { net_income_2024: 410.55, net_income_yoy_percent: 20.7 });
    case "vision_count_red_cars_a":
      return scoreVisionCountRedCars(output, [31, 37]);
    case "vision_count_red_cars_b":
      return scoreVisionCountRedCars(output, [40, 48]);
    case "vision_chart_peak_a":
      return scoreVisionChartPeak(output, { product: "C", quarter: "Q2 2024", value_percent: 45.8 });
    case "vision_chart_peak_b":
      return scoreVisionChartPeak(output, { product: "C", quarter: "Q2 2024", value_percent: 62.4 });
    case "vision_meme_explain_a":
    case "vision_meme_explain_b":
      return scoreVisionMemeExplain(output);
    case "vision_wireframe_html_a":
      return scoreVisionWireframe(output, ["sign up", "learn more", "feature"]);
    case "vision_wireframe_html_b":
      return scoreVisionWireframe(output, ["get started", "learn more", "feature title"]);
    default:
      return { pass: false, reason: "unknown scenario" };
  }
}

function rubricResult(
  rubric: 0 | 1 | 2 | 3,
  reason: string,
): { pass: boolean; score: number; reason: string } {
  const { pass, score } = rubricToScore(rubric);
  return { pass, score, reason: `rubric=${rubric} | ${reason}` };
}

function scoreVisionTableOcr(
  output: string,
  expected: { net_income_2024: number; net_income_yoy_percent: number },
): { pass: boolean; score: number; reason: string } {
  const objStr = extractFirstJsonObject(output);
  if (!objStr) return rubricResult(0, "no json object");
  let obj: { net_income_2024?: unknown; net_income_yoy_percent?: unknown };
  try {
    obj = JSON.parse(objStr);
  } catch (e) {
    return rubricResult(0, `json parse failed: ${String(e).slice(0, 80)}`);
  }
  const value = parseSignedPercent(obj.net_income_2024 as string | number | null | undefined);
  const yoy = parseSignedPercent(obj.net_income_yoy_percent as string | number | null | undefined);
  if (value == null || yoy == null) return rubricResult(0, "missing keys");
  const valueOk = Math.abs(value - expected.net_income_2024) / Math.abs(expected.net_income_2024) <= 0.02;
  const yoyOk = Math.abs(yoy - expected.net_income_yoy_percent) <= 0.5;
  if (valueOk && yoyOk)
    return rubricResult(3, `value=${value} yoy=${yoy}`);
  if (valueOk || yoyOk)
    return rubricResult(2, `value=${value} yoy=${yoy} (one-side)`);
  return rubricResult(1, `value=${value} yoy=${yoy} (both off)`);
}

function scoreVisionCountRedCars(
  output: string,
  range: [number, number],
): { pass: boolean; score: number; reason: string } {
  const objStr = extractFirstJsonObject(output);
  if (!objStr) return rubricResult(0, "no json object");
  let obj: { red_cars?: unknown };
  try {
    obj = JSON.parse(objStr);
  } catch (e) {
    return rubricResult(0, `json parse failed: ${String(e).slice(0, 80)}`);
  }
  const raw = obj.red_cars;
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : typeof raw === "string"
        ? Math.trunc(Number(raw))
        : null;
  if (n == null || !Number.isFinite(n)) return rubricResult(0, "missing or invalid red_cars");
  if (n === 0) return rubricResult(0, "red_cars=0 (explicit zero)");
  if (n >= 100) return rubricResult(0, `red_cars=${n} (excessive hallucination)`);
  const [lo, hi] = range;
  if (n >= lo && n <= hi) return rubricResult(3, `predicted=${n} range=[${lo},${hi}]`);
  if (n >= lo - 3 && n <= hi + 3) return rubricResult(2, `predicted=${n} range=[${lo},${hi}]`);
  if (n >= lo - 5 && n <= hi + 5) return rubricResult(1, `predicted=${n} range=[${lo},${hi}]`);
  return rubricResult(0, `predicted=${n} range=[${lo},${hi}]`);
}

function scoreVisionChartPeak(
  output: string,
  expected: { product: string; quarter: string; value_percent: number },
): { pass: boolean; score: number; reason: string } {
  const objStr = extractFirstJsonObject(output);
  if (!objStr) return rubricResult(0, "no json object");
  let obj: { product?: unknown; quarter?: unknown; value_percent?: unknown };
  try {
    obj = JSON.parse(objStr);
  } catch (e) {
    return rubricResult(0, `json parse failed: ${String(e).slice(0, 80)}`);
  }
  const product = normalizeProduct(obj.product as string | null | undefined);
  const quarter = normalizeQuarter(obj.quarter as string | null | undefined);
  const value = parseSignedPercent(obj.value_percent as string | number | null | undefined);
  if (product == null || quarter == null || value == null)
    return rubricResult(0, "missing keys");
  const productOk = product === expected.product;
  const quarterOk = quarter === expected.quarter;
  const valueOk = Math.abs(value - expected.value_percent) <= 1.5;
  const passes = [productOk, quarterOk, valueOk].filter(Boolean).length;
  const tag = `product=${product}(${productOk}) quarter=${quarter}(${quarterOk}) value=${value}(${valueOk})`;
  if (passes === 3) return rubricResult(3, tag);
  if (passes === 2) return rubricResult(2, tag);
  if (passes === 1) return rubricResult(1, tag);
  return rubricResult(0, tag);
}

function scoreVisionMemeExplain(output: string): { pass: boolean; score: number; reason: string } {
  const text = stripThinkingBlocks(output);
  const hasHangul = /[가-힣]/.test(text);
  const lowered = text.toLowerCase();
  const hasServer = /서버|데이터센터|랙|server|datacenter|data center/i.test(text);
  const hasDonkey = /당나귀|수레|짐마차|donkey|cart/i.test(text);
  const hasContrast = /대비|차이|기대|현실|약속|실제|promise|reality|expect|expectation/i.test(text);
  void lowered;
  const passed = [hasHangul, hasServer, hasDonkey, hasContrast].filter(Boolean).length;
  if (passed < 4) {
    return rubricResult(
      0,
      `prefilter fail: hangul=${hasHangul} server=${hasServer} donkey=${hasDonkey} contrast=${hasContrast}`,
    );
  }
  // 모든 prefilter 통과 → 잠정 1점(judge_pending). bench-runner가 judge로 덮어쓴다.
  return rubricResult(
    1,
    "judge_pending: prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging",
  );
}

function scoreVisionWireframe(
  output: string,
  requiredCues: string[],
): { pass: boolean; score: number; reason: string } {
  const stripped = stripThinkingBlocks(output);
  const fenceMatch = stripped.match(/```html\s*([\s\S]*?)```/i) ?? stripped.match(/```\s*([\s\S]*?)```/);
  if (!fenceMatch) return rubricResult(0, "no html fence");
  const html = fenceMatch[1];
  const htmlLc = html.toLowerCase();
  const semantics = ["<header", "<nav", "<main", "<section", "<footer"].filter((t) => htmlLc.includes(t));
  if (semantics.length < 3) return rubricResult(0, `semantic tags ${semantics.length}/3`);
  const missing = requiredCues.filter((cue) => !htmlLc.includes(cue.toLowerCase()));
  if (missing.length > 0) return rubricResult(0, `missing cues: ${missing.join(", ")}`);
  return rubricResult(
    1,
    "judge_pending: prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging",
  );
}

export type AnthropicContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      source:
        | { type: "base64"; media_type: "image/webp"; data: string }
        | { type: "url"; url: string };
    };

export type AnthropicUserAssistantMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentPart[];
};

export function anthropicMessagesForScenario(
  id: ScenarioId,
  ctx?: ScenarioPromptContext,
): {
  system?: string;
  messages: AnthropicUserAssistantMessage[];
} {
  const systemContent = scenarioSystemMessageContent(id);
  const userText = scenarioUserMessageContent(id, ctx);
  if (!isVisionScenario(id)) {
    return {
      system: systemContent,
      messages: [{ role: "user", content: userText }],
    };
  }
  const origin = ctx?.publicAssetsOrigin?.trim()
    ? ctx.publicAssetsOrigin.trim()
    : resolvePublicAssetsOrigin({ publicAssetsOrigin: ctx?.publicAssetsOrigin });
  const imagePart = buildImagePart(id, origin, "anthropic");
  return {
    system: systemContent,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          imagePart,
        ],
      },
    ],
  };
}
