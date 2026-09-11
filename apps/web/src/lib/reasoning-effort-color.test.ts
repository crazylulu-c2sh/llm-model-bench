import { describe, expect, it } from "vitest";
import { reasoningEffortColor } from "./reasoning-effort-color";

describe("reasoningEffortColor", () => {
  it("maps effort levels to Primer tokens", () => {
    expect(reasoningEffortColor(undefined)).toBe("var(--muted)");
    expect(reasoningEffortColor("none")).toBe("var(--muted)");
    expect(reasoningEffortColor("minimal")).toBe("var(--muted)");
    expect(reasoningEffortColor("low")).toBe("var(--warning)");
    expect(reasoningEffortColor("medium")).toBe("var(--accent-2)");
    expect(reasoningEffortColor("high")).toBe("var(--tier-okay)");
    expect(reasoningEffortColor("xhigh")).toBe("var(--chart-tps)");
  });
});
