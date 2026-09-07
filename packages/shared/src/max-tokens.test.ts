import { describe, expect, it } from "vitest";
import { resolveEffectiveMaxTokens } from "./max-tokens";

/** 기본값만 있는 최소 입력 — 각 테스트가 필요한 소스만 덧붙인다. */
const base = { profileRecommended: 4096 } as const;

describe("resolveEffectiveMaxTokens: 우선순위", () => {
  it("요청 명시값이 최우선", () => {
    expect(
      resolveEffectiveMaxTokens({
        ...base,
        requestMaxTokens: 293,
        profileMaxTokens: 2048,
        scenarioMaxTokens: 640,
        visionFloor: 2048,
      }),
    ).toEqual({ value: 293, source: "request" });
  });

  it("요청이 없으면 프로필 명시값", () => {
    expect(
      resolveEffectiveMaxTokens({ ...base, profileMaxTokens: 2048, scenarioMaxTokens: 640 }),
    ).toEqual({ value: 2048, source: "profile" });
  });

  it("요청·프로필이 없으면 시나리오 sampling 이 권장값보다 우선", () => {
    // agent 경로(`def.sampling?.max_tokens ?? args.maxTokens`)와 같은 의미.
    // max() 안에 넣으면 권장값이 더 클 때 시나리오 의도가 조용히 무시된다.
    expect(
      resolveEffectiveMaxTokens({ profileRecommended: 4096, scenarioMaxTokens: 640 }),
    ).toEqual({ value: 640, source: "scenario" });
    expect(
      resolveEffectiveMaxTokens({ ...base, scenarioMaxTokens: 640, visionFloor: 8192 }),
    ).toEqual({ value: 640, source: "scenario" });
  });

  it("아무 명시도 없으면 vision floor 와 권장값 중 큰 쪽", () => {
    expect(resolveEffectiveMaxTokens({ ...base, visionFloor: 8192 })).toEqual({
      value: 8192,
      source: "vision",
    });
    expect(resolveEffectiveMaxTokens({ profileRecommended: 4096, visionFloor: 2048 })).toEqual({
      value: 4096,
      source: "recommended",
    });
    expect(resolveEffectiveMaxTokens(base)).toEqual({ value: 4096, source: "recommended" });
  });

  it("동률이면 구체적인 쪽(vision > 권장값)이 이긴다", () => {
    expect(
      resolveEffectiveMaxTokens({ profileRecommended: 2048, visionFloor: 2048 }),
    ).toEqual({ value: 2048, source: "vision" });
  });
});

describe("resolveEffectiveMaxTokens: #174 회귀 케이스", () => {
  it("요청 293이 프로필 권장값 131072에 삼켜지지 않는다", () => {
    // qwen38 의 recommendedMaxTokens.default = 131_072 — 사실상 상한 없음이던 경로.
    expect(
      resolveEffectiveMaxTokens({ requestMaxTokens: 293, profileRecommended: 131_072 }),
    ).toEqual({ value: 293, source: "request" });
  });

  it("명시 상한이 vision floor보다 작아도 명시값이 이긴다", () => {
    // 결정 사항: 조용히 부풀리느니 잘리게 두고 truncated_at_max_tokens 라벨로 드러낸다.
    expect(
      resolveEffectiveMaxTokens({ requestMaxTokens: 20, visionFloor: 2048, profileRecommended: 4096 }),
    ).toEqual({ value: 20, source: "request" });
  });

  it("비-agent 시나리오의 sampling.max_tokens 가 권장값보다 우선 적용된다", () => {
    // 권장값이 더 커도 시나리오 의도가 이긴다 — 예전엔 통째로 무시됐다.
    expect(
      resolveEffectiveMaxTokens({ scenarioMaxTokens: 640, profileRecommended: 131_072 }),
    ).toEqual({ value: 640, source: "scenario" });
  });
});

describe("resolveEffectiveMaxTokens: 무효 입력", () => {
  it("0·음수·NaN·null 은 미지정과 같게 취급", () => {
    for (const bad of [0, -1, Number.NaN, null, undefined]) {
      expect(
        resolveEffectiveMaxTokens({ ...base, requestMaxTokens: bad as number | null }),
      ).toEqual({ value: 4096, source: "recommended" });
    }
  });

  it("소수는 내림", () => {
    expect(resolveEffectiveMaxTokens({ ...base, requestMaxTokens: 293.9 })).toEqual({
      value: 293,
      source: "request",
    });
  });

  it("전부 미지정이면 하네스 기본값 512로 막는다", () => {
    expect(resolveEffectiveMaxTokens({ profileRecommended: 0 })).toEqual({
      value: 512,
      source: "recommended",
    });
  });
});
