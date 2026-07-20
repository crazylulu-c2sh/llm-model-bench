import { describe, expect, it } from "vitest";
import {
  extractFirstJsonObject,
  normalizeProduct,
  normalizeQuarter,
  parseSignedPercent,
} from "./normalize.js";

describe("extractFirstJsonObject", () => {
  it("extracts JSON from a fenced ```json``` block", () => {
    const out = extractFirstJsonObject('intro\n```json\n{"a":1}\n```\ntail');
    expect(out).toBe('{"a":1}');
  });

  it("returns last balanced object when multiple are present", () => {
    const out = extractFirstJsonObject('first {"a":1} then {"b":2} last');
    expect(out).toBe('{"b":2}');
  });

  it("returns null when no object exists", () => {
    expect(extractFirstJsonObject("no object here")).toBeNull();
  });

  it("ignores braces inside strings", () => {
    const out = extractFirstJsonObject('{"text":"} brace inside"}');
    expect(out).toBe('{"text":"} brace inside"}');
  });

  // #105: 중첩 객체에서 안쪽이 아니라 **바깥(top-level)** 객체를 돌려줘야 한다.
  // 예전 구현은 모든 `{` 를 후보로 삼아 마지막 안쪽 객체를 반환했다.
  it("returns the OUTER object for nested JSON (not the innermost)", () => {
    const raw = '{"answers":[{"id":"a","fact":"A"},{"id":"b","fact":"B"}]}';
    expect(extractFirstJsonObject(raw)).toBe(raw);
  });

  it("returns the OUTER object for nested JSON even inside prose", () => {
    const obj = '{"documents":[{"id":"doc_kestrel","key_fact":"Halcyon"}],"summary":"s"}';
    expect(extractFirstJsonObject(`intro ${obj} tail`)).toBe(obj);
  });

  it("still prefers the last of several top-level objects (regression)", () => {
    const out = extractFirstJsonObject('{"a":{"n":1}} then {"b":{"n":2}}');
    expect(out).toBe('{"b":{"n":2}}');
  });

  it("skips an unterminated `{` and finds the later complete object", () => {
    const out = extractFirstJsonObject('broken { oops\nthen {"ok":{"deep":1}}');
    expect(out).toBe('{"ok":{"deep":1}}');
  });

  it("fenced block with nested JSON returns the outer object", () => {
    const obj = '{"answers":[{"id":"rec_1","fact":"F"}]}';
    expect(extractFirstJsonObject('```json\n' + obj + '\n```')).toBe(obj);
  });
});

describe("normalizeQuarter", () => {
  it.each([
    ["Q2 2024", "Q2 2024"],
    ["q2 2024", "Q2 2024"],
    ["Q2'24", "Q2 2024"],
    ["2024 Q2", "Q2 2024"],
    ["Q2-2024", "Q2 2024"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeQuarter(input)).toBe(expected);
  });

  it("returns null for invalid quarter", () => {
    expect(normalizeQuarter("Q5 2024")).toBeNull();
    expect(normalizeQuarter("")).toBeNull();
    expect(normalizeQuarter("invalid")).toBeNull();
  });
});

describe("normalizeProduct", () => {
  it("uppercases single letters", () => {
    expect(normalizeProduct("c")).toBe("C");
    expect(normalizeProduct(" c ")).toBe("C");
  });
});

describe("parseSignedPercent", () => {
  it.each<[string | number, number]>([
    ["+20.7%", 20.7],
    ["20.7", 20.7],
    [" 20.7 ", 20.7],
    ["-12.3%", -12.3],
    ["2,373.9", 2373.9],
    ["$2,373.9", 2373.9],
    [20.7, 20.7],
  ])("parses %p to %p", (input, expected) => {
    expect(parseSignedPercent(input)).toBe(expected);
  });

  it("returns null for non-numeric", () => {
    expect(parseSignedPercent("abc")).toBeNull();
    expect(parseSignedPercent(null)).toBeNull();
    expect(parseSignedPercent(undefined)).toBeNull();
  });
});
