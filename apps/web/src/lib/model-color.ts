import { compareModelIdAlphanumeric } from "./model-sort";

/** 모델 정체성 색 hue 팔레트(BenchCharts `modelColor`와 동일 hue 순서). 6색 순환. */
export const MODEL_HUE_PALETTE: readonly number[] = [200, 145, 280, 35, 12, 320];

/**
 * 정체성 색: 인덱스 → HSL 문자열. 점·왼쪽 막대용이라 라이트·다크 양쪽에서 보이도록 중간 명도.
 * 6색을 넘으면 명도 밴드(0→55%, 1→68%, 2→42%)로 약하게 더 분리한다.
 */
export function modelIdentityColor(index: number): string {
  const len = MODEL_HUE_PALETTE.length;
  const hue = MODEL_HUE_PALETTE[((index % len) + len) % len]!;
  const band = Math.floor(Math.max(0, index) / len) % 3;
  const light = band === 0 ? 55 : band === 1 ? 68 : 42;
  return `hsl(${hue} 70% ${light}%)`;
}

/**
 * `model_id` → 안정 색 Map. 고유 id를 alphanumeric 정렬한 인덱스로 색을 배정해
 * 렌더 간 안정적이고(입력 순서 무관), 모델 수가 적을 때 hue가 최대로 벌어진다.
 */
export function buildModelColorMap(modelIds: Iterable<string>): Map<string, string> {
  const unique = [...new Set(modelIds)].sort(compareModelIdAlphanumeric);
  const map = new Map<string, string>();
  unique.forEach((id, i) => map.set(id, modelIdentityColor(i)));
  return map;
}
