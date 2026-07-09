import { describe, expect, it } from "vitest";
import {
  PUBLIC_SCENARIO_IDS,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isVisionScenario,
} from "@llm-bench/shared";
import {
  anthropicMessagesForScenario,
  buildMessages,
  detectScript,
  expectedCalendarTriple,
  scoreScenario,
  type OpenAiContentPart,
} from "./scenarios.js";

describe("buildMessages", () => {
  it("includes system and user roles for basic scenario", () => {
    const built = buildMessages("chat_ping");
    expect(built.messages[0]?.role).toBe("system");
    expect(typeof built.messages[0]?.content).toBe("string");
    expect(built.messages[1]?.role).toBe("user");
    expect(built.messages[1]?.content).toBe("ping");
  });

  it("keeps tools while preserving system+user message order", () => {
    const built = buildMessages("tool_weather");
    expect(built.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(Array.isArray(built.tools)).toBe(true);
  });
});

describe("scoreScenario tool_weather", () => {
  it("passes when tool_calls JSON is on its own line after assistant text", () => {
    const out = 'Here.\n{"tool_calls":[{"index":0,"type":"function","function":{"name":"get_weather","arguments":"{}"}}]}';
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });

  it("passes on standalone tool_calls JSON", () => {
    const out = JSON.stringify({
      tool_calls: [{ function: { name: "get_weather", arguments: '{"city":"Seattle"}' } }],
    });
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });

  it("fails on prose that merely mentions get_weather without calling it", () => {
    expect(scoreScenario("tool_weather", "I cannot call get_weather for you.").pass).toBe(false);
    expect(scoreScenario("tool_weather", "The get_weather tool would help here.").pass).toBe(false);
  });

  it('passes on inline <tool_call> style with "name":"get_weather"', () => {
    const out = '<tool_call>{"name": "get_weather", "arguments": {"city": "Seattle"}}</tool_call>';
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });

  it("fails when the only get_weather signature is leaked inside a <think> block", () => {
    // LM Studio 엔진 프로토콜 회귀 등으로 추론이 content로 누수된 케이스: 사고 안의 가짜 호출은 진짜 호출이 아니다.
    const out =
      '<think>I should call {"name":"get_weather"} here.</think>Sorry, I cannot check the weather.';
    expect(scoreScenario("tool_weather", out).pass).toBe(false);
  });

  it("still passes when a real tool_calls signature follows a leaked <think> block", () => {
    const out =
      '<think>let me think</think>\n{"tool_calls":[{"function":{"name":"get_weather","arguments":"{}"}}]}';
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });
});

describe("scoreScenario stress_long_context*", () => {
  it("passes non-empty output (en/ko/ja)", () => {
    expect(scoreScenario("stress_long_context", "Computing has a long history.").pass).toBe(true);
    expect(scoreScenario("stress_long_context_ko", "컴퓨팅의 역사는 길다.").pass).toBe(true);
    expect(scoreScenario("stress_long_context_ja", "計算機の歴史は長い。").pass).toBe(true);
  });

  it("fails on empty output", () => {
    expect(scoreScenario("stress_long_context", "").pass).toBe(false);
    expect(scoreScenario("stress_long_context_ko", "   ").pass).toBe(false);
  });
});

describe("buildMessages stress_long_context_ko", () => {
  it("includes Korean system + ~2500-token user corpus + summarization tail", () => {
    const built = buildMessages("stress_long_context_ko");
    expect(built.messages[0]?.role).toBe("system");
    expect(typeof built.messages[0]?.content).toBe("string");
    expect(built.messages[0]?.content as string).toContain("요약");
    expect(built.messages[1]?.role).toBe("user");
    const userText = built.messages[1]?.content as string;
    expect(userText.length).toBeGreaterThan(1500); // ~3700 chars expected
    expect(userText).toContain("한 문장으로 요약");
  });
});

describe("scoreScenario chat_hello / chat_ping", () => {
  it("fails on empty or whitespace-only output", () => {
    expect(scoreScenario("chat_hello", "").pass).toBe(false);
    expect(scoreScenario("chat_hello", "   ").pass).toBe(false);
    expect(scoreScenario("chat_ping", "").reason).toBe("empty output");
  });

  it("passes on any non-empty trimmed output (no content judging)", () => {
    expect(scoreScenario("chat_hello", "anything").pass).toBe(true);
    expect(scoreScenario("chat_ping", "pong").pass).toBe(true);
    expect(scoreScenario("chat_ping", "not pong").pass).toBe(true);
  });
});

describe("scoreScenario stress_*", () => {
  it("treats all stress workloads as chat-minimal (non-empty passes)", () => {
    expect(scoreScenario("stress_ping", "pong").pass).toBe(true);
    expect(scoreScenario("stress_short_reply", "ok").pass).toBe(true);
    expect(scoreScenario("stress_short_reply_ko", "안녕하세요").pass).toBe(true);
    expect(scoreScenario("stress_short_reply_ja", "こんにちは").pass).toBe(true);
    expect(scoreScenario("stress_ping", "").pass).toBe(false);
  });
});

describe("detectScript", () => {
  it("classifies Korean-dominant text as ko", () => {
    expect(detectScript("부하 테스트는 처리량을 측정합니다.")).toBe("ko");
  });

  it("classifies Japanese hiragana/katakana as ja", () => {
    expect(detectScript("負荷テストはスループットを測定します。")).toBe("ja");
  });

  it("classifies pure English as latin", () => {
    expect(detectScript("A load test measures throughput.")).toBe("latin");
  });

  it("returns unknown for empty input", () => {
    expect(detectScript("")).toBe("unknown");
    expect(detectScript("   ")).toBe("unknown");
  });

  it("falls back to mixed for non-dominant scripts", () => {
    expect(detectScript("Hello 안녕 hello")).toMatch(/mixed|ko/);
  });
});

describe("buildMessages stress_*", () => {
  it("produces system+user messages for stress_short_reply_ko (Korean prompt)", () => {
    const built = buildMessages("stress_short_reply_ko");
    expect(built.messages[0]?.role).toBe("system");
    expect(String(built.messages[0]?.content)).toMatch(/한국어/);
    expect(built.messages[1]?.role).toBe("user");
    expect(String(built.messages[1]?.content)).toMatch(/부하 테스트/);
  });

  it("produces Japanese system+user for stress_short_reply_ja", () => {
    const built = buildMessages("stress_short_reply_ja");
    expect(String(built.messages[0]?.content)).toMatch(/日本語/);
    expect(String(built.messages[1]?.content)).toMatch(/負荷テスト/);
  });
});

describe("scoreScenario chat_time_calendar", () => {
  it("passes when yesterday, today, tomorrow YYYY-MM-DD all appear", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const triple = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(triple).not.toBeNull();
    const [y, td, tm] = triple!;
    const out = `어제 ${y}, 오늘은 ${td}, 내일 ${tm} 입니다.`;
    expect(
      scoreScenario("chat_time_calendar", out, {
        calendarReferenceIso: iso,
        calendarTimeZone: "Asia/Seoul",
      }).pass,
    ).toBe(true);
  });

  it("fails when reference iso is missing", () => {
    expect(scoreScenario("chat_time_calendar", "2024-01-01").pass).toBe(false);
  });

  it("fails when a date is missing from output", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const triple = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(triple).not.toBeNull();
    const [, td] = triple!;
    expect(
      scoreScenario("chat_time_calendar", `오늘만 ${td}`, {
        calendarReferenceIso: iso,
        calendarTimeZone: "Asia/Seoul",
      }).pass,
    ).toBe(false);
  });

  it("passes when YYYY-MM-DD uses fullwidth digits (NFKC)", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const triple = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(triple).not.toBeNull();
    const [y, td, tm] = triple!;
    const toFull = (ascii: string) =>
      ascii.replace(/[-0-9]/g, (ch) => {
        if (ch === "-") return "\uFF0D";
        const d = ch.charCodeAt(0) - 0x30;
        return String.fromCharCode(0xff10 + d);
      });
    const out = `어제 ${toFull(y)}, 오늘 ${toFull(td)}, 내일 ${toFull(tm)}`;
    expect(
      scoreScenario("chat_time_calendar", out, {
        calendarReferenceIso: iso,
        calendarTimeZone: "Asia/Seoul",
      }).pass,
    ).toBe(true);
  });

  it("passes when zero-width spaces sit inside date tokens", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const triple = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(triple).not.toBeNull();
    const [y, td, tm] = triple!;
    const z = "\u200B";
    const out = `어제 ${y.slice(0, 4)}${z}${y.slice(4)}, 오늘 ${td}, 내일 ${tm}`;
    expect(
      scoreScenario("chat_time_calendar", out, {
        calendarReferenceIso: iso,
        calendarTimeZone: "Asia/Seoul",
      }).pass,
    ).toBe(true);
  });
});

describe("scoreScenario chat_time_calendar leaked reasoning", () => {
  it("fails when the correct dates appear only inside a leaked <think> block", () => {
    // 추론 누수 시 사고엔 정답 날짜가 있어도 최종 본문이 틀리면 통과해선 안 된다.
    const iso = "2024-01-15T15:00:00.000Z";
    const triple = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(triple).not.toBeNull();
    const [y, td, tm] = triple!;
    const out = `<think>어제 ${y}, 오늘 ${td}, 내일 ${tm}</think>날짜를 알 수 없습니다.`;
    expect(
      scoreScenario("chat_time_calendar", out, {
        calendarReferenceIso: iso,
        calendarTimeZone: "Asia/Seoul",
      }).pass,
    ).toBe(false);
  });
});

describe("expectedCalendarTriple", () => {
  it("returns yesterday, today, tomorrow YYYY-MM-DD in the given time zone", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const t = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(t).toEqual(["2024-01-15", "2024-01-16", "2024-01-17"]);
  });
});

describe("scoreScenario code_sort_js", () => {
  const okJs = [
    "```js",
    "function partition(a, lo, hi) { return lo; }",
    "function sortNums(arr) { return quicksort(arr); }",
    "function quicksort(a) { return a; }",
    "```",
  ].join("\n");

  it("passes fenced quicksort with sortNums and no .sort(", () => {
    const r = scoreScenario("code_sort_js", okJs);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it("fails when .sort( is used", () => {
    const bad = "```js\nfunction sortNums(a){ return [...a].sort((x,y)=>x-y); }\n```";
    const r = scoreScenario("code_sort_js", bad);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("builtin sort not allowed");
  });

  it("fails when quicksort cues are missing", () => {
    const bad = "```js\nfunction sortNums(a){ const b=[]; for(const x of a)b.push(x); return b;}\n```";
    const r = scoreScenario("code_sort_js", bad);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("missing quicksort cues");
  });

  it("passes when thinking mentions .sort( but fenced code does not", () => {
    const think = "<|channel|>thought\nuse arr.sort((a,b)=>a-b)\n<channel|>\n";
    const r = scoreScenario("code_sort_js", think + okJs);
    expect(r.pass).toBe(true);
  });

  it("passes unfenced code when thinking contains .sort( but stripped body does not", () => {
    const think = "<|channel|>thought\narr.sort() is easy\n<channel|>\n";
    const unfenced = [
      "function partition(a, lo, hi) { return lo; }",
      "function sortNums(arr) { return quicksort(arr); }",
      "function quicksort(a) { return a; }",
    ].join("\n");
    const r = scoreScenario("code_sort_js", think + unfenced);
    expect(r.pass).toBe(true);
  });
});

describe("scoreScenario code_sort_py", () => {
  const okPy = [
    "```python",
    "def partition(arr, lo, hi):",
    "    return lo",
    "def sort_nums(arr):",
    "    return arr",
    "```",
  ].join("\n");

  it("passes fenced quicksort skeleton with def sort_nums", () => {
    const r = scoreScenario("code_sort_py", okPy);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it("fails when sorted() is used", () => {
    const bad = "```python\ndef sort_nums(arr):\n    return sorted(arr)\n```";
    const r = scoreScenario("code_sort_py", bad);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("builtin sort not allowed");
  });

  it("fails when quicksort cues are missing", () => {
    const bad = "```python\ndef sort_nums(arr):\n    return list(arr)\n```";
    const r = scoreScenario("code_sort_py", bad);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("missing quicksort cues");
  });

  it("passes when thinking mentions sorted() but fenced code does not", () => {
    const think = "<|channel|>thought\njust use sorted(arr)\n<channel|>\n";
    const r = scoreScenario("code_sort_py", think + okPy);
    expect(r.pass).toBe(true);
  });
});

describe("scoreScenario structured_action", () => {
  it("passes valid JSON after stripped thinking that contained brace text", () => {
    const think = '<|channel|>thought\n{"action":"wrong","confidence":99}\n<channel|>\n';
    const out = think + '{"action":"submit","confidence":0.75}';
    const r = scoreScenario("structured_action", out);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it("passes without thinking markers", () => {
    expect(scoreScenario("structured_action", '{"action":"x","confidence":0}').pass).toBe(true);
  });

  it("passes a fenced ```json``` block despite the no-fence instruction", () => {
    const out = '```json\n{"action":"submit","confidence":0.9}\n```';
    expect(scoreScenario("structured_action", out).pass).toBe(true);
  });

  it("passes valid JSON wrapped in surrounding prose", () => {
    const out = 'Sure — here it is: {"action":"hold","confidence":0.4} — done.';
    expect(scoreScenario("structured_action", out).pass).toBe(true);
  });

  it("fails when a trailing empty object follows the answer (last balanced wins)", () => {
    const out = '{"action":"hold","confidence":0.4} (note: {})';
    expect(scoreScenario("structured_action", out).pass).toBe(false);
  });

  it("scores the last balanced object when a draft precedes the final JSON", () => {
    const out = '{"action":"draft","confidence":2}\nFinal: {"action":"submit","confidence":0.5}';
    expect(scoreScenario("structured_action", out).pass).toBe(true);
  });

  it("fails when confidence is out of range", () => {
    expect(scoreScenario("structured_action", '{"action":"x","confidence":1.5}').pass).toBe(false);
  });

  it("fails when no JSON object exists", () => {
    expect(scoreScenario("structured_action", "no json here").pass).toBe(false);
  });
});

describe("prompt preview ↔ buildMessages wiring", () => {
  const ctx = {
    publicAssetsOrigin: "http://127.0.0.1:21104",
    referenceAt: new Date("2024-01-15T15:00:00.000Z"),
    calendarTimeZone: "Asia/Seoul",
  };
  const previewOpts = {
    publicAssetBaseUrl: ctx.publicAssetsOrigin,
    referenceIso: ctx.referenceAt.toISOString(),
    calendarTimeZone: ctx.calendarTimeZone,
  };

  function openAiUserText(content: string | OpenAiContentPart[] | null | undefined): string {
    if (typeof content === "string") return content;
    const first = Array.isArray(content) ? content[0] : undefined;
    return first && first.type === "text" ? first.text : "";
  }

  it("openai route: system/user text equals shared preview for every public scenario", () => {
    for (const id of PUBLIC_SCENARIO_IDS) {
      const built = buildMessages(id, ctx);
      expect(built.messages[0]?.content).toBe(getScenarioSystemPromptPreview(id));
      expect(openAiUserText(built.messages[1]?.content)).toBe(
        getScenarioUserPromptPreview(id, previewOpts),
      );
    }
  });

  it("anthropic route: system/user text equals shared preview for every public scenario", () => {
    for (const id of PUBLIC_SCENARIO_IDS) {
      const built = anthropicMessagesForScenario(id, ctx);
      expect(built.system).toBe(getScenarioSystemPromptPreview(id));
      const content = built.messages[0]?.content;
      const text =
        typeof content === "string"
          ? content
          : content?.[0]?.type === "text"
            ? content[0].text
            : "";
      expect(text).toBe(getScenarioUserPromptPreview(id, previewOpts));
    }
  });

  it("injects origin into translate prompt and reference ISO into calendar prompt", () => {
    const translate = buildMessages("translate_nist_fips197_pdf_tools", ctx);
    expect(openAiUserText(translate.messages[1]?.content)).toContain(
      "http://127.0.0.1:21104/nist.fips.197.pdf",
    );
    const calendar = buildMessages("chat_time_calendar", ctx);
    expect(openAiUserText(calendar.messages[1]?.content)).toContain("2024-01-15T15:00:00.000Z");
    expect(openAiUserText(calendar.messages[1]?.content)).toContain("Asia/Seoul");
  });

  it("vision scenarios send [text, image] multipart on both routes", () => {
    for (const id of PUBLIC_SCENARIO_IDS.filter((s) => isVisionScenario(s))) {
      const openai = buildMessages(id, ctx);
      const content = openai.messages[1]?.content;
      expect(Array.isArray(content)).toBe(true);
      expect((content as OpenAiContentPart[])[1]?.type).toBe("image_url");
      const anthropic = anthropicMessagesForScenario(id, ctx);
      const parts = anthropic.messages[0]?.content;
      expect(Array.isArray(parts)).toBe(true);
      expect((parts as { type: string }[])[1]?.type).toBe("image");
    }
  });
});

describe("scoreScenario translate_nist_fips197_pdf_tools", () => {
  const ctx = { invokedBenchTools: ["fetch_pdf_text"] };

  it("passes when raw output is long but stripped final response is short Korean under 1000", () => {
    const think = `<|channel|>thought\n${"x".repeat(980)}\n<channel|>`;
    const resp = "한국어 요약입니다.";
    const raw = think + resp;
    expect(raw.length).toBeGreaterThanOrEqual(1000);
    const r = scoreScenario("translate_nist_fips197_pdf_tools", raw, ctx);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it("fails when stripped response has no Hangul", () => {
    const think = "<|channel|>thought\nreasoning\n<channel|>";
    const raw = think + "English only summary.";
    const r = scoreScenario("translate_nist_fips197_pdf_tools", raw, ctx);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/hangul=false/);
  });

  it("fails when stripped response is 1000+ characters", () => {
    const think = "<|channel|>thought\nx\n<channel|>";
    const raw = think + "가".repeat(1000);
    const r = scoreScenario("translate_nist_fips197_pdf_tools", raw, ctx);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/len=1000/);
  });

  it("fails when fetch_pdf_text was not invoked", () => {
    const r = scoreScenario("translate_nist_fips197_pdf_tools", "한글", {});
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/fetch_pdf_text=false/);
  });
});
