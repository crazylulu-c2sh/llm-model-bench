import { describe, expect, test } from "vitest";
import { resolveDefaultBaseUrlFilter } from "./StatsModelTable";

describe("resolveDefaultBaseUrlFilter", () => {
  const options = ["http://127.0.0.1:1234", "http://192.168.1.10:1234"];

  test("옵션에 있으면 정규화된 URL을 반환한다", () => {
    expect(resolveDefaultBaseUrlFilter(options, "http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234",
    );
  });

  test("트레일링 슬래시는 정규화 후 매칭한다", () => {
    expect(resolveDefaultBaseUrlFilter(options, "http://127.0.0.1:1234/")).toBe(
      "http://127.0.0.1:1234",
    );
  });

  test("옵션에 없으면 빈 문자열(전체)", () => {
    expect(resolveDefaultBaseUrlFilter(options, "http://10.0.0.1:8080")).toBe("");
  });

  test("preferred가 비어 있으면 빈 문자열", () => {
    expect(resolveDefaultBaseUrlFilter(options, "")).toBe("");
    expect(resolveDefaultBaseUrlFilter(options, "   ")).toBe("");
    expect(resolveDefaultBaseUrlFilter(options, null)).toBe("");
    expect(resolveDefaultBaseUrlFilter(options, undefined)).toBe("");
  });

  test("옵션이 비어 있으면 매칭 불가 → 전체", () => {
    expect(resolveDefaultBaseUrlFilter([], "http://127.0.0.1:1234")).toBe("");
  });
});
