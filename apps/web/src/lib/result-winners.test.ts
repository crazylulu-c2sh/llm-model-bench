import { describe, expect, it } from "vitest";
import { computeGroupWinners, type WinnerInput } from "./result-winners";

function row(p: Partial<WinnerInput> & { rowKey: string; model_id: string }): WinnerInput {
  return {
    scenario: "s1",
    api: "chat_completions",
    ttft_ms: null,
    tpot_ms: null,
    tps: null,
    ...p,
  };
}

describe("computeGroupWinners", () => {
  it("marks min ttft/tpot and max tps within a (scenario,api) group", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", ttft_ms: 200, tpot_ms: 10, tps: 30 }),
      row({ rowKey: "b", model_id: "B", ttft_ms: 100, tpot_ms: 20, tps: 50 }),
    ]);
    expect(w.get("b")?.ttft).toBe(true); // 100 < 200
    expect(w.get("a")?.tpot).toBe(true); // 10 < 20
    expect(w.get("b")?.tps).toBe(true); // 50 > 30
    expect(w.get("a")?.ttft).toBeFalsy();
    expect(w.get("b")?.tpot).toBeFalsy();
  });

  it("returns no winners when the group has only one distinct model", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", ttft_ms: 200, tps: 30 }),
      row({ rowKey: "a2", model_id: "A", ttft_ms: 100, tps: 50 }),
    ]);
    expect(w.size).toBe(0);
  });

  it("does not compare across different api routes", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", api: "chat_completions", ttft_ms: 100 }),
      row({ rowKey: "b", model_id: "B", api: "messages", ttft_ms: 200 }),
    ]);
    expect(w.size).toBe(0); // 각 (시나리오,API) 그룹에 모델 1개씩
  });

  it("ignores null/undefined values and needs ≥2 models with a valid value per metric", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", ttft_ms: 100 }),
      row({ rowKey: "b", model_id: "B", ttft_ms: null }),
    ]);
    expect(w.size).toBe(0); // ttft 유효값 가진 모델이 1개뿐
  });

  it("marks ties on the best value", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", ttft_ms: 100 }),
      row({ rowKey: "b", model_id: "B", ttft_ms: 100 }),
    ]);
    expect(w.get("a")?.ttft).toBe(true);
    expect(w.get("b")?.ttft).toBe(true);
  });

  it("separates winners per scenario", () => {
    const w = computeGroupWinners([
      row({ rowKey: "a", model_id: "A", scenario: "s1", ttft_ms: 100 }),
      row({ rowKey: "b", model_id: "B", scenario: "s1", ttft_ms: 200 }),
      row({ rowKey: "c", model_id: "A", scenario: "s2", ttft_ms: 300 }),
      row({ rowKey: "d", model_id: "B", scenario: "s2", ttft_ms: 150 }),
    ]);
    expect(w.get("a")?.ttft).toBe(true); // s1 최저
    expect(w.get("d")?.ttft).toBe(true); // s2 최저
    expect(w.get("b")?.ttft).toBeFalsy();
    expect(w.get("c")?.ttft).toBeFalsy();
  });
});
