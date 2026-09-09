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
});
