import { describe, expect, test } from "vitest";
import { scanHardcodedKoreanFiles } from "./korean-scan";
import { KNOWN_PENDING } from "./korean-pending";

// 마이그레이션 완전성 래칫. apps/web/src의 문자열 리터럴·템플릿·JSX 텍스트에서 한국어를 스캔하고
// (주석 제외), 아직 마이그레이션되지 않은 파일 목록(KNOWN_PENDING)과 정확히 일치하는지 검사한다.
// - 목록 밖 파일에 한국어가 새로 생기면 실패(회귀 가드).
// - 목록 안 파일에서 한국어가 사라졌는데 목록에 남아 있으면 실패(축소 강제).
// ko 카탈로그·로케일별 콘텐츠 모듈·테스트는 스캐너가 영구 제외. 개별 예외는 `// i18n-ignore-next-line`.
describe("i18n 하드코딩 한국어 래칫", () => {
  test("현재 위반 파일 집합 = KNOWN_PENDING (정확히 일치)", () => {
    const current = new Set(scanHardcodedKoreanFiles());
    const pending = new Set(KNOWN_PENDING);

    const regressions = [...current].filter((f) => !pending.has(f)).sort();
    const migrated = [...pending].filter((f) => !current.has(f)).sort();

    expect(
      { regressions, migrated },
      [
        regressions.length
          ? `하드코딩 한국어가 새로 생긴 파일(t()로 추출 필요):\n  - ${regressions.join("\n  - ")}`
          : "",
        migrated.length
          ? `한국어가 사라진 파일 — korean-pending.ts에서 제거하세요:\n  - ${migrated.join("\n  - ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ).toEqual({ regressions: [], migrated: [] });
  });
});
