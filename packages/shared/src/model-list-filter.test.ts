import { describe, expect, it } from "vitest";
import { isBenchExcludedModelArtifact } from "./model-list-filter";

describe("isBenchExcludedModelArtifact", () => {
  it("excludes imatrix calibration / bundled imatrix labels", () => {
    expect(isBenchExcludedModelArtifact("qwen3.8-27b@?", "Imatrix Unsloth")).toBe(true);
    expect(isBenchExcludedModelArtifact("imatrix_unsloth", "imatrix_unsloth")).toBe(true);
    expect(isBenchExcludedModelArtifact("foo/imatrix-bar", undefined)).toBe(true);
  });

  it("excludes mmproj vision projectors", () => {
    expect(isBenchExcludedModelArtifact("mmproj-F16", "mmproj F16")).toBe(true);
    expect(isBenchExcludedModelArtifact("unsloth/mmproj-bf16", undefined)).toBe(true);
  });

  it("excludes MTP draft companions (not full checkpoints)", () => {
    expect(isBenchExcludedModelArtifact("qwen3.8-27b@q4_0", "Mtp Qwen3.8 27B")).toBe(true);
    expect(isBenchExcludedModelArtifact("mtp-Qwen3.8-27B-Q4_0", "Mtp Qwen3.8 27B Q4_0")).toBe(true);
    expect(isBenchExcludedModelArtifact("org/mtp-foo-q4_0", "something")).toBe(true);
  });

  it("keeps full models even when series name contains mtp", () => {
    expect(isBenchExcludedModelArtifact("qwen3.6-35b-a3b-mtp@q4_k_m", "Qwen3.6 35B A3B UD")).toBe(
      false,
    );
    expect(
      isBenchExcludedModelArtifact("qwen3.6-35b-a3b-mtp@?", "Qwen3.6 35B A3B MXFP4 MoE"),
    ).toBe(false);
  });

  it("keeps normal UD / MLX chat models", () => {
    expect(isBenchExcludedModelArtifact("qwen3.8-27b@iq1_s", "Qwen3.8 27B UD")).toBe(false);
    expect(isBenchExcludedModelArtifact("qwen/qwen3.8-27b", "Qwen3.8 27B")).toBe(false);
    expect(isBenchExcludedModelArtifact("gemma-4-12b-it@q4_k_xl", "Gemma 4 12B")).toBe(false);
  });

  it("keeps real imatrix-quantized checkpoints (id/label contain but don't start with imatrix) (#159)", () => {
    expect(
      isBenchExcludedModelArtifact("bartowski/Meta-Llama-3-8B-Instruct-imatrix-GGUF", undefined),
    ).toBe(false);
    expect(
      isBenchExcludedModelArtifact(
        "Nexesenex/Llama-3-8B-imatrix-IQ4_XS",
        "Llama 3 8B imatrix IQ4_XS",
      ),
    ).toBe(false);
    expect(isBenchExcludedModelArtifact("qwen2.5-7b-instruct-imatrix-iq4_xs", undefined)).toBe(
      false,
    );
  });

  it("keeps full checkpoints whose label ends with MTP but doesn't start with it (#159)", () => {
    expect(isBenchExcludedModelArtifact("qwen3.6-35b-a3b-mtp", "Qwen3.6 35B A3B MTP")).toBe(false);
    expect(
      isBenchExcludedModelArtifact("org/qwen3.6-35b-a3b-mtp", "Qwen3.6 MTP 35B A3B"),
    ).toBe(false);
  });

  it("excludes real MTP drafts that id/label rules miss, via the arch signal (#159 실측)", () => {
    // 실측(LM Studio, 로컬 카탈로그 38건): 진짜 27B 본체(16GB)와 나란히 떠 있는 이 두 항목은
    // 266~478MB인데 params_string은 "27B"로 본체를 사칭 — id에 `-mtp@`가 있어 기존
    // "본체크포인트 예외"에 걸려 id/label 규칙만으로는 계속 keep됐다.
    expect(isBenchExcludedModelArtifact("qwen3.8-27b-mtp@8bit", "Qwen3.8 27B MTP", "qwen3_5_mtp")).toBe(
      true,
    );
    expect(isBenchExcludedModelArtifact("qwen3.8-27b-mtp@4bit", "Qwen3.8 27B MTP", "qwen3_5_mtp")).toBe(
      true,
    );
  });

  it("excludes gemma MTP drafts via the -assistant arch suffix (#159 이슈 코멘트)", () => {
    expect(
      isBenchExcludedModelArtifact("qwen3.8-27b@q4_0", "Mtp Gemma 4 26B A4B Instruct", "gemma4-assistant"),
    ).toBe(true);
  });

  it("arch signal is an end-anchor only — a model literally named 'assistant' is not excluded", () => {
    expect(isBenchExcludedModelArtifact("some/my-assistant-model", "My Assistant Model", "llama")).toBe(
      false,
    );
  });

  it("real full checkpoints stay kept when arch is a plain family name or absent (no regression)", () => {
    // #159 코멘트: 정상 모델의 arch 는 전부 맨 패밀리명 — qwen3.8-27b@q4_0(label "Mtp Qwen3.8 27B")의
    // arch 는 평범한 qwen35 다(label 선두 토큰 규칙으로 이미 제외되지만, arch 신호도 오탐 안 시켜야 함).
    expect(isBenchExcludedModelArtifact("qwen3.6-35b-a3b-mtp@q4_k_m", "Qwen3.6 35B A3B UD", "qwen35moe")).toBe(
      false,
    );
    expect(isBenchExcludedModelArtifact("qwen/qwen3.8-27b", "Qwen3.8 27B", "qwen3_5")).toBe(false);
    // arch 를 안 주는 백엔드(Ollama·openai_compatible)는 undefined — 필요조건이 아니므로 통과.
    expect(isBenchExcludedModelArtifact("qwen/qwen3.8-27b", "Qwen3.8 27B", undefined)).toBe(false);
  });
});
