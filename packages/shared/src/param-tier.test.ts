import { describe, expect, it } from "vitest";
import {
  extractParamsBillionsFromModelId,
  inferParamTier,
  parseParamsBillions,
  paramTierFromBillions,
} from "./param-tier";

describe("parseParamsBillions", () => {
  const cases: Array<[string, number | null]> = [
    ["7B", 7],
    ["30B-A3B", 30], // MoE 총 파라미터만(active-B 접미사는 무시)
    ["1.2b", 1.2],
    ["270m", 0.27],
    ["0.5B", 0.5],
    ["", null],
    ["garbage", null],
    ["8x7B", null], // 구형 NxM MoE 표기 — 의도적 미지원
    ["500k", null], // k(천) 단위 미지원 — 컨텍스트 길이 태그(4k/8k/128k 등)와의 혼동을 피하기 위한 의도적 결정
  ];
  it.each(cases)("%s → %s", (input, expected) => {
    const result = parseParamsBillions(input);
    if (expected == null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 10);
  });
});

describe("extractParamsBillionsFromModelId", () => {
  const cases: Array<[string, number | null]> = [
    ["llama3:8b", 8],
    ["qwen2.5:0.5b", 0.5],
    ["functiongemma:270m", 0.27],
    ["gpt-oss-120b", 120],
    ["nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16", 30],
    ["gemma-4-e2b-it", null], // 구글식 유효 파라미터 명명(e2b) — 알려진 미지원
    ["mixtral-8x7b", null], // 구형 NxM MoE 표기 — 알려진 미지원
    ["some-random-model", null],
    ["", null],
    // 크기가 단어(mini/small/medium)라 숫자 크기 태그가 없는 모델 — 컨텍스트 길이(k)를
    // 파라미터 수로 오인식하지 않고 null(미분류)을 반환해야 한다.
    ["microsoft/Phi-3-medium-128k-instruct", null],
    ["microsoft/Phi-3-medium-4k-instruct", null],
    ["microsoft/Phi-3-small-8k-instruct", null],
    // InternLM2.5류 — 소수점 대신 밑줄(`1_8b`)을 쓰는 크기 표기. 버전 번호의 밑줄(`2_5`)은
    // 뒤에 단위가 바로 붙지 않아 영향받지 않는다.
    ["internlm2_5-1_8b-chat", 1.8],
    ["internlm/internlm2-chat-1_8b", 1.8],
    // 점 버전(4.0)이 실제 크기 태그(1.2b) 바로 앞에 오는 조합 — 버전 숫자는 단위가 없어 걸러진다.
    ["hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M", 1.2],
    ["exaone4.0:1.2b", 1.2],
    // MoE + 점 버전 + 양자화 태그가 한 id에 섞인 조합 — 총 파라미터(35)만 선택되어야 한다.
    ["qwen3.6-35b-a3b@q4_k_m", 35],
    // 벤더 실명(M2.7)이 크기 태그처럼 보이지만 숫자로 시작하지 않아 걸러진다 — unknown 등급.
    ["MiniMax-M2.7", null],
    ["unsloth/MiniMax-M2.7-GGUF", null],
  ];
  it.each(cases)("%s → %s", (id, expected) => {
    const result = extractParamsBillionsFromModelId(id);
    if (expected == null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 10);
  });
});

describe("paramTierFromBillions", () => {
  it("경계값 포함 하한: 4→tiny, 4.01→small", () => {
    expect(paramTierFromBillions(4)).toBe("tiny");
    expect(paramTierFromBillions(4.01)).toBe("small");
  });
  it("경계값: 40→small, 40.01→medium", () => {
    expect(paramTierFromBillions(40)).toBe("small");
    expect(paramTierFromBillions(40.01)).toBe("medium");
  });
  it("경계값: 150→medium, 150.01→large", () => {
    expect(paramTierFromBillions(150)).toBe("medium");
    expect(paramTierFromBillions(150.01)).toBe("large");
  });
  it("0 이하도 tiny", () => {
    expect(paramTierFromBillions(0)).toBe("tiny");
  });
});

describe("inferParamTier", () => {
  it("paramsString이 유효하면 상충하는 modelId보다 우선", () => {
    expect(inferParamTier({ modelId: "some-70b-model", paramsString: "8B" })).toBe("small");
  });
  it("paramsString이 없으면 modelId로 폴백", () => {
    expect(inferParamTier({ modelId: "llama3:8b" })).toBe("small");
  });
  it("paramsString이 파싱 불가하면 modelId로 폴백", () => {
    expect(inferParamTier({ modelId: "llama3:8b", paramsString: "garbage" })).toBe("small");
  });
  it("paramsString이 빈 문자열이면 modelId로 폴백", () => {
    expect(inferParamTier({ modelId: "llama3:8b", paramsString: "" })).toBe("small");
  });
  it("paramsString이 공백뿐이면 modelId로 폴백", () => {
    expect(inferParamTier({ modelId: "llama3:8b", paramsString: "   " })).toBe("small");
  });
  it("둘 다 판별 불가하면 null", () => {
    expect(inferParamTier({ modelId: "some-random-model" })).toBeNull();
    expect(inferParamTier({ modelId: "", paramsString: "" })).toBeNull();
  });
});
