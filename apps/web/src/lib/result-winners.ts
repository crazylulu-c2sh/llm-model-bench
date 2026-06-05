/** 그룹 내 각 메트릭에서 이 행이 최우수인지. */
export type WinnerFlags = { ttft: boolean; tps: boolean };

/** 우수값 계산 입력(결과 행의 최소 부분집합). */
export type WinnerInput = {
  rowKey: string;
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null | undefined;
  tps: number | null | undefined;
};

type MetricKey = "ttft" | "tps";

const METRIC_FIELD: Record<MetricKey, "ttft_ms" | "tps"> = {
  ttft: "ttft_ms",
  tps: "tps",
};
/** 방향: ttft은 낮을수록, tps는 높을수록 좋음. */
const HIGHER_IS_BETTER: Record<MetricKey, boolean> = { ttft: false, tps: true };
const METRICS: readonly MetricKey[] = ["ttft", "tps"];

/**
 * (시나리오·API) 그룹별로 각 메트릭의 최우수 행을 찾아 rowKey→플래그 맵으로 반환한다.
 * - 그룹에 고유 모델이 2개 미만이면 비교 대상이 아니므로 스킵.
 * - 메트릭별로 유효(유한)값을 가진 고유 모델이 2개 미만이면 그 메트릭은 스킵.
 * - 동률(=최우수값과 정확히 일치)은 모두 우수로 표시.
 * - 우수가 하나라도 있는 rowKey만 담는다(sparse).
 */
export function computeGroupWinners(rows: readonly WinnerInput[]): Map<string, WinnerFlags> {
  const groups = new Map<string, WinnerInput[]>();
  for (const r of rows) {
    const k = `${r.scenario}\t${r.api}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  const out = new Map<string, WinnerFlags>();
  const flagOf = (rowKey: string): WinnerFlags => {
    let f = out.get(rowKey);
    if (!f) {
      f = { ttft: false, tps: false };
      out.set(rowKey, f);
    }
    return f;
  };

  for (const list of groups.values()) {
    if (new Set(list.map((r) => r.model_id)).size < 2) continue;

    for (const metric of METRICS) {
      const field = METRIC_FIELD[metric];
      const valid = list.filter((r) => {
        const v = r[field];
        return typeof v === "number" && Number.isFinite(v);
      });
      // 같은 메트릭에 값이 있는 모델이 2개 미만이면 비교가 성립하지 않음.
      if (new Set(valid.map((r) => r.model_id)).size < 2) continue;

      const higher = HIGHER_IS_BETTER[metric];
      let best = higher ? -Infinity : Infinity;
      for (const r of valid) {
        const v = r[field] as number;
        if (higher ? v > best : v < best) best = v;
      }
      for (const r of valid) {
        if ((r[field] as number) === best) flagOf(r.rowKey)[metric] = true;
      }
    }
  }

  return out;
}
