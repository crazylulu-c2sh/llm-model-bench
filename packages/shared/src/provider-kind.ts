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
 * - `lm_studio`: Idle TTL은 명시적 load가 아닌 **JIT 로딩**(첫 추론 요청) 페이로드의 `ttl`(초)
 *   필드로만 적용된다 → 최소 prime chat completion으로 JIT 로드를 트리거(자동 언로드는 LM Studio가 수행).
 * - `ollama`: 네이티브 `/api/generate` `keep_alive`로 preload + 벤치 후 재적용.
 * `openai_compatible`/`manual`은 미지원 → TTL은 무시된다.
 */
export function providerSupportsLoadTtl(p: ProviderKind): boolean {
  return p === "lm_studio" || p === "ollama";
}
