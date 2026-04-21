import { describe, expect, it } from "vitest";
import { partitionThinkingBlocks, stripThinkingBlocks } from "./llm-profiles";

describe("partitionThinkingBlocks", () => {
  it("returns full text as response when no thinking markers", () => {
    const raw = "Hello world\n한글만";
    expect(partitionThinkingBlocks(raw)).toEqual({ thinking: "", response: raw });
  });

  it("strips Qwen-style think block into thinking + response", () => {
    const think = "<|think|>step one<|end_of_thought|>";
    const resp = "final answer";
    const raw = `${think}${resp}`;
    expect(partitionThinkingBlocks(raw)).toEqual({ thinking: think, response: resp });
  });

  it("handles redacted_thinking … </think> wrapper (matches stripThinkingBlocks)", () => {
    const think = ["<", "redacted", "_", "thinking", ">", "internal", "</", "think", ">"].join("");
    const raw = `${think}visible`;
    expect(partitionThinkingBlocks(raw)).toEqual({ thinking: think, response: "visible" });
  });

  it("handles LM Studio channel variant <|channel>thought … <channel|>", () => {
    const think = "<|channel>thought\nreasoning here\n<channel|>";
    const resp = "AES는 미국 국립표준기술연구소에서";
    const raw = `${think}${resp}`;
    expect(partitionThinkingBlocks(raw)).toEqual({ thinking: think, response: resp });
  });

  it("handles <|channel|>thought … <channel|>", () => {
    const think = "<|channel|>thought\nx\n<channel|>";
    const raw = `${think}out`;
    expect(partitionThinkingBlocks(raw)).toEqual({ thinking: think, response: "out" });
  });

  it("stripThinkingBlocks matches partition response for single block", () => {
    const raw = "<|think|>a<|end|>b";
    const { response } = partitionThinkingBlocks(raw);
    expect(stripThinkingBlocks(raw)).toBe(response);
  });
});
