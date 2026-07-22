/** Base URL 비교용 — 서버 `/api/stats/model-latest`와 동일하게 trailing slash 제거 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

// 정렬 순서는 UI 로케일과 무관하게 고정한다. localeCompare(undefined)는 런타임 로케일에
// 의존해 언어 전환 시 순서가 흔들리므로, 전부 "en" Collator로 핀한다(비교 대상은 ASCII ID라 동작 무변).
const alphanumericCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** ModelTable `id` 컬럼의 `alphanumeric` 정렬과 맞추기 위한 문자열 비교 */
export function compareModelIdAlphanumeric(a: string, b: string): number {
  return alphanumericCollator.compare(a, b);
}

/** UI 로케일과 무관한 고정 문자열 비교(api 라우트·시나리오 id 등 ASCII 정렬용) */
const pinnedCollator = new Intl.Collator("en");
export function compareStringsPinned(a: string, b: string): number {
  return pinnedCollator.compare(a, b);
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
