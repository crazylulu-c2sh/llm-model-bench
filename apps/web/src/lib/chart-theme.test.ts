import { describe, expect, it } from "vitest";
import { truncateChartLabel } from "./chart-theme";

describe("truncateChartLabel", () => {
  it("한도 이하 문자열은 그대로 반환한다", () => {
    expect(truncateChartLabel("chat_hello (chat)")).toBe("chat_hello (chat)");
  });

  it("한도를 넘으면 뒤에서부터 잘라 말줄임표를 붙인다", () => {
    const long =
      "chat_hello (chat) · esatapedico/qwen3.8-27b-nvfp4-mtp-gguf/qwen3.8-27b-nvfp4-mtp-compact-low.gguf";
    const out = truncateChartLabel(long);
    expect(out.length).toBe(28);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("max 인자로 한도를 조절할 수 있다", () => {
    expect(truncateChartLabel("abcdefghij", 5)).toBe("abcd…");
  });

  it("정확히 한도와 같은 길이면 그대로 반환한다(경계값)", () => {
    const exact = "a".repeat(28);
    expect(truncateChartLabel(exact)).toBe(exact);
  });
});
