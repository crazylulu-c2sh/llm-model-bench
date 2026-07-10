// model_id 문자열에서 벤더(브랜드)·정제 표시명·양자화 태그를 추론한다.
// UI가 raw id 대신 브랜드 아이콘 + 짧은 이름 + 양자화 칩을 보여주기 위한 순수 로직.
// 주의: 이 코드베이스의 `provider`는 "백엔드"(lm_studio/ollama…)를 뜻하므로,
// 브랜드 개념은 `vendor`로 명명한다(llm-profiles의 family는 아키텍처 단위라 별개).

export type VendorKey =
  | "google"
  | "alibaba"
  | "meta"
  | "deepseek"
  | "nvidia"
  | "microsoft"
  | "mistral"
  | "openai"
  | "lg"
  | "zhipu"
  | "minimax"
  | "unknown";

/**
 * 순서 있는 토큰 규칙(first-match-wins). id를 소문자화한 뒤 검사한다.
 * gpt-oss/nemotron 등 로컬 마르크가 먼저 오도록 배치해 오탐을 줄인다.
 * (llm-profiles의 family들을 토큰 수준에서 모두 포함한다: gemma→google, qwen→alibaba,
 *  gpt_oss→openai, nemotron→nvidia, glm→zhipu, minimax→minimax.)
 */
const VENDOR_RULES: ReadonlyArray<readonly [VendorKey, RegExp]> = [
  ["openai", /(^|[/_-])openai\//],
  ["openai", /gpt[-_]?oss/],
  ["nvidia", /(^|[/_-])nvidia\//],
  ["nvidia", /nemotron/],
  ["minimax", /minimax/],
  ["deepseek", /deepseek/],
  ["zhipu", /(chat)?glm/],
  ["zhipu", /zhipu|(^|\/)(thudm|zai-org)\//],
  ["lg", /exaone|lgai/],
  ["google", /gemma|gemini/],
  ["google", /(^|[/_-])google\//],
  ["alibaba", /qwen|qwq|qvq/],
  ["alibaba", /(^|[/_-])alibaba\//],
  ["meta", /llama/],
  ["meta", /(^|[/_-])meta[-/]/],
  ["microsoft", /(^|[^a-z])phi[-_.]?\d/],
  ["microsoft", /(^|[/_-])microsoft\//],
  ["mistral", /mistral|mixtral|ministral|magistral|codestral|devstral/],
];

/** model_id → 벤더(브랜드). 매칭 실패 시 "unknown". 대소문자 무시. */
export function inferModelVendor(modelId: string): VendorKey {
  const id = modelId.toLowerCase().trim();
  if (!id) return "unknown";
  for (const [vendor, re] of VENDOR_RULES) {
    if (re.test(id)) return vendor;
  }
  return "unknown";
}

const HOST_PREFIX = /^(hf\.co|huggingface\.co)\//i;
const CONTAINER_SUFFIX = /[-_](gguf|ggml|bf16|fp16|f16|gptq|awq|mlx|int4|int8|mxfp4)$/i;

/** `1.2b`·`270m`·`0.5b`·`8b` 같은 크기 태그(양자화 아님 — 표시명에서 보존). */
function isSizeTag(t: string): boolean {
  return /^\d+(\.\d+)?[bmk]$/i.test(t);
}
/** `q4_k_m`·`Q4_K_M`·`iq2_m`·`bf16` 같은 양자화/정밀도 태그(size는 제외). */
function isQuantTag(t: string): boolean {
  if (isSizeTag(t)) return false;
  return t.includes("_") || /^(i?q\d|bf16|fp16|f16|int\d|mxfp\d|gguf|gptq|awq)/i.test(t);
}

/**
 * 표시용 짧은 이름: 네임스페이스(org/, hf.co/org/)·양자화 태그(@…, :QUANT, -GGUF/-BF16)를 벗긴다.
 * 크기 태그(:1.2b 등)와 의미 있는 변형(-it/-instruct/-base/-qat…)은 보존. 대소문자 원본 유지.
 */
export function cleanModelDisplayName(modelId: string): string {
  const original = modelId.trim();
  let s = original.replace(HOST_PREFIX, "");
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1); // org/ 네임스페이스 제거
  const at = s.indexOf("@");
  if (at >= 0) s = s.slice(0, at); // @q4_k_m 등
  const colon = s.lastIndexOf(":");
  if (colon >= 0 && isQuantTag(s.slice(colon + 1))) s = s.slice(0, colon); // :Q4_K_M (size는 보존)
  while (CONTAINER_SUFFIX.test(s)) s = s.replace(CONTAINER_SUFFIX, ""); // -GGUF/-BF16 반복 제거
  s = s.replace(/[-_.\s]+$/, "").trim();
  if (s !== "") return s;
  // 전부 벗겨져 빈 문자열이면 원본 마지막 세그먼트로 폴백
  const seg = original.replace(HOST_PREFIX, "");
  const sl = seg.lastIndexOf("/");
  return sl >= 0 ? seg.slice(sl + 1) : seg;
}

/** 양자화/정밀도 태그만 추출(칩 표시용). 없으면 null. 크기 태그(:0.5b 등)는 null. */
export function parseModelQuant(modelId: string): string | null {
  const s = modelId.trim();
  const at = s.indexOf("@");
  if (at >= 0) {
    const tag = s.slice(at + 1).trim();
    return tag || null;
  }
  const colon = s.lastIndexOf(":");
  if (colon >= 0) {
    const tail = s.slice(colon + 1);
    if (isQuantTag(tail)) return tail;
  }
  const m = s.match(CONTAINER_SUFFIX);
  return m ? m[1]! : null;
}
