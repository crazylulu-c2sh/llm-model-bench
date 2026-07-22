import { afterEach, describe, expect, test } from "vitest";
import { getLocale, isLocale, LOCALE_ENDONYMS, LOCALES, msg, setLocale } from "./index";
import { MESSAGES, type Messages } from "./messages";

afterEach(() => setLocale("ko")); // 모듈 전역 상태 초기화

describe("locale 스토어", () => {
  test("node env(window 없음) 기본 로케일은 ko", () => {
    expect(getLocale()).toBe("ko");
    expect(msg()).toBe(MESSAGES.ko);
  });

  test("isLocale는 ko/en/ja만 통과", () => {
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  test("setLocale은 현재 로케일과 msg()를 전환한다", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(msg()).toBe(MESSAGES.en);
    setLocale("ja");
    expect(msg()).toBe(MESSAGES.ja);
  });

  test("LOCALES와 엔도님은 3개 로케일을 모두 덮는다", () => {
    expect([...LOCALES]).toEqual(["ko", "en", "ja"]);
    for (const l of LOCALES) expect(LOCALE_ENDONYMS[l]).toBeTruthy();
    expect(LOCALE_ENDONYMS.ko).toBe("한국어");
    expect(LOCALE_ENDONYMS.ja).toBe("日本語");
  });
});

describe("메시지 카탈로그 패리티", () => {
  // ko의 키 구조를 재귀적으로 수집(함수는 리프로 취급).
  function shape(obj: unknown, prefix = ""): string[] {
    if (typeof obj !== "object" || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>)
      .flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k))
      .sort();
  }

  const koShape = shape(MESSAGES.ko);

  for (const locale of ["en", "ja"] as const) {
    test(`${locale} 키 구조가 ko와 정확히 일치`, () => {
      expect(shape(MESSAGES[locale])).toEqual(koShape);
    });

    test(`${locale}: 함수 메시지는 ko와 동일 위치에서 함수`, () => {
      const koFns = collectFns(MESSAGES.ko);
      const locFns = collectFns(MESSAGES[locale]);
      expect(locFns).toEqual(koFns);
    });
  }

  function collectFns(obj: unknown, prefix = ""): string[] {
    if (typeof obj === "function") return [prefix];
    if (typeof obj !== "object" || obj === null) return [];
    return Object.entries(obj as Record<string, unknown>)
      .flatMap(([k, v]) => collectFns(v, prefix ? `${prefix}.${k}` : k))
      .sort();
  }
});

describe("보간(함수 메시지)", () => {
  test("header.benchProgress는 3로케일에서 인자를 반영", () => {
    const call = (m: Messages) => m.header.benchProgress(3, 12, 25);
    expect(call(MESSAGES.ko)).toContain("3/12");
    expect(call(MESSAGES.ko)).toContain("25%");
    expect(call(MESSAGES.en)).toContain("3/12");
    expect(call(MESSAGES.en)).toContain("25%");
    expect(call(MESSAGES.ja)).toContain("3/12");
    expect(call(MESSAGES.ja)).toContain("25%");
  });
});
