import { anthropicToolsForScenario, openAiToolsForScenario } from "./scenario-tools";
import {
  defaultMaxTokensForVisionScenario,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isVisionScenario,
  visionImageFilename,
  type ScenarioId,
  type ScenarioPromptPreviewOpts,
} from "./scenarios-preview";
import { chooseImageDelivery } from "./vision-origin";

export type ScenarioRequestPreviewOpts = ScenarioPromptPreviewOpts & {
  /** 벤치 `public_assets_origin` / 브라우저 origin — PDF URL·비전 image URL 분기 */
  publicAssetBaseUrl?: string;
};

export type ScenarioBenchRequestPreview = {
  /** 비전 시나리오: bench-runner `Math.max` floor */
  defaultMaxTokensFloor: number | null;
  /** 비전 시나리오: `scenario_start.image_delivery` */
  imageDelivery?: "base64" | "url";
  /** 비전 시나리오: `scenario_start.image_refs` (base64 데이터 URL 미포함) */
  imageRefs: string[];
  openAiChatCompletions?: {
    messages: unknown[];
    tools?: unknown[];
    tool_choice?: string;
  };
  anthropicMessages?: {
    system?: string;
    messages: unknown[];
    tools?: unknown[];
  };
};

const BASE64_PLACEHOLDER =
  "<JPEG 바이트 — loopback·사설망(RFC1918) origin에서 /vision/*.jpg를 data URL로 인라인>";

function resolveOrigin(opts?: ScenarioRequestPreviewOpts): string {
  const raw = opts?.publicAssetBaseUrl?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "http://127.0.0.1";
}

function visionImageRefPath(id: ScenarioId): string | null {
  const filename = visionImageFilename(id);
  return filename ? `/vision/${filename}` : null;
}

function openAiImagePartPreview(origin: string, id: ScenarioId): { type: "image_url"; image_url: { url: string } } {
  const refPath = visionImageRefPath(id);
  const delivery = chooseImageDelivery(origin);
  if (delivery === "base64") {
    return {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${BASE64_PLACEHOLDER}` },
    };
  }
  return {
    type: "image_url",
    image_url: { url: `${origin}${refPath ?? ""}` },
  };
}

function anthropicImagePartPreview(
  origin: string,
  id: ScenarioId,
): { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } | { type: "url"; url: string } } {
  const refPath = visionImageRefPath(id);
  const delivery = chooseImageDelivery(origin);
  if (delivery === "base64") {
    return {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: BASE64_PLACEHOLDER },
    };
  }
  return {
    type: "image",
    source: { type: "url", url: `${origin}${refPath ?? ""}` },
  };
}

function promptOpts(opts?: ScenarioRequestPreviewOpts) {
  return {
    publicAssetBaseUrl: resolveOrigin(opts),
    referenceIso: opts?.referenceIso,
    calendarTimeZone: opts?.calendarTimeZone ?? "Asia/Seoul",
  };
}

/** 벤치 upstream 요청 본문 미리보기 — 서버 `buildMessages` / `anthropicMessagesForScenario`와 동일 구조. */
export function getScenarioBenchRequestPreview(
  id: ScenarioId,
  opts?: ScenarioRequestPreviewOpts,
): ScenarioBenchRequestPreview {
  const origin = resolveOrigin(opts);
  const pOpts = promptOpts(opts);
  const system = getScenarioSystemPromptPreview(id);
  const userText = getScenarioUserPromptPreview(id, pOpts);
  const vision = isVisionScenario(id);
  const refPath = vision ? visionImageRefPath(id) : null;

  const out: ScenarioBenchRequestPreview = {
    defaultMaxTokensFloor: defaultMaxTokensForVisionScenario(id),
    imageRefs: refPath ? [refPath] : [],
  };

  if (vision) {
    out.imageDelivery = chooseImageDelivery(origin);
  }

  const openAiTools = openAiToolsForScenario(id);
  const openAiUserContent = vision
    ? [{ type: "text", text: userText }, openAiImagePartPreview(origin, id)]
    : userText;

  out.openAiChatCompletions = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: openAiUserContent },
    ],
    ...(openAiTools ? { tools: openAiTools, tool_choice: "auto" } : {}),
  };

  const anthropicTools = anthropicToolsForScenario(id);
  const anthropicUserContent = vision
    ? [{ type: "text", text: userText }, anthropicImagePartPreview(origin, id)]
    : userText;

  out.anthropicMessages = {
    system,
    messages: [{ role: "user", content: anthropicUserContent }],
    ...(anthropicTools ? { tools: anthropicTools } : {}),
  };

  return out;
}
