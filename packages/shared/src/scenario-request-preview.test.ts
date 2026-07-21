import { describe, expect, it } from "vitest";
import { getScenarioBenchRequestPreview } from "./scenario-request-preview.js";

describe("getScenarioBenchRequestPreview", () => {
  it("tool_weather includes OpenAI tools and tool_choice auto", () => {
    const p = getScenarioBenchRequestPreview("tool_weather");
    expect(p.openAiChatCompletions?.tools).toHaveLength(1);
    expect(p.openAiChatCompletions?.tool_choice).toBe("auto");
    expect(p.anthropicMessages?.tools).toHaveLength(1);
  });

  it("translate_nist includes fetch_url and fetch_pdf_text", () => {
    const p = getScenarioBenchRequestPreview("translate_nist_fips197_pdf_tools", {
      publicAssetBaseUrl: "http://127.0.0.1:21104",
    });
    const names = (p.openAiChatCompletions?.tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).toEqual(["fetch_url", "fetch_pdf_text"]);
    const user = p.openAiChatCompletions?.messages[1] as { content: string };
    const system = p.openAiChatCompletions?.messages[0] as { content: string };
    expect(user.content).toContain("nist.fips.197.pdf");
    expect(user.content).not.toContain("fetch_pdf_text");
    expect(system.content).toContain("fetch_pdf_text");
  });

  it("vision scenario includes multimodal user content and image_refs", () => {
    const p = getScenarioBenchRequestPreview("vision_table_ocr_a", {
      publicAssetBaseUrl: "http://127.0.0.1:21104",
    });
    expect(p.imageRefs).toEqual(["/vision/table_ocr_a.jpg"]);
    expect(p.imageDelivery).toBe("base64");
    expect(p.defaultMaxTokensFloor).toBe(2048);
    const user = p.openAiChatCompletions?.messages[1] as { content: unknown[] };
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content).toHaveLength(2);
  });

  it("public origin uses image URL delivery in preview", () => {
    const p = getScenarioBenchRequestPreview("vision_count_red_cars_b", {
      publicAssetBaseUrl: "https://bench.example.com",
    });
    expect(p.imageDelivery).toBe("url");
    const user = p.openAiChatCompletions?.messages[1] as {
      content: { type: string; image_url?: { url: string } }[];
    };
    const img = user.content.find((p) => p.type === "image_url");
    expect(img?.image_url?.url).toBe("https://bench.example.com/vision/count_red_cars_b.jpg");
  });

  it("chat_time_calendar injects Seoul date into user message", () => {
    const ref = "2025-01-15T09:00:00.000Z";
    // 2025-01-15T09:00Z + 9h = 2025-01-15T18:00 Seoul → 당일
    const p = getScenarioBenchRequestPreview("chat_time_calendar", {
      referenceIso: ref,
      calendarTimeZone: "Asia/Seoul",
    });
    const user = p.openAiChatCompletions?.messages[1] as { content: string };
    expect(user.content).toContain("2025-01-15");
    expect(user.content).toContain("Asia/Seoul");
  });
});
