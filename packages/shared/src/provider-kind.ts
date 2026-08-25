import { z } from "zod";

export const ProviderKindSchema = z.enum([
  "lm_studio",
  "ollama",
  "openai_compatible",
  "manual",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/**
 * 로드 TTL 적용 상태 — boolean으로는 "적용 안 됨"과 "확인 불가"를 구분할 수 없다.
 *
 * - `not_applied`: ttl을 아예 싣지 않았다(이미 상주 중 / skipModelLoad / 캐시된 거절 /
 *   명시적 load 폴백). 요청한 TTL이 확실히 걸리지 않은 상태.
 * - `rejected`: 서버가 400/422로 ttl 필드를 거절해 무-ttl로 재시도했다.
 * - `unknown`: ttl을 실어 보냈고 2xx를 받았다. OpenAI 호환 서버는 모르는 필드를 조용히
 *   무시하는 게 일반적이라 2xx만으로는 적용을 단정할 수 없다.
 */
export const LoadTtlStatusSchema = z.enum(["not_applied", "rejected", "unknown"]);
export type LoadTtlStatus = z.infer<typeof LoadTtlStatusSchema>;

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
