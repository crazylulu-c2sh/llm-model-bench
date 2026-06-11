import type { GpuSnapshot, LoadedModelInfo, StreamEvent } from "@llm-bench/shared";
import { getGpuSnapshot } from "./system-info.js";
import { isLmsCliEnabled, lmsPs, type LmsExecResult } from "./lms-cli.js";
import { collectLmStudioLoaded, collectOllamaLoaded } from "./monitor-collect.js";
import { baseKey } from "./lmstudio.js";
import { isTargetOnServerHost } from "./util/localhost.js";

/**
 * 벤치마크 오염 가드의 감지 핵심.
 *
 * 두 샘플링 모드로 self-contention(우리 벤치가 GPU를 100% 점유하는 문제)을 구조적으로 해결:
 * - `sampleIdle`  : 우리 요청이 in-flight가 아닐 때만 호출(사전/이터레이션 게이트). GPU util·
 *                   /metrics·lms ps를 신뢰. 활성 신호 하나라도 임계 초과면 active=true.
 * - `sampleInFlight`: 우리 스트리밍 구간 동안에만 호출. GPU util 미사용(우리 잡음). 서버 요청수
 *                   메트릭(running≥2/waiting≥1)·lms 활성(타 모델 generating/우리 모델 queued>0)·
 *                   로드 ID churn·Ollama expires_at 전진으로 외부 동시 추론 감지.
 *
 * 동일-모델 병렬 추론은 /metrics(요청 개수, 우리 기여=1을 알기에 in-flight 신뢰)와
 * lms ps --json(generation/queued)로 감지한다. 두 신호가 없으면 GPU 유휴-갭이 지속 부하를 잡는다.
 */

export type ContentionProviderKind =
  | "lm_studio"
  | "ollama"
  | "openai_compatible"
  | "manual";

export type ContentionConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  maxRetriesPerIteration: number;
  preBenchTimeoutMs: number;
  betweenIterationTimeoutMs: number;
  totalWaitBudgetMs: number;
  gpuUtilThresholdPct: number;
  requiredConsecutiveIdle: number;
  serverMetricsEnabled: boolean;
  lmsCliActivityEnabled: boolean;
};

export type ContentionConfigInput = {
  provider: ContentionProviderKind;
  contentionGuardEnabled?: boolean;
  contentionPollIntervalMs?: number;
  contentionMaxRetriesPerIteration?: number;
  contentionPreBenchTimeoutMs?: number;
  contentionBetweenIterationTimeoutMs?: number;
  contentionTotalWaitBudgetMs?: number;
  contentionGpuUtilThresholdPct?: number;
  contentionRequiredConsecutiveIdle?: number;
  contentionServerMetricsEnabled?: boolean;
  contentionLmsCliActivityEnabled?: boolean;
};

const clampNum = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(hi, Math.max(lo, n));
};

/** UI/요청 입력을 클램프·기본값 적용된 해석 config로. manual이면 가드 비활성. */
export function resolveContentionConfig(input: ContentionConfigInput): ContentionConfig {
  const enabled = (input.contentionGuardEnabled ?? true) && input.provider !== "manual";
  return {
    enabled,
    pollIntervalMs: clampNum(input.contentionPollIntervalMs, 250, 5000, 1000),
    maxRetriesPerIteration: clampNum(input.contentionMaxRetriesPerIteration, 0, 5, 2),
    preBenchTimeoutMs: clampNum(input.contentionPreBenchTimeoutMs, 0, 600_000, 120_000),
    betweenIterationTimeoutMs: clampNum(input.contentionBetweenIterationTimeoutMs, 0, 300_000, 30_000),
    totalWaitBudgetMs: clampNum(input.contentionTotalWaitBudgetMs, 0, 1_800_000, 300_000),
    gpuUtilThresholdPct: clampNum(input.contentionGpuUtilThresholdPct, 1, 100, 25),
    requiredConsecutiveIdle: clampNum(input.contentionRequiredConsecutiveIdle, 1, 5, 2),
    serverMetricsEnabled: input.contentionServerMetricsEnabled ?? true,
    lmsCliActivityEnabled: input.contentionLmsCliActivityEnabled ?? true,
  };
}

// ── Prometheus /metrics 파서 ────────────────────────────────────────────────

const RUNNING_METRICS = [
  "vllm:num_requests_running",
  "llamacpp:requests_processing",
  "tgi_batch_current_size",
];
const WAITING_METRICS = [
  "vllm:num_requests_waiting",
  "llamacpp:requests_deferred",
  "tgi_queue_size",
];

function matchMetricValue(line: string, names: string[]): number | null {
  for (const n of names) {
    if (!line.startsWith(n)) continue;
    const rest = line.slice(n.length);
    // metric 이름 경계: 다음 문자가 공백/탭 또는 '{'(라벨)이어야 한다.
    if (rest && !/^[\s{]/.test(rest)) continue;
    const m = rest.match(/^(?:\{[^}]*\})?\s+([0-9.eE+-]+)/);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** vLLM/llama.cpp/TGI의 실행/대기 요청 수 게이지 파싱. 매칭 없으면 null(미지원 서버). */
export function parsePrometheusRunningWaiting(
  text: string,
): { running: number; waiting: number } | null {
  if (!text || typeof text !== "string") return null;
  let running: number | null = null;
  let waiting: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const r = matchMetricValue(line, RUNNING_METRICS);
    if (r != null) {
      running = (running ?? 0) + r;
      continue;
    }
    const w = matchMetricValue(line, WAITING_METRICS);
    if (w != null) waiting = (waiting ?? 0) + w;
  }
  if (running == null && waiting == null) return null;
  return { running: running ?? 0, waiting: waiting ?? 0 };
}

// ── lms ps --json 활성 파서 ─────────────────────────────────────────────────

export type LmsActivity = {
  /** generating 중인 모델 baseKey 집합. */
  generating: Set<string>;
  /** baseKey → 대기(queued) 예측 요청 수. */
  queuedByKey: Map<string, number>;
};

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}
function pickNum(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * `lms ps --json`(LM Studio v0.3.27+) stdout을 파싱해 모델별 generation 상태·queued 수를 추출.
 * 정확한 스키마가 문서화돼 있지 않아 필드명을 방어적으로 다룬다. 미지원/구버전이면 빈 결과.
 */
export function parseLmsPsActivity(stdout: string): LmsActivity {
  const generating = new Set<string>();
  const queuedByKey = new Map<string, number>();
  const trimmed = (stdout ?? "").trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) {
    return { generating, queuedByKey };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { generating, queuedByKey };
  }
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { models?: unknown[] })?.models)
      ? (parsed as { models: unknown[] }).models
      : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = pickStr(o, ["identifier", "modelKey", "key", "model", "path"]);
    if (!key) continue;
    const bk = baseKey(key);
    const queued = pickNum(o, [
      "numQueuedRequests",
      "queuedRequests",
      "queued",
      "queueLength",
      "predictionsQueued",
    ]);
    if (typeof queued === "number" && queued > 0) {
      queuedByKey.set(bk, Math.max(queuedByKey.get(bk) ?? 0, queued));
    }
    let isGen = false;
    const genBool = o.isGenerating ?? o.generating ?? o.busy;
    if (typeof genBool === "boolean") isGen = genBool;
    const status = pickStr(o, ["generationStatus", "status", "state"]);
    if (status) {
      const s = status.toLowerCase();
      if (/generat|running|busy|predict/.test(s) && !/idle|stopped|not/.test(s)) isGen = true;
    }
    if (isGen) generating.add(bk);
  }
  return { generating, queuedByKey };
}

// ── Probe ───────────────────────────────────────────────────────────────────

export type IdleSample = {
  /** 활성 추론이 감지됐는가(=대기해야 하는가). */
  active: boolean;
  reasons: string[];
  gpuUtilPct: number | null;
  gpuSignalAvailable: boolean;
  /** "지금 연산 중"을 판정 가능한 활성 신호(GPU/metrics/lms)가 하나라도 관측됐는가 → effective. */
  hasActiveSignal: boolean;
};

export type InFlightBaseline = {
  loadedIds: string[];
  expiresById: Record<string, number>;
};

export type InFlightSample = { contended: boolean; reasons: string[] };

export interface ContentionProbe {
  sampleIdle(signal?: AbortSignal): Promise<IdleSample>;
  segmentBaseline(signal?: AbortSignal): Promise<InFlightBaseline>;
  sampleInFlight(baseline: InFlightBaseline, signal?: AbortSignal): Promise<InFlightSample>;
}

export type MakeProbeOpts = {
  provider: ContentionProviderKind;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  cfg: ContentionConfig;
  fetchImpl?: typeof fetch;
  getGpu?: (timeoutMs?: number) => Promise<GpuSnapshot>;
  runLmsPs?: (timeoutMs?: number) => Promise<LmsExecResult>;
};

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** OpenAI 호환 base의 루트(/metrics 형제 경로용): 후행 슬래시·`/v1` 접미 제거. */
export function openAiRootFromBaseUrl(u: string): string {
  return u.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function loadedToBaseline(loaded: LoadedModelInfo[]): InFlightBaseline {
  const loadedIds = loaded.map((m) => m.id);
  const expiresById: Record<string, number> = {};
  for (const m of loaded) {
    const exp = m.raw?.["expires_at"];
    if (typeof exp === "string") {
      const t = Date.parse(exp);
      if (Number.isFinite(t)) expiresById[m.id] = t;
    }
  }
  return { loadedIds, expiresById };
}

export function makeContentionProbe(opts: MakeProbeOpts): ContentionProbe {
  const { provider, baseUrl, apiKey, modelId, cfg } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getGpu = opts.getGpu ?? getGpuSnapshot;
  const runLmsPs = opts.runLmsPs ?? lmsPs;
  const targetKey = provider === "lm_studio" ? baseKey(modelId) : modelId;

  // GPU는 *서버 머신*의 nvidia-smi를 읽으므로 대상이 동일 머신일 때만 유효.
  const gpuUsable = isTargetOnServerHost(baseUrl);
  // lms ps는 서버 로컬 LM Studio를 읽으므로 동일 머신 + env + CLI 활성 토글일 때만.
  const lmsUsable =
    cfg.lmsCliActivityEnabled &&
    provider === "lm_studio" &&
    isLmsCliEnabled() &&
    isTargetOnServerHost(baseUrl);
  // /metrics는 대상 서버의 네트워크 엔드포인트라 원격도 가능 — 단 vLLM/llama.cpp류만.
  const metricsCapable =
    cfg.serverMetricsEnabled && (provider === "openai_compatible" || provider === "manual");
  let metricsUnavailable = false;

  async function collectLoaded(): Promise<LoadedModelInfo[]> {
    if (provider === "ollama") {
      return (await collectOllamaLoaded(baseUrl, { fetchImpl })).loaded;
    }
    if (provider === "lm_studio") {
      return (await collectLmStudioLoaded(baseUrl, { apiKey, allowCli: false, fetchImpl })).loaded;
    }
    return [];
  }

  async function fetchConcurrency(
    signal?: AbortSignal,
  ): Promise<{ running: number; waiting: number } | null> {
    if (!metricsCapable || metricsUnavailable) return null;
    const root = openAiRootFromBaseUrl(baseUrl);
    const sig = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000);
    try {
      const r = await fetchImpl(`${root}/metrics`, { headers: authHeaders(apiKey), signal: sig });
      if (!r.ok) {
        metricsUnavailable = true;
        return null;
      }
      const parsed = parsePrometheusRunningWaiting(await r.text());
      if (!parsed) {
        metricsUnavailable = true;
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function lmsActivity(): Promise<LmsActivity | null> {
    if (!lmsUsable) return null;
    try {
      const r = await runLmsPs(5000);
      if (!r.ok || !r.stdout) return null;
      return parseLmsPsActivity(r.stdout);
    } catch {
      return null;
    }
  }

  async function gpu(): Promise<GpuSnapshot | null> {
    if (!gpuUsable) return null;
    try {
      return await getGpu();
    } catch {
      return null;
    }
  }

  return {
    async sampleIdle(signal?: AbortSignal): Promise<IdleSample> {
      const [loaded, metrics, lms, gpuSnap] = await Promise.all([
        collectLoaded(),
        fetchConcurrency(signal),
        lmsActivity(),
        gpu(),
      ]);
      const reasons: string[] = [];
      let active = false;
      let hasActiveSignal = false;
      let gpuUtilPct: number | null = null;
      let gpuSignalAvailable = false;

      if (gpuSnap && gpuSnap.available && gpuSnap.devices.length > 0) {
        gpuSignalAvailable = true;
        hasActiveSignal = true;
        gpuUtilPct = Math.max(...gpuSnap.devices.map((d) => d.utilizationPct));
        if (gpuUtilPct > cfg.gpuUtilThresholdPct) {
          active = true;
          reasons.push(`gpu_util=${Math.round(gpuUtilPct)}%`);
        }
      }
      if (metrics) {
        hasActiveSignal = true;
        if (metrics.running >= 1 || metrics.waiting >= 1) {
          active = true;
          reasons.push(`server_running=${metrics.running} waiting=${metrics.waiting}`);
        }
      }
      if (lms) {
        hasActiveSignal = true;
        const q = lms.queuedByKey.get(targetKey) ?? 0;
        if (lms.generating.size > 0 || q > 0) {
          active = true;
          reasons.push(
            `lms_generating=${[...lms.generating].join(",") || "-"} queued=${q}`,
          );
        }
      }
      if (!hasActiveSignal) {
        const foreignLoaded = loaded.some((m) =>
          (provider === "lm_studio" ? baseKey(m.id) : m.id) !== targetKey,
        );
        reasons.push(foreignLoaded ? "inventory_only_no_active_signal" : "no_contention_signal_available");
      }
      return { active, reasons, gpuUtilPct, gpuSignalAvailable, hasActiveSignal };
    },

    async segmentBaseline(): Promise<InFlightBaseline> {
      return loadedToBaseline(await collectLoaded());
    },

    async sampleInFlight(
      baseline: InFlightBaseline,
      signal?: AbortSignal,
    ): Promise<InFlightSample> {
      const [loaded, metrics, lms] = await Promise.all([
        collectLoaded(),
        fetchConcurrency(signal),
        lmsActivity(),
      ]);
      const reasons: string[] = [];
      let contended = false;

      // 서버 요청 수: 우리 기여=1 기대. running≥2 또는 waiting≥1 ⇒ 외부 동시 요청.
      if (metrics && (metrics.running >= 2 || metrics.waiting >= 1)) {
        contended = true;
        reasons.push(`server_running=${metrics.running} waiting=${metrics.waiting}`);
      }
      // lms: 우리 모델 generating은 기대값. 다른 모델 generating 또는 우리 모델 queued>0 ⇒ 경합.
      if (lms) {
        const foreignGen = [...lms.generating].filter((k) => k !== targetKey);
        const q = lms.queuedByKey.get(targetKey) ?? 0;
        if (foreignGen.length > 0 || q > 0) {
          contended = true;
          reasons.push(`lms_foreign_generating=${foreignGen.join(",") || "-"} queued=${q}`);
        }
      }
      // 로드 ID churn: baseline에 없던 모델 등장 ⇒ 외부 로드.
      const newIds = loaded.map((m) => m.id).filter((id) => !baseline.loadedIds.includes(id));
      if (newIds.length > 0) {
        contended = true;
        reasons.push(`new_model_loaded=${newIds.join(",")}`);
      }
      // Ollama expires_at 전진: 우리 요청 갱신분 넘어 전진 ⇒ 동일-모델 외부 요청(약).
      const cur = loadedToBaseline(loaded).expiresById;
      for (const [id, t] of Object.entries(cur)) {
        const prev = baseline.expiresById[id];
        if (typeof prev === "number" && t > prev) {
          contended = true;
          reasons.push(`expires_at_advanced=${id}`);
          break;
        }
      }
      return { contended, reasons };
    },
  };
}

// ── 대기 게이트 (async generator: 이벤트 yield + 결과 반환) ──────────────────

export type Clock = {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const defaultClock: Clock = { now: () => Date.now(), sleep: defaultSleep };

export type GatePhase = "pre_bench" | "between_iterations";

export type GateResult = {
  idle: boolean;
  waitedMs: number;
  effective: boolean;
  gpuSignalAvailable: boolean;
  baseline?: InFlightBaseline;
  /** 실패 시 오류 코드. */
  code?: "pre_bench_wait_timeout" | "between_iteration_wait_timeout" | "total_wait_budget_exceeded";
};

export type GateParams = {
  phase: GatePhase;
  scenarioId?: string;
  apiRoute?: "chat_completions" | "messages";
  /** 사전+이터 누적 대기(런 전역, 공유 객체). */
  waitAccum: { total: number };
};

/**
 * 유휴 확인 게이트. 첫 샘플이 유휴면 즉시 진행(추가 대기 0); busy면 대기 루프로 진입해
 * `requiredConsecutiveIdle` 연속 유휴가 확인될 때 재개한다. 예산·타임아웃은 루프 *내부*에서
 * 매 폴마다 검사한다(입구 검사만으론 슬립 중 초과를 못 막음).
 */
export async function* runIdleGate(
  probe: ContentionProbe,
  cfg: ContentionConfig,
  clock: Clock,
  params: GateParams,
): AsyncGenerator<StreamEvent, GateResult> {
  const start = clock.now();
  const thisTimeout =
    params.phase === "pre_bench" ? cfg.preBenchTimeoutMs : cfg.betweenIterationTimeoutMs;
  let sawBusy = false;
  let consecutiveIdle = 0;
  let lastReasonKey = "";
  let polls = 0;
  let effective = false;
  let gpuSignalAvailable = false;

  for (;;) {
    const s = await probe.sampleIdle();
    effective = s.hasActiveSignal;
    gpuSignalAvailable = s.gpuSignalAvailable;
    const waited = clock.now() - start;

    if (!s.active) {
      if (!sawBusy) {
        return {
          idle: true,
          waitedMs: 0,
          effective,
          gpuSignalAvailable,
          baseline: await probe.segmentBaseline(),
        };
      }
      consecutiveIdle++;
      if (consecutiveIdle >= cfg.requiredConsecutiveIdle) {
        yield {
          type: "contention_resumed",
          phase: params.phase,
          waited_ms: waited,
          scenario_id: params.scenarioId,
          api_route: params.apiRoute,
        };
        return {
          idle: true,
          waitedMs: waited,
          effective,
          gpuSignalAvailable,
          baseline: await probe.segmentBaseline(),
        };
      }
    } else {
      sawBusy = true;
      consecutiveIdle = 0;
      const reasonKey = s.reasons[0] ?? "busy";
      if (polls === 0 || reasonKey !== lastReasonKey || polls % 5 === 0) {
        yield {
          type: "contention_waiting",
          phase: params.phase,
          waiting_reason: reasonKey,
          reasons: s.reasons,
          gpu_util_pct: s.gpuUtilPct,
          gpu_signal_available: s.gpuSignalAvailable,
          elapsed_ms: waited,
          scenario_id: params.scenarioId,
          api_route: params.apiRoute,
        };
      }
      lastReasonKey = reasonKey;
    }
    polls++;

    if (params.waitAccum.total >= cfg.totalWaitBudgetMs) {
      return { idle: false, waitedMs: waited, effective, gpuSignalAvailable, code: "total_wait_budget_exceeded" };
    }
    if (clock.now() - start >= thisTimeout) {
      return {
        idle: false,
        waitedMs: waited,
        effective,
        gpuSignalAvailable,
        code:
          params.phase === "pre_bench"
            ? "pre_bench_wait_timeout"
            : "between_iteration_wait_timeout",
      };
    }
    await clock.sleep(cfg.pollIntervalMs);
    params.waitAccum.total += cfg.pollIntervalMs;
  }
}

// ── in-flight 백그라운드 모니터 ──────────────────────────────────────────────

export function startInflightMonitor(opts: {
  probe: ContentionProbe;
  baseline: InFlightBaseline;
  cfg: ContentionConfig;
  clock: Clock;
  onDetect: (reasons: string[]) => void;
}): () => Promise<void> {
  let stopRequested = false;
  // 슬립만 중단하는 컨트롤러 — teardown 시 빠르게 깨우되, 진행 중인 sampleInFlight는
  // 끝까지 기다려 양성 탐지를 잃지 않는다(자체 타임아웃 3~5s로 bounded).
  const sleepCtrl = new AbortController();
  const done = (async () => {
    for (;;) {
      try {
        await opts.clock.sleep(opts.cfg.pollIntervalMs, sleepCtrl.signal);
      } catch {
        /* 슬립이 teardown으로 중단됨 — 아래 stopRequested 확인으로 종료 */
      }
      if (stopRequested) return;
      try {
        // abort signal을 넘기지 않는다: teardown이 진행 중 in-flight 샘플을 abort해
        // 양성 탐지를 catch로 삼키는 것을 방지. 양성이면 stopRequested여도 honor한다.
        const s = await opts.probe.sampleInFlight(opts.baseline);
        if (s.contended) {
          opts.onDetect(s.reasons);
          return;
        }
      } catch {
        /* 일시적 probe 오류 무시 — 다음 폴에서 재시도 */
      }
      if (stopRequested) return;
    }
  })();
  // stop()은 async — 호출자는 await로 in-flight 샘플 결과까지 반영한 뒤 detected를 읽어야 한다.
  return async () => {
    stopRequested = true;
    sleepCtrl.abort();
    await done;
  };
}
