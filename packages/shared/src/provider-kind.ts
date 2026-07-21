import { z } from "zod";

export const ProviderKindSchema = z.enum([
  "lm_studio",
  "ollama",
  "openai_compatible",
  "manual",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/**
 * 모델 로드 시 TTL(초)을 적용할 수 있는 백엔드인지 여부.
 * - `lm_studio`: load payload의 `ttl`(초) 필드로 idle 후 자동 언로드.
 * - `ollama`: 네이티브 `/api/generate` `keep_alive`로 preload + 벤치 후 재적용.
 * `openai_compatible`/`manual`은 미지원 → TTL은 무시된다.
 */
export function providerSupportsLoadTtl(p: ProviderKind): boolean {
  return p === "lm_studio" || p === "ollama";
}
