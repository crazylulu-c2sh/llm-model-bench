import type { ScenarioId } from "./scenarios-preview";

/** OpenAI Chat Completions `tools` — 서버 `openAiToolsForScenario`·문서 미리보기 단일 소스. */
export const TRANSLATE_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "HTTP GET the URL and return the body decoded as UTF-8 text (truncated). Do not use for PDF files; use fetch_pdf_text instead.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_pdf_text",
      description:
        "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the NIST FIPS 197 PDF.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL to a .pdf" } },
        required: ["url"],
      },
    },
  },
] as const;

/** Anthropic Messages `tools` — 서버 `anthropicToolsForScenario`·문서 미리보기 단일 소스. */
export const TRANSLATE_TOOLS_ANTHROPIC = [
  {
    name: "fetch_url",
    description:
      "HTTP GET the URL and return the body decoded as UTF-8 text (truncated). Do not use for PDF files; use fetch_pdf_text instead.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "fetch_pdf_text",
    description:
      "HTTP GET a PDF document and return extracted plain text (truncated). Required to read the NIST FIPS 197 PDF.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
] as const;

const WEATHER_TOOL_OPENAI = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
] as const;

const WEATHER_TOOL_ANTHROPIC = [
  {
    name: "get_weather",
    description: "Get weather for a city",
    input_schema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
] as const;

export function openAiToolsForScenario(id: ScenarioId): unknown[] | undefined {
  if (id === "tool_weather") return [...WEATHER_TOOL_OPENAI];
  if (id === "translate_nist_fips197_pdf_tools") return [...TRANSLATE_TOOLS_OPENAI];
  return undefined;
}

export function anthropicToolsForScenario(id: ScenarioId): unknown[] | undefined {
  if (id === "tool_weather") return [...WEATHER_TOOL_ANTHROPIC];
  if (id === "translate_nist_fips197_pdf_tools") return [...TRANSLATE_TOOLS_ANTHROPIC];
  return undefined;
}
