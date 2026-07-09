/** Base URL 비교용 — 서버 `/api/stats/model-latest`와 동일하게 trailing slash 제거 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

const alphanumericOpts: Intl.CollatorOptions = { sensitivity: "base", numeric: true };

/** ModelTable `id` 컬럼의 `alphanumeric` 정렬과 맞추기 위한 문자열 비교 */
export function compareModelIdAlphanumeric(a: string, b: string): number {
  return a.localeCompare(b, undefined, alphanumericOpts);
}

/** 벤치 큐 순서 우선, 미등록 ID는 alphanumeric 폴백 */
export function compareModelBenchQueueOrder(a: string, b: string, queue: readonly string[]): number {
  const ia = queue.indexOf(a);
  const ib = queue.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return compareModelIdAlphanumeric(a, b);
}

/** `model_id` 우선, 동률이면 `base_url` */
export function compareModelKey(
  a: { model_id: string; base_url: string },
  b: { model_id: string; base_url: string },
): number {
  const c = compareModelIdAlphanumeric(a.model_id, b.model_id);
  if (c !== 0) return c;
  return compareModelIdAlphanumeric(normalizeBaseUrl(a.base_url), normalizeBaseUrl(b.base_url));
}
