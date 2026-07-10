import { describe, expect, it } from "vitest";
import {
  cleanModelDisplayName,
  inferModelVendor,
  parseModelQuant,
  type VendorKey,
} from "./model-vendor";

describe("inferModelVendor", () => {
  const cases: Array<[string, VendorKey]> = [
    ["gemma-4-e2b-it", "google"],
    ["google/gemma-4-12b-qat", "google"],
    ["functiongemma:270m", "google"],
    ["unsloth/gemma-4-12b-it-qat", "google"],
    ["qwen2.5-coder-32b-instruct", "alibaba"],
    ["qwen/qwen3-coder-next", "alibaba"],
    ["qwen3.6-35b-a3b@q4_k_m", "alibaba"],
    ["qwen2.5:0.5b", "alibaba"],
    ["Qwen/Qwen3-8B", "alibaba"],
    ["meta-llama-3.1-8b-instruct", "meta"],
    ["llama3:8b", "meta"],
    ["tinyllama", "meta"],
    ["deepseek-coder-6.7b-base", "deepseek"],
    ["nvidia/nemotron-3-nano-omni", "nvidia"],
    ["nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16", "nvidia"],
    ["openai/gpt-oss-20b", "openai"],
    ["gpt-oss-120b", "openai"],
    ["minimax-m2.7@iq2_m", "minimax"],
    ["MiniMax-M2.7", "minimax"],
    ["unsloth/MiniMax-M2.7-GGUF", "minimax"],
    ["glm-4.7-flash", "zhipu"],
    ["exaone4.0:1.2b", "lg"],
    ["hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M", "lg"],
    ["phi-4-mini", "microsoft"],
    ["mistral-small-3.2", "mistral"],
    ["ministral-8b", "mistral"],
    ["some-random-model", "unknown"],
    ["", "unknown"],
  ];
  it.each(cases)("%s → %s", (id, vendor) => {
    expect(inferModelVendor(id)).toBe(vendor);
  });
});

describe("cleanModelDisplayName", () => {
  const cases: Array<[string, string]> = [
    ["gemma-4-e2b-it", "gemma-4-e2b-it"],
    ["google/gemma-4-12b-qat", "gemma-4-12b-qat"],
    ["functiongemma:270m", "functiongemma:270m"], // 270m = size, 보존
    ["unsloth/gemma-4-12b-it-qat", "gemma-4-12b-it-qat"],
    ["qwen2.5-coder-32b-instruct", "qwen2.5-coder-32b-instruct"],
    ["qwen/qwen3-coder-next", "qwen3-coder-next"],
    ["qwen3.6-35b-a3b@q4_k_m", "qwen3.6-35b-a3b"],
    ["qwen2.5:0.5b", "qwen2.5:0.5b"], // size 보존
    ["Qwen/Qwen3-8B", "Qwen3-8B"], // 대소문자 보존
    ["meta-llama-3.1-8b-instruct", "meta-llama-3.1-8b-instruct"],
    ["llama3:8b", "llama3:8b"],
    ["deepseek-coder-6.7b-base", "deepseek-coder-6.7b-base"],
    ["nvidia/nemotron-3-nano-omni", "nemotron-3-nano-omni"],
    ["nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16", "Nemotron-3-Nano-Omni-30B-A3B-Reasoning"],
    ["openai/gpt-oss-20b", "gpt-oss-20b"],
    ["minimax-m2.7@iq2_m", "minimax-m2.7"],
    ["MiniMax-M2.7", "MiniMax-M2.7"],
    ["unsloth/MiniMax-M2.7-GGUF", "MiniMax-M2.7"],
    ["glm-4.7-flash", "glm-4.7-flash"],
    ["exaone4.0:1.2b", "exaone4.0:1.2b"],
    ["hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M", "EXAONE-4.0-1.2B"],
  ];
  it.each(cases)("%s → %s", (id, expected) => {
    expect(cleanModelDisplayName(id)).toBe(expected);
  });
});

describe("parseModelQuant", () => {
  const cases: Array<[string, string | null]> = [
    ["qwen3.6-35b-a3b@q4_k_m", "q4_k_m"],
    ["gemma-4-12b-it@q4_k_xl", "q4_k_xl"],
    ["minimax-m2.7@iq2_m", "iq2_m"],
    ["qwen3.6-27b-mtp@q8_0", "q8_0"],
    ["hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M", "Q4_K_M"],
    ["unsloth/MiniMax-M2.7-GGUF", "GGUF"],
    ["nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16", "BF16"],
    ["qwen2.5:0.5b", null], // size
    ["llama3:8b", null], // size
    ["functiongemma:270m", null], // size
    ["MiniMax-M2.7", null],
    ["gemma-4-e2b-it", null],
  ];
  it.each(cases)("%s → %s", (id, expected) => {
    expect(parseModelQuant(id)).toBe(expected);
  });
});
