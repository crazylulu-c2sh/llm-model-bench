import { describe, expect, it } from "vitest";
import {
  LLM_PROFILE_DEFINITIONS,
  inferLlmProfileFamily,
  resolveBenchProfile,
} from "./llm-profiles.js";

describe("inferLlmProfileFamily — Qwen 정확 매칭", () => {
  it.each([
    ["Qwen/Qwen3.8-27B", "qwen38"],
    ["unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "qwen38"],
    ["qwen3.8:27b", "qwen38"],
    ["Qwen/Qwen3.8-2.4T-A95B", "qwen38"],
    ["Qwen/Qwen3.6-35B-A3B", "qwen36"],
    ["Qwen/Qwen3.5-35B-A3B", "qwen35"],
  ])("%s → %s", (modelId, family) => {
    expect(inferLlmProfileFamily(modelId)).toBe(family);
  });
});

describe("inferLlmProfileFamily — 미등록 Qwen 신버전 폴백", () => {
  it.each([
    "Qwen/Qwen3.9-27B",
    "Qwen4-30B-A3B",
    "qwen4:30b",
    "unsloth/Qwen4.1-Coder-GGUF",
    "Qwen9-Max",
  ])("%s → qwen38로 폴백", (modelId) => {
    expect(inferLlmProfileFamily(modelId)).toBe("qwen38");
  });

  // 파라미터 수(대시 뒤 숫자)나 구버전을 버전 표기로 오인하면 안 된다.
  it.each(["Qwen/Qwen3-8B", "Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen-7B", "Qwen/Qwen-72B"])(
    "%s → unknown 유지",
    (modelId) => {
      expect(inferLlmProfileFamily(modelId)).toBe("unknown");
    },
  );

  it("폴백 경유 모델도 qwen38 정의와 동일한 해석을 받는다", () => {
    const viaFallback = resolveBenchProfile({
      modelId: "Qwen4-30B-A3B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    const direct = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(viaFallback.family).toBe("qwen38");
    expect(viaFallback.preset).toBe(direct.preset);
    expect(viaFallback.sampling).toEqual(direct.sampling);
    expect(viaFallback.extraBody).toEqual(direct.extraBody);
    expect(viaFallback.stopSequences).toEqual(direct.stopSequences);
    expect(viaFallback.maxTokensRecommended).toBe(direct.maxTokensRecommended);
  });
});

describe("fallbackMatch 유지보수 가드", () => {
  // 한 계보에서 fallbackMatch를 갖는 정의는 "최신" 하나뿐이어야 한다.
  // qwen39를 추가하면서 qwen38에서 옮기지 않으면 여기서 실패한다.
  it("폴백을 보유한 정의 목록이 고정되어 있다", () => {
    const owners = LLM_PROFILE_DEFINITIONS.filter((d) => d.fallbackMatch?.length).map((d) => d.id);
    expect(owners).toEqual(["qwen38"]);
  });

  it("폴백 보유 정의가 같은 계보의 다른 정의보다 배열에서 앞선다", () => {
    const ids = LLM_PROFILE_DEFINITIONS.map((d) => d.id);
    expect(ids.indexOf("qwen38")).toBeLessThan(ids.indexOf("qwen36"));
    expect(ids.indexOf("qwen38")).toBeLessThan(ids.indexOf("qwen35"));
  });
});
