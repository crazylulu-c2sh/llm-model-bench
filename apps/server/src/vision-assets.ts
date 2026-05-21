import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isVisionScenario, visionImageFilename, type ScenarioId } from "@llm-bench/shared";

export type ImageBytes = {
  bytes: Buffer;
  mediaType: "image/jpeg";
  refPath: string;
};

export type ImageDelivery = "base64" | "url";

export type OpenAiImagePart = {
  type: "image_url";
  image_url: { url: string };
};

export type AnthropicImagePart = {
  type: "image";
  source:
    | { type: "base64"; media_type: "image/jpeg"; data: string }
    | { type: "url"; url: string };
};

const cache = new Map<ScenarioId, ImageBytes>();

/** base64 인라인 페이로드 폭주를 막는 디스크 상한. 1MB. */
export const MAX_VISION_IMAGE_BYTES = 1024 * 1024;

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function visionFilePath(filename: string): string {
  return path.join(repoRootDir(), "apps/web/public/vision", filename);
}

export { isVisionScenario };

/**
 * 디스크에서 한 번 읽고 메모리 캐시. 비전 시나리오가 아니면 throw.
 * 1MB 초과 자산이면 `image_too_large: <id>=<bytes>` 형태로 throw —
 * bench-runner의 try/catch가 이 prefix를 감지해 quality에 라벨링한다.
 */
export function loadVisionImageBytes(id: ScenarioId): ImageBytes {
  const cached = cache.get(id);
  if (cached) return cached;
  const filename = visionImageFilename(id);
  if (!filename) throw new Error(`not a vision scenario: ${id}`);
  const bytes = readFileSync(visionFilePath(filename));
  if (bytes.byteLength > MAX_VISION_IMAGE_BYTES) {
    throw new Error(`image_too_large: ${id}=${bytes.byteLength}`);
  }
  const out: ImageBytes = {
    bytes,
    mediaType: "image/jpeg",
    refPath: `/vision/${filename}`,
  };
  cache.set(id, out);
  return out;
}

/** loopback / 사설망 origin인지 판정. base64 인라인 분기에 사용. */
export function isLoopbackOrPrivateOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return true; // 파싱 실패는 보수적으로 base64
  }
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

export function chooseImageDelivery(origin: string): ImageDelivery {
  return isLoopbackOrPrivateOrigin(origin) ? "base64" : "url";
}

/** 라우트별 image part — D1 분기·MIME을 한 곳에서. */
export function buildImagePart(
  id: ScenarioId,
  origin: string,
  route: "openai",
): OpenAiImagePart;
export function buildImagePart(
  id: ScenarioId,
  origin: string,
  route: "anthropic",
): AnthropicImagePart;
export function buildImagePart(
  id: ScenarioId,
  origin: string,
  route: "openai" | "anthropic",
): OpenAiImagePart | AnthropicImagePart {
  const delivery = chooseImageDelivery(origin);
  const asset = loadVisionImageBytes(id);
  if (delivery === "base64") {
    const data = asset.bytes.toString("base64");
    if (route === "openai") {
      return {
        type: "image_url",
        image_url: { url: `data:${asset.mediaType};base64,${data}` },
      };
    }
    return {
      type: "image",
      source: { type: "base64", media_type: asset.mediaType, data },
    };
  }
  const url = `${origin.replace(/\/+$/, "")}${asset.refPath}`;
  if (route === "openai") {
    return { type: "image_url", image_url: { url } };
  }
  return { type: "image", source: { type: "url", url } };
}

/** scenario_start.image_refs 용 — base64 데이터 URL은 절대 포함하지 않음. */
export function visionImageRefs(id: ScenarioId): string[] {
  if (!isVisionScenario(id)) return [];
  const asset = loadVisionImageBytes(id);
  return [asset.refPath];
}
