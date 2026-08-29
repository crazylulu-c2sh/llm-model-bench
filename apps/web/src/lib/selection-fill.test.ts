import { describe, expect, it } from "vitest";
import { fillAriaPressed, fillLevel } from "./selection-fill";

describe("fillLevel", () => {
  it("total 또는 selected가 0이면 none", () => {
    expect(fillLevel(0, 8)).toBe("none");
    expect(fillLevel(3, 0)).toBe("none");
    expect(fillLevel(0, 0)).toBe("none");
  });

  it("일부만 선택되면 partial", () => {
    expect(fillLevel(1, 8)).toBe("partial");
    expect(fillLevel(7, 8)).toBe("partial");
  });

  it("전부 선택되면 all", () => {
    expect(fillLevel(8, 8)).toBe("all");
    expect(fillLevel(10, 8)).toBe("all");
  });
});

describe("fillAriaPressed", () => {
  it("none/partial/all → false/mixed/true", () => {
    expect(fillAriaPressed("none")).toBe(false);
    expect(fillAriaPressed("partial")).toBe("mixed");
    expect(fillAriaPressed("all")).toBe(true);
  });
});
