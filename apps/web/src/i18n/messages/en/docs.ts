import type { Messages } from "../ko";

// docs — ko와 키가 정확히 일치해야 함(타입이 강제).
export const docs: Messages["docs"] = {
  visionSubcategory: {
    ocr: "OCR",
    count: "Count",
    chart: "Chart",
    meme: "Meme",
    wireframe: "Wireframe",
  },
  imageAlt: (category, id) => `${category} example input image (${id})`,

  scenarios: {
    heading: "Bench scenario docs",
    intro:
      "The scenario cards on the bench screen only summarize purpose and pass criteria. Here the same metadata is expanded into full fields, along with a",
    introPreviewTerm: "request preview",
    introTail:
      " (per-route JSON for OpenAI/Anthropic — including messages, tools, and multimodal) generated with the same rules as the real bench. For vision scenarios, click the input image thumbnail to enlarge it.",
    tocAria: "Scenario contents",
    toc: "Contents",
    textGroup: (n) => `Text (${n})`,
    visionGroup: (n) => `Vision (${n})`,
    agentGroup: (n) => `Agent (${n})`,
    textSection: "Text scenarios",
    visionSection: "Vision scenarios",
    agentSection: "Agent scenarios",
    agentIntro:
      "Multi-turn tool-use loops. Unlike single-shot, they call tools across several turns before producing a final answer — measuring defects that only surface across turns, such as empty-turn stalls, thinking-budget exhaustion, and tool-argument fidelity. All tool responses are mocked.",

    purpose: "Purpose",
    criteria: "Pass / fail criteria",
    promptNotes: "Prompt & injection",
    tools: "Tools",
    routes: "API routes",
    implementation: "Scoring & execution",
    requestPreview: "Prompt & request preview",
    previewIntro:
      "Same structure as the upstream body the server assembles. `model`, the final `max_tokens`, and profile sampling are added from the UI/profile; here only the messages, tools, and multimodal parts are shown.",
    visionMaxTokensFloor: "Vision max_tokens floor",
    enlargeImageAria: (id) => `Enlarge ${id} image`,
    zoom: "Zoom",
    noDescription: "No description registered.",

    agentCriteria: "Pass criteria",
    agentRoutes: "Routes",
    noMetadata: "No metadata registered.",
  },
};
