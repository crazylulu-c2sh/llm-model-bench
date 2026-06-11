import { describe, expect, it } from "vitest";
import { compareModelBenchQueueOrder, compareModelIdAlphanumeric } from "./model-sort";

describe("compareModelBenchQueueOrder", () => {
  const queue = ["model-b", "model-a", "model-c"];

  it("큐에 있는 ID는 큐 순서를 따른다", () => {
    expect(compareModelBenchQueueOrder("model-b", "model-a", queue)).toBeLessThan(0);
    expect(compareModelBenchQueueOrder("model-a", "model-c", queue)).toBeLessThan(0);
    expect(compareModelBenchQueueOrder("model-c", "model-b", queue)).toBeGreaterThan(0);
  });

  it("큐에 있는 ID가 큐 밖 ID보다 앞선다", () => {
    expect(compareModelBenchQueueOrder("model-a", "model-z", queue)).toBeLessThan(0);
    expect(compareModelBenchQueueOrder("model-z", "model-a", queue)).toBeGreaterThan(0);
  });

  it("둘 다 큐에 없으면 alphanumeric 폴백", () => {
    expect(compareModelBenchQueueOrder("x-2", "x-10", [])).toBe(
      compareModelIdAlphanumeric("x-2", "x-10"),
    );
  });
});
