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
});

describe("expectedCalendarTriple", () => {
  it("returns yesterday, today, tomorrow YYYY-MM-DD in the given time zone", () => {
    const iso = "2024-01-15T15:00:00.000Z";
    const t = expectedCalendarTriple(iso, "Asia/Seoul");
    expect(t).toEqual(["2024-01-15", "2024-01-16", "2024-01-17"]);
  });
});
