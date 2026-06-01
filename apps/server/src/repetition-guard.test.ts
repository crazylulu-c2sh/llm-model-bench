import { describe, expect, it } from "vitest";
import { detectRepetitionLoop } from "./repetition-guard.js";

describe("detectRepetitionLoop — positives", () => {
  it("flags a sentence repeated as a trailing block", () => {
    const text = "Intro line.\n" + "All work and no play makes Jack a dull boy. ".repeat(40);
    expect(detectRepetitionLoop(text).looping).toBe(true);
  });

  it("flags a single character degenerate run", () => {
    const text = "Here is the answer: " + "a".repeat(700);
    expect(detectRepetitionLoop(text).looping).toBe(true);
  });

  it("flags the same line echoed many times", () => {
    const line = "동일한 문장을 계속해서 반복적으로 출력하고 있습니다.";
    const text =
      "어제·오늘·내일 안내드립니다. 아래를 참고하세요. 추가 설명이 더 있습니다.\n" +
      Array.from({ length: 30 }, () => line).join("\n");
    expect(text.length).toBeGreaterThan(600);
    expect(detectRepetitionLoop(text).looping).toBe(true);
  });
});

describe("detectRepetitionLoop — negatives (must not fire)", () => {
  it("ignores short calendar output with three overlapping dates", () => {
    const text = "어제는 2026-05-31, 오늘은 2026-06-01, 내일은 2026-06-02입니다.";
    expect(detectRepetitionLoop(text).looping).toBe(false);
  });

  it("ignores normal long prose without runaway repetition", () => {
    const text =
      "Quicksort partitions the array around a pivot and recurses on each side. " +
      "It performs well on average but degrades on already-sorted input unless the pivot is chosen carefully. " +
      "A common mitigation is median-of-three pivot selection, which reduces the chance of worst-case behavior. " +
      "In practice, hybrid schemes switch to insertion sort for small subarrays to cut constant overhead. " +
      "This keeps the implementation both readable and efficient across a wide range of inputs in real workloads. " +
      "The partition step itself is the part most worth getting right, since an off-by-one there silently corrupts order. " +
      "Tail-call elimination on the larger side bounds stack depth, a detail that matters for very large arrays in production.";
    expect(text.length).toBeGreaterThan(600);
    expect(detectRepetitionLoop(text).looping).toBe(false);
  });

  it("ignores a varied numbered list (distinct lines)", () => {
    const text =
      "다음은 단계별 안내입니다. 각 항목은 서로 다른 내용을 담고 있어 반복이 아닙니다.\n" +
      Array.from({ length: 12 }, (_, i) => `${i + 1}. 단계 ${i + 1}: 서로 다른 설명이 들어가는 항목입니다.`).join("\n");
    expect(detectRepetitionLoop(text).looping).toBe(false);
  });

  it("ignores empty / tiny input", () => {
    expect(detectRepetitionLoop("").looping).toBe(false);
    expect(detectRepetitionLoop("2026-06-01").looping).toBe(false);
  });
});
