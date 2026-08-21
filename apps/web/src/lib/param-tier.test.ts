import { describe, expect, it } from "vitest";
import { paramTierColor, paramTierLabel } from "./param-tier";
import { ko } from "../i18n/messages/ko";
import { en } from "../i18n/messages/en";
import { ja } from "../i18n/messages/ja";

describe("paramTierColor", () => {
  it("returns muted for null tier", () => {
    expect(paramTierColor(null)).toBe("var(--muted)");
  });
  it("returns the dedicated param-tier CSS var per tier", () => {
    expect(paramTierColor("tiny")).toBe("var(--param-tier-tiny)");
    expect(paramTierColor("small")).toBe("var(--param-tier-small)");
    expect(paramTierColor("medium")).toBe("var(--param-tier-medium)");
    expect(paramTierColor("large")).toBe("var(--param-tier-large)");
  });
});

describe("paramTierLabel", () => {
  it("returns fixed English tier names regardless of locale", () => {
    for (const m of [ko, en, ja]) {
      expect(paramTierLabel("tiny", m)).toBe("Tiny");
      expect(paramTierLabel("small", m)).toBe("Small");
      expect(paramTierLabel("medium", m)).toBe("Medium");
      expect(paramTierLabel("large", m)).toBe("Large");
    }
  });
  it("returns the unknown label for null", () => {
    expect(paramTierLabel(null, ko)).toBe("Unknown");
    expect(paramTierLabel(null, en)).toBe("Unknown");
    expect(paramTierLabel(null, ja)).toBe("Unknown");
  });
});
