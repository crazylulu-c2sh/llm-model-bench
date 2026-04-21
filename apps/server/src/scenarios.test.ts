import { describe, expect, it } from "vitest";
import { expectedCalendarTriple, scoreScenario } from "./scenarios.js";

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
});
