import { describe, expect, it } from "vitest";
import { buildModelColorMap, MODEL_HUE_PALETTE, modelIdentityColor } from "./model-color";

describe("buildModelColorMap", () => {
  it("assigns colors by alphanumeric-sorted unique index", () => {
    const m = buildModelColorMap(["qwen", "gemma", "qwen"]);
    expect(m.size).toBe(2); // 중복 제거
    // gemma < qwen → index 0, 1
    expect(m.get("gemma")).toBe(modelIdentityColor(0));
    expect(m.get("qwen")).toBe(modelIdentityColor(1));
  });

  it("is stable regardless of input order", () => {
    const a = buildModelColorMap(["b", "a", "c"]);
    const b = buildModelColorMap(["c", "a", "b"]);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("uses numeric-aware ordering (model2 before model10)", () => {
    const m = buildModelColorMap(["model10", "model2"]);
    expect(m.get("model2")).toBe(modelIdentityColor(0));
    expect(m.get("model10")).toBe(modelIdentityColor(1));
  });

  it("does not throw and keeps all entries for >6 models", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
    const m = buildModelColorMap(ids);
    expect(m.size).toBe(8);
  });
});

describe("modelIdentityColor", () => {
  it("cycles hue through the palette", () => {
    expect(modelIdentityColor(0)).toContain(`hsl(${MODEL_HUE_PALETTE[0]} `);
    expect(modelIdentityColor(MODEL_HUE_PALETTE.length)).toContain(`hsl(${MODEL_HUE_PALETTE[0]} `);
  });

  it("returns an hsl string", () => {
    expect(modelIdentityColor(1)).toMatch(/^hsl\(/);
  });
});
