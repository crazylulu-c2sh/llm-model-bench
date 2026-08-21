// model_id·params_string에서 파라미터 규모(billions 단위)를 추론해 4단계 등급으로 분류한다.
// 순수 로직 — server/web 공용. MoE 모델은 총 파라미터 기준(선두 토큰만 파싱해 active-B 접미사는 무시).
import { isSizeTag } from "./model-vendor";

export type ParamTier = "tiny" | "small" | "medium" | "large";

/** 등급 상한(billions, 포함). large는 상한 없음. */
export const PARAM_TIER_THRESHOLDS_B = { tiny: 4, small: 40, medium: 150 } as const;

// k(=천) 단위는 의도적으로 미지원: 실제 LLM 파라미터 수는 천 단위로 표기되는 경우가 없는 반면
// "-4k-/-8k-/-16k-/-32k-/-128k-" 같은 컨텍스트 길이 태그는 모델명에 매우 흔해, k를 허용하면
// Phi-3-medium-128k-instruct류(크기가 "medium"처럼 단어라 숫자 크기 태그가 없는 모델)가
// 컨텍스트 길이를 파라미터 수로 오인식한다. 잘못된 추정보다 미분류(null)를 택한다.
const UNIT_TO_BILLIONS: Record<string, number> = { m: 1e-3, b: 1 };

/**
 * 문자열 선두의 "<숫자><m|b>" 크기 태그만 billions로 파싱한다(전체 매칭 아님).
 * `"30B-A3B"` 같은 MoE 표기도 선두 숫자+단위에서 멈추므로 총 파라미터가 자동으로 선택된다.
 * 구형 `"8x7B"` 표기·단위 없는 순수 숫자·k(천) 단위는 의도적으로 미지원 — null.
 */
export function parseParamsBillions(sizeTag: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([mb])\b/i.exec(sizeTag.trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return value * UNIT_TO_BILLIONS[m[2]!.toLowerCase()]!;
}

// InternLM2.5류가 소수점 대신 밑줄을 쓰는 크기 표기(`1_8b`→`1.8b`)를 토큰화 전에 정규화.
// 버전 번호의 밑줄(`internlm2_5-`)은 뒤에 단위 문자가 바로 붙지 않아 매칭되지 않는다.
const UNDERSCORE_DECIMAL_SIZE = /(\d)_(\d+(?:\.\d+)?[mb])\b/gi;

/**
 * model_id를 구분자(`/ - _ : @` 공백)로 토큰화해 첫 크기 태그 토큰을 billions로 추출.
 * params_string이 없는 백엔드(Ollama 등)용 폴백. `.`은 분리하지 않아 `"1.2b"`·`"qwen2.5"`가 보존된다.
 * 숫자로 시작하지 않는 토큰(`"e2b"`, `"8x7b"` 등)은 자연히 걸러진다 — 알려진 미지원 범위.
 */
export function extractParamsBillionsFromModelId(modelId: string): number | null {
  const normalized = modelId.toLowerCase().replace(UNDERSCORE_DECIMAL_SIZE, "$1.$2");
  const tokens = normalized.split(/[/\-_:@\s]+/);
  for (const t of tokens) {
    if (!t || !isSizeTag(t)) continue;
    const b = parseParamsBillions(t);
    if (b != null) return b;
  }
  return null;
}

/** billions 값을 4단계 등급으로 분류(경계 포함 하한, 예: 4B는 tiny). */
export function paramTierFromBillions(b: number): ParamTier {
  if (b <= PARAM_TIER_THRESHOLDS_B.tiny) return "tiny";
  if (b <= PARAM_TIER_THRESHOLDS_B.small) return "small";
  if (b <= PARAM_TIER_THRESHOLDS_B.medium) return "medium";
  return "large";
}

/**
 * params_string(있으면 우선)·model_id 순으로 파라미터 규모를 추론해 등급을 반환.
 * 둘 다 판별 불가하면 null(서수 척도 위의 5번째 점이 아니라 "데이터 없음"으로 취급).
 */
export function inferParamTier(input: { modelId: string; paramsString?: string | null }): ParamTier | null {
  const fromParamsString = input.paramsString?.trim() ? parseParamsBillions(input.paramsString) : null;
  const billions = fromParamsString ?? extractParamsBillionsFromModelId(input.modelId);
  return billions == null ? null : paramTierFromBillions(billions);
}
