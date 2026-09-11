import { z } from "zod";
import { decodeTokensPerSecondFromRun, effectiveOutputTokens, prefillTokensPerSecondFromRun } from "../tps";
import { runHasChannelTagLeak, runIsEmptyTurn, type LeakRunInput } from "./leak-metrics";

/**
 * #84: 두 런(또는 두 모델의 최신 런) 회귀 diff.
 *
 * per-scenario×route로 TTFT p50/p95 · TPS(per-user + aggregate) · 품질 · 정체/누수 델타를 내고,
 * 설정 가능한 임계를 넘으면 `regression` 플래그를 세운다. 정체/누수 판정은 #80의 per-run 폴백을 재사용.
 */

export type CompareRunInput = LeakRunInput & {
  ttft_ms: number | null;
  total_ms: number;
  usage_prompt_tokens?: number | null;
  quality?: { pass: boolean; score?: number; reason?: string };
};

/** nearest-rank 백분위(오름차순, 유한·비음수만). 값이 없으면 null. */
export function ttftPercentiles(values: readonly number[]): { p50: number | null; p95: number | null } {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return { p50: null, p95: null };
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]!;
  return { p50: at(50), p95: at(95) };
}

export const MetricDeltaSchema = z.object({
  a: z.number().nullable(),
  b: z.number().nullable(),
  /** b - a (한쪽이 null이면 null). */
  delta: z.number().nullable(),
  /** (b - a) / a (a가 0/null이면 null). */
  pct: z.number().nullable(),
});
export type MetricDelta = z.infer<typeof MetricDeltaSchema>;

function delta(a: number | null, b: number | null): MetricDelta {
  const d = a != null && b != null ? b - a : null;
  const pct = a != null && a !== 0 && b != null ? (b - a) / a : null;
  return { a, b, delta: d, pct };
}

export const RegressionKindSchema = z.enum([
  "quality_drop",
  "new_empty_turns",
  "tps_regression",
  "prefill_tps_regression",
  "ttft_regression",
]);
export type RegressionKind = z.infer<typeof RegressionKindSchema>;

export const CompareThresholdsSchema = z.object({
  /** 품질(0~1) 절대 하락이 이 값 초과면 regression. */
  qualityDropAbs: z.number().default(0.05),
  /** aggregate TPS가 이 비율 이상 하락하면 regression. */
  tpsRegressionPct: z.number().default(0.15),
  /** TTFT p95가 이 비율 이상 증가하면 regression. */
  ttftRegressionPct: z.number().default(0.25),
  /** A엔 없던 빈 턴이 B에 새로 생기면 regression. */
  flagNewEmptyTurns: z.boolean().default(true),
});
export type CompareThresholds = z.infer<typeof CompareThresholdsSchema>;

export const CompareScenarioSchema = z.object({
  scenario: z.string(),
  api_route: z.string(),
  ttft_p50: MetricDeltaSchema,
  ttft_p95: MetricDeltaSchema,
  /** per-run 디코드 TPS 평균. */
  tps_per_user: MetricDeltaSchema,
  /** Σ decode_tokens / Σ decode_seconds. */
  tps_aggregate: MetricDeltaSchema,
  /** per-run 프리필 TPS 평균. 한쪽이라도 usage_prompt_tokens가 없으면 null. */
  prefill_tps_per_user: MetricDeltaSchema,
  /** Σ prompt_tokens / Σ ttft_seconds. 양쪽 모두 있을 때만 값. */
  prefill_tps_aggregate: MetricDeltaSchema,
  quality: MetricDeltaSchema,
  empty_turn_rate: MetricDeltaSchema,
  channel_tag_leak: MetricDeltaSchema,
  regressions: z.array(RegressionKindSchema),
  regression: z.boolean(),
  /**
   * #174/#173: 두 런의 **측정 프로토콜**이 달라 회귀 판정을 신뢰할 수 없을 때 그 축 목록.
   * 비어 있지 않으면 델타 숫자는 그대로 두되 회귀 플래그를 세우지 않는다.
   */
  protocol_mismatch: z.array(z.string()).optional(),
  /** `protocol_mismatch`가 비어 있으면 true. 과거 응답에는 없으므로 optional. */
  comparable: z.boolean().optional(),
});
export type CompareScenario = z.infer<typeof CompareScenarioSchema>;

export const CompareRunRefSchema = z.object({
  run_id: z.string().nullable(),
  model_id: z.string(),
  base_url: z.string().optional(),
});

export const CompareResponseSchema = z.object({
  runA: CompareRunRefSchema,
  runB: CompareRunRefSchema,
  thresholds: CompareThresholdsSchema,
  scenarios: z.array(CompareScenarioSchema),
  summary: z.object({
    regression: z.boolean(),
    regressions: z.array(RegressionKindSchema),
    scenarios_regressed: z.number().int(),
    scenarios_compared: z.number().int(),
    /** 측정 프로토콜 불일치로 회귀 판정에서 제외한 시나리오 수. */
    scenarios_incomparable: z.number().int().optional(),
  }),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

/** 서버 BenchResultDetail의 구조적 최소 입력. */
/** compare가 프로토콜 축 판정에 읽는 런 메타. 호출부는 전체 `BenchRunMeta`를 넘기므로 구조적으로 호환. */
export type CompareMeta = {
  model_id: string;
  base_url?: string;
  run_id?: string;
  /** #174: 실제로 업스트림에 실린 `max_tokens`. 과거 런에는 없다. */
  max_tokens_effective?: number;
  /** #173: `messages`에 extended thinking을 요청했는지. 과거 런에는 없다(= false). */
  anthropic_thinking_requested?: boolean;
};

export type CompareBenchDetailInput = {
  meta: CompareMeta;
  scenarios: ReadonlyArray<{ id: string; api_route: string; runs: readonly CompareRunInput[] }>;
};

type SideMetrics = {
  ttft_p50: number | null;
  ttft_p95: number | null;
  tps_per_user: number | null;
  tps_aggregate: number | null;
  prefill_tps_per_user: number | null;
  prefill_tps_aggregate: number | null;
  quality: number | null;
  empty_turn_rate: number;
  channel_tag_leak: number;
  n: number;
};

function sideMetrics(runs: readonly CompareRunInput[]): SideMetrics {
  const pct = ttftPercentiles(runs.map((r) => r.ttft_ms).filter((x): x is number => x != null));
  let tpsSum = 0;
  let tpsN = 0;
  let decodeTok = 0;
  let decodeSec = 0;
  let prefillSum = 0;
  let prefillN = 0;
  let prefillTok = 0;
  let prefillSec = 0;
  let qSum = 0;
  let qN = 0;
  let empty = 0;
  let chan = 0;
  for (const r of runs) {
    const tps = decodeTokensPerSecondFromRun({
      totalMs: r.total_ms,
      ttftMs: r.ttft_ms,
      outputText: r.output_text,
      usageTokens: r.usage_output_tokens,
    });
    if (tps != null && tps > 0) {
      tpsSum += tps;
      tpsN += 1;
    }
    const out = effectiveOutputTokens(r.output_text, r.usage_output_tokens);
    if (r.ttft_ms != null && r.total_ms > r.ttft_ms && out > 1) {
      decodeTok += out - 1;
      decodeSec += (r.total_ms - r.ttft_ms) / 1000;
    }
    const prefill = prefillTokensPerSecondFromRun(r.ttft_ms, r.usage_prompt_tokens);
    if (prefill != null) {
      prefillSum += prefill;
      prefillN += 1;
    }
    if (
      r.usage_prompt_tokens != null &&
      r.usage_prompt_tokens > 0 &&
      r.ttft_ms != null &&
      r.ttft_ms > 0
    ) {
      prefillTok += r.usage_prompt_tokens;
      prefillSec += r.ttft_ms / 1000;
    }
    const s = r.quality?.score;
    if (typeof s === "number" && Number.isFinite(s)) {
      qSum += s;
      qN += 1;
    }
    if (runIsEmptyTurn(r)) empty += 1;
    if (runHasChannelTagLeak(r)) chan += 1;
  }
  const n = runs.length;
  return {
    ttft_p50: pct.p50,
    ttft_p95: pct.p95,
    tps_per_user: tpsN > 0 ? tpsSum / tpsN : null,
    tps_aggregate: decodeSec > 0 ? decodeTok / decodeSec : null,
    prefill_tps_per_user: prefillN > 0 ? prefillSum / prefillN : null,
    prefill_tps_aggregate: prefillSec > 0 ? prefillTok / prefillSec : null,
    quality: qN > 0 ? qSum / qN : null,
    empty_turn_rate: n > 0 ? empty / n : 0,
    channel_tag_leak: n > 0 ? chan / n : 0,
    n,
  };
}

/**
 * 측정 프로토콜 축 — 하네스가 "무엇을 측정하는지"를 바꾸는 설정. 두 런의 값이 다르면 그 축이
 * 영향을 주는 라우트의 회귀 판정을 신뢰할 수 없다(하네스 변경이 모델 회귀로 둔갑한다).
 *
 * `affects`를 축마다 두는 게 핵심 — 출력 상한은 **양쪽 라우트를 다** 오염시키지만
 * Anthropic `thinking` 요청 여부는 `messages`만 오염시킨다.
 */
type ProtocolAxis = {
  /** `protocol_mismatch`에 그대로 실리는 이름. */
  key: string;
  /** 필드가 없는 과거 런에서도 안정적인 기본값을 내야 한다. */
  read: (meta: CompareMeta) => unknown;
  affects: readonly string[] | "all";
};

export const PROTOCOL_AXES: readonly ProtocolAxis[] = [
  // #174: 상한이 실제로 전달되기 전/후로 출력 길이가 바뀌고, 출력 길이는 TPS를 크게 바꾼다.
  { key: "max_tokens_effective", read: (m) => m.max_tokens_effective ?? null, affects: "all" },
  // #173: 사고를 요청하기 전/후로 `messages`가 측정하는 워크로드 자체가 달라진다(모델에 따라
  // 추론을 하고도 버리거나, 아예 하지 않는다). `chat_completions`는 영향이 없다.
  {
    key: "anthropic_thinking_requested",
    read: (m) => m.anthropic_thinking_requested === true,
    affects: ["messages"],
  },
];

function axisAffectsRoute(axis: ProtocolAxis, route: string): boolean {
  return axis.affects === "all" || axis.affects.includes(route);
}

/** 이 라우트에서 A·B의 측정 프로토콜이 어긋난 축 목록. 비어 있으면 비교 가능. */
export function protocolMismatchFor(route: string, a: CompareMeta, b: CompareMeta): string[] {
  return PROTOCOL_AXES.filter(
    (ax) => axisAffectsRoute(ax, route) && !Object.is(ax.read(a), ax.read(b)),
  ).map((ax) => ax.key);
}

const joinKey = (id: string, route: string) => `${id} ${route}`;

/** 순수: 두 상세를 (scenario, route)로 조인해 델타 + 회귀 분류. */
export function computeCompare(
  detailA: CompareBenchDetailInput,
  detailB: CompareBenchDetailInput,
  thresholdsInput?: Partial<CompareThresholds>,
): CompareResponse {
  const thresholds = CompareThresholdsSchema.parse(thresholdsInput ?? {});
  const bMap = new Map<string, { id: string; api_route: string; runs: readonly CompareRunInput[] }>();
  for (const sc of detailB.scenarios) {
    if (sc.runs?.length) bMap.set(joinKey(sc.id, sc.api_route), sc);
  }

  const scenarios: CompareScenario[] = [];
  const allRegressions = new Set<RegressionKind>();
  let regressed = 0;

  for (const scA of detailA.scenarios) {
    if (!scA.runs?.length) continue;
    const scB = bMap.get(joinKey(scA.id, scA.api_route));
    if (!scB) continue;
    const a = sideMetrics(scA.runs);
    const b = sideMetrics(scB.runs);
    const regressions: RegressionKind[] = [];

    if (a.quality != null && b.quality != null && a.quality - b.quality > thresholds.qualityDropAbs) {
      regressions.push("quality_drop");
    }
    if (thresholds.flagNewEmptyTurns && a.empty_turn_rate === 0 && b.empty_turn_rate > 0) {
      regressions.push("new_empty_turns");
    }
    if (
      a.tps_aggregate != null &&
      a.tps_aggregate > 0 &&
      b.tps_aggregate != null &&
      b.tps_aggregate < a.tps_aggregate * (1 - thresholds.tpsRegressionPct)
    ) {
      regressions.push("tps_regression");
    }
    if (
      a.prefill_tps_aggregate != null &&
      a.prefill_tps_aggregate > 0 &&
      b.prefill_tps_aggregate != null &&
      b.prefill_tps_aggregate < a.prefill_tps_aggregate * (1 - thresholds.tpsRegressionPct)
    ) {
      regressions.push("prefill_tps_regression");
    }
    if (
      a.ttft_p95 != null &&
      a.ttft_p95 > 0 &&
      b.ttft_p95 != null &&
      b.ttft_p95 > a.ttft_p95 * (1 + thresholds.ttftRegressionPct)
    ) {
      regressions.push("ttft_regression");
    }

    // 측정 프로토콜이 어긋난 행은 델타를 그대로 보여 주되 회귀로 세지 않는다 —
    // 하네스 변경을 모델 회귀로 보고하는 오탐(#84 게이트가 막으려던 바로 그것)을 방지.
    const protocol_mismatch = protocolMismatchFor(scA.api_route, detailA.meta, detailB.meta);
    const comparable = protocol_mismatch.length === 0;
    if (!comparable) regressions.length = 0;

    for (const r of regressions) allRegressions.add(r);
    const regression = regressions.length > 0;
    if (regression) regressed += 1;

    scenarios.push({
      scenario: scA.id,
      api_route: scA.api_route,
      ttft_p50: delta(a.ttft_p50, b.ttft_p50),
      ttft_p95: delta(a.ttft_p95, b.ttft_p95),
      tps_per_user: delta(a.tps_per_user, b.tps_per_user),
      tps_aggregate: delta(a.tps_aggregate, b.tps_aggregate),
      prefill_tps_per_user: delta(a.prefill_tps_per_user, b.prefill_tps_per_user),
      prefill_tps_aggregate: delta(a.prefill_tps_aggregate, b.prefill_tps_aggregate),
      quality: delta(a.quality, b.quality),
      empty_turn_rate: delta(a.empty_turn_rate, b.empty_turn_rate),
      channel_tag_leak: delta(a.channel_tag_leak, b.channel_tag_leak),
      regressions,
      regression,
      protocol_mismatch,
      comparable,
    });
  }

  return {
    runA: {
      run_id: detailA.meta.run_id ?? null,
      model_id: detailA.meta.model_id,
      ...(detailA.meta.base_url ? { base_url: detailA.meta.base_url } : {}),
    },
    runB: {
      run_id: detailB.meta.run_id ?? null,
      model_id: detailB.meta.model_id,
      ...(detailB.meta.base_url ? { base_url: detailB.meta.base_url } : {}),
    },
    thresholds,
    scenarios,
    summary: {
      regression: regressed > 0,
      regressions: [...allRegressions],
      scenarios_regressed: regressed,
      scenarios_compared: scenarios.length,
      scenarios_incomparable: scenarios.filter((x) => x.comparable === false).length,
    },
  };
}
