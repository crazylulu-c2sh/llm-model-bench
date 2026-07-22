import type { BenchRunMeta, DetectResult, LlmProfileFamily, SamplingPresetName, StreamEvent, ThinkingIntent } from "@llm-bench/shared";
import {
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  VISION_SCENARIO_IDS,
  getScenarioBenchMeta,
  inferLlmProfileFamily,
  isAgentScenario,
  isVisionScenario,
  outputTokensFromRun,
  providerSupportsLoadTtl,
  resolveBenchApiRoutes,
  resolveBenchProfile,
} from "@llm-bench/shared";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { toast, Toaster } from "sonner";
import type { SortingState } from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  History,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Monitor,
  Play,
  Square,
} from "lucide-react";
import type {
  BenchRunDetailResponse,
  LatestByModelResponse,
  RunSummary,
  RunsListResponse,
} from "./api-types";
import { BenchCharts } from "./components/BenchCharts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  rowsToChartData,
  scenarioRowKey,
  sortChartRowsForBarOrder,
  tokensPerSecondFromRun,
  type ChartRow,
  type CompareSeries,
} from "./components/chart-types";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";
import { DEFAULT_MODEL_TABLE_SORTING, ModelTable } from "./components/ModelTable";
import { ProviderSummary } from "./components/ProviderSummary";
import type { ResultRow } from "./components/ResultsTable";
import { ResultsTable } from "./components/ResultsTable";
import { Scoreboard } from "./components/Scoreboard";
import {
  BenchProgressPanel,
  type BenchCurrent,
  type BenchStepKind,
  type BenchStepLine,
} from "./components/BenchProgressPanel";
import { ScenarioDetailDrawer, type ScenarioDetailPayload } from "./components/ScenarioDetailDrawer";
import { ScenarioGuideCards } from "./components/ScenarioGuideCards";
import { AppHeader, pageTitleForPath } from "./components/AppHeader";
import { useI18n, msg } from "./i18n";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { readInitialUiState, saveUiSnapshot } from "./persisted-settings";
import { defaultScenarioPromptPreview, defaultScenarioSystemPromptPreview } from "./lib/scenario-prompt-preview";
import { ProfileDocPage } from "./ProfileDocPage";
import { ProviderMonitorPage } from "./ProviderMonitorPage";
// react-markdown 등을 메인 번들에서 분리 — /harness 첫 방문 시에만 로드
const HarnessDocPage = lazy(() => import("./HarnessDocPage"));
import { ScenariosDocPage } from "./ScenariosDocPage";
import { StatsPage } from "./StatsPage";
import { StressPage } from "./StressPage";
import { StressStatsPage } from "./StressStatsPage";
import { formatTimeWithMs } from "./lib/time-format";
import { useTheme } from "./useTheme";

type DetectModel = DetectResult["models"][number];

type MetricsAgg = {
  scenario_id: string;
  api_route: "chat_completions" | "messages";
  system_prompt?: string;
  user_prompt?: string;
  runs: Array<{
    ttft_ms: number | null;
    total_ms: number;
    output_text: string;
    stream_completed: boolean;
    usage_output_tokens?: number | null;
    reasoning_hidden?: boolean;
    tool_call_args_corrupted?: boolean;
    reasoning_leaked_into_content?: boolean;
    reasoning_chars?: number;
    empty_response?: boolean;
    channel_tag_leak_detected?: boolean;
    thinking_exhausted_budget?: boolean;
    empty_turn_count?: number;
    turns_to_completion?: number | null;
    valid_tool_call_rate?: number;
    tool_arg_hits?: number;
    tool_arg_attempts?: number;
    final_turn_output_tokens?: number;
    tool_call_counts?: Record<string, number>;
    agent_completion_reason?: "completed" | "stall" | "budget_exhausted";
    quality?: { pass: boolean; score?: number; reason?: string };
  }>;
};

function benchErrorHint(code: string): string | null {
  // 스트림 error 코드 → 힌트. ko가 shape 정의(Record<string,string>), 알 수 없는 코드는 null.
  return msg().bench.errors[code] ?? null;
}

function consumeSseJsonLines(
  stream: ReadableStream<Uint8Array>,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const block of parts) {
        for (const line of block.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const json = s.slice(5).trim();
          try {
            onEvent(JSON.parse(json) as StreamEvent);
          } catch {
            /* ignore */
          }
        }
      }
    }
  })();
}

/** 성능 측정 모드의 고정 출력 한도(토큰) — 처리량 비교 재현성을 위해 모든 모델 동일. */
const BENCH_THROUGHPUT_MAX_TOKENS = 512;

export function App() {
  const { choice: themeChoice, setChoice: setThemeChoice, resolved: themeResolved } = useTheme();
  const { m } = useI18n();
  const { pathname } = useLocation();
  const onBenchPage = pathname === "/";
  const isFirstRouteRef = useRef(true);
  useEffect(() => {
    document.title = pageTitleForPath(pathname, m);
    if (isFirstRouteRef.current) {
      // 첫 로드 시 포커스 강탈 금지 — 라우트 '변경' 시에만 본문으로 포커스 이동
      isFirstRouteRef.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: false });
  }, [pathname, m]);
  const [boot] = useState(() => readInitialUiState());
  const [baseUrl, setBaseUrl] = useState(boot.baseUrl);
  const [apiKey, setApiKey] = useState(boot.apiKey);
  const [persistApiKeyToDisk, setPersistApiKeyToDisk] = useState(boot.persistApiKeyToDisk);
  const [unloadOtherModels, setUnloadOtherModels] = useState(boot.unloadOtherModels);
  const [autoUnloadAfterBench, setAutoUnloadAfterBench] = useState(boot.autoUnloadAfterBench);
  const [loadTtlSeconds, setLoadTtlSeconds] = useState(boot.loadTtlSeconds);
  const [fitPolicy, setFitPolicy] = useState<"" | "skip" | "unload_other_models">(boot.fitPolicy);
  // 로드 TTL 입력(문자열)을 양의 정수로 파싱 — 페이로드에 실을 값. 빈/비정상 값은 미적용.
  const loadTtlSecondsNum = (() => {
    const n = Number(loadTtlSeconds);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  })();
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>(boot.selectedScenarioIds);
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(boot.scenarioPickerOpen);
  // #79/#83: 서버에 등록된 동적 시나리오(멀티턴 agent_loop + 사용자 커스텀). 마운트 시 1회 페치.
  const [dynamicScenarios, setDynamicScenarios] = useState<
    Array<{ id: string; source: string; isAgentLoop: boolean; maxTurns: number | null }>
  >([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/scenarios?set=all");
        if (!res.ok) return;
        const j = (await res.json()) as {
          scenarios?: Array<{ id: string; source?: string; isAgentLoop?: boolean; maxTurns?: number | null }>;
        };
        const dyn = (j.scenarios ?? [])
          .filter((s) => s.source === "custom" || s.isAgentLoop)
          .map((s) => ({
            id: s.id,
            source: s.source ?? "builtin",
            isAgentLoop: !!s.isAgentLoop,
            maxTurns: s.maxTurns ?? null,
          }));
        if (alive) setDynamicScenarios(dyn);
      } catch {
        /* 오프라인/서버 미가동 — 동적 시나리오 없이 진행 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const dynamicScenarioIds = useMemo(
    () => new Set(dynamicScenarios.map((d) => d.id)),
    [dynamicScenarios],
  );
  const toggleScenarioSelection = useCallback((id: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);
  const visibleSelectedScenarioIds = useMemo(
    () =>
      selectedScenarioIds.filter(
        (id) => (PUBLIC_SCENARIO_IDS as readonly string[]).includes(id) || dynamicScenarioIds.has(id),
      ),
    [selectedScenarioIds, dynamicScenarioIds],
  );
  const selectedTextCount = useMemo(
    () => visibleSelectedScenarioIds.filter((id) => !isVisionScenario(id) && !isAgentScenario(id)).length,
    [visibleSelectedScenarioIds],
  );
  const selectedVisionCount = useMemo(
    () => visibleSelectedScenarioIds.filter((id) => isVisionScenario(id)).length,
    [visibleSelectedScenarioIds],
  );
  const selectedAgentCount = useMemo(
    () => visibleSelectedScenarioIds.filter((id) => isAgentScenario(id)).length,
    [visibleSelectedScenarioIds],
  );
  const totalTextScenarios = useMemo(
    () => (PUBLIC_SCENARIO_IDS as string[]).filter((id) => !isVisionScenario(id)).length,
    [],
  );
  const agentScenarioIds = useMemo(
    () => dynamicScenarios.filter((d) => d.isAgentLoop).map((d) => d.id),
    [dynamicScenarios],
  );
  const [profileId, setProfileId] = useState<"auto" | LlmProfileFamily>(boot.profileId);
  const [profileMaxTokens, setProfileMaxTokens] = useState(boot.profileMaxTokens);
  const [thinkingIntent, setThinkingIntent] = useState<ThinkingIntent>(boot.thinkingIntent);
  const [preserveThinking, setPreserveThinking] = useState(boot.preserveThinking);
  /** 성능 측정 모드(처리량): 사고 off + chat_completions 단일 라우트 + 고정 max_tokens로 apples-to-apples 측정. */
  const [benchmarkThroughputMode, setBenchmarkThroughputMode] = useState(boot.benchmarkThroughputMode);
  /** 오염 가드: 다른 추론 감지 시 대기/폐기·재측정. */
  const [contentionGuardEnabled, setContentionGuardEnabled] = useState(boot.contentionGuardEnabled);
  const [contentionPreBenchTimeoutSec, setContentionPreBenchTimeoutSec] = useState(boot.contentionPreBenchTimeoutSec);
  const [contentionMaxRetries, setContentionMaxRetries] = useState(boot.contentionMaxRetries);
  const [reasoningEffort, setReasoningEffort] = useState<"minimal" | "low" | "medium" | "high">(boot.reasoningEffort);
  const [presetOverride, setPresetOverride] = useState<SamplingPresetName | "">(boot.presetOverride);
  const [samplingOverridesText, setSamplingOverridesText] = useState(boot.samplingOverridesText);
  const [profileAdvancedOpen, setProfileAdvancedOpen] = useState(boot.profileAdvancedOpen);
  const profileDetailsRef = useRef<HTMLDetailsElement>(null);
  const parseSamplingOverridesJson = useCallback((raw: string): Record<string, number> | null => {
    const t = raw.trim();
    if (!t) return null;
    try {
      const j = JSON.parse(t) as unknown;
      if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return Object.keys(out).length ? out : null;
    } catch {
      return null;
    }
  }, []);

  const buildBenchProfilePayload = useCallback(
    (modelId: string) => {
      const samplingOverrides = parseSamplingOverridesJson(samplingOverridesText);
      const maxTok = profileMaxTokens.trim() ? Number(profileMaxTokens) : NaN;
      const profileMaxTokensNum = Number.isFinite(maxTok) && maxTok > 0 ? Math.floor(maxTok) : undefined;
      const fam = profileId === "auto" ? inferLlmProfileFamily(modelId) : profileId;
      // 성능 측정 모드: 사고 off + 고정 출력 한도로 처리량을 apples-to-apples 비교. (라우트 제한은 요청 body의 apiRoutes로.)
      const effectiveThinking: ThinkingIntent = benchmarkThroughputMode ? "off" : thinkingIntent;
      const effectiveMaxTokens = benchmarkThroughputMode ? BENCH_THROUGHPUT_MAX_TOKENS : profileMaxTokensNum;
      return {
        profileId,
        profileMaxTokens: effectiveMaxTokens,
        thinkingIntent: effectiveThinking,
        preserveThinking: fam === "qwen36" && !benchmarkThroughputMode ? preserveThinking : false,
        reasoningEffort: fam === "gpt_oss" ? reasoningEffort : undefined,
        presetOverride: benchmarkThroughputMode ? undefined : presetOverride || undefined,
        samplingOverrides: samplingOverrides ?? undefined,
      };
    },
    [
      benchmarkThroughputMode,
      parseSamplingOverridesJson,
      presetOverride,
      preserveThinking,
      profileId,
      profileMaxTokens,
      reasoningEffort,
      samplingOverridesText,
      thinkingIntent,
    ],
  );
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<string[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  // 라이브 벤치는 단일 서버 대상 → detect.provider가 모든 모델에 균일. 스코어보드 백엔드 배지용.
  const providerByModel = useMemo(
    () => (detect ? new Map(rows.map((r) => [r.model_id, detect.provider])) : undefined),
    [detect, rows],
  );
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState("");
  const [hlPreview, setHlPreview] = useState(boot.hlPreview);
  const [hlLog, setHlLog] = useState(boot.hlLog);
  const [benchConfirmOpen, setBenchConfirmOpen] = useState(false);
  const [modelTableSorting, setModelTableSorting] = useState<SortingState>(() => DEFAULT_MODEL_TABLE_SORTING);
  const [modelOrderIds, setModelOrderIds] = useState<string[]>([]);
  const [benchQueueDraft, setBenchQueueDraft] = useState<DetectModel[]>([]);
  const [detailAggregate, setDetailAggregate] = useState<Record<string, MetricsAgg>>({});
  /** 라이브 SSE `scenario_start.system_prompt` */
  const [liveSystemPromptByRowKey, setLiveSystemPromptByRowKey] = useState<Record<string, string>>({});
  /** 라이브 SSE `scenario_start.user_prompt` — 번역 발췌 등 실제 user 메시지 */
  const [liveUserPromptByRowKey, setLiveUserPromptByRowKey] = useState<Record<string, string>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPayload, setDrawerPayload] = useState<ScenarioDetailPayload | null>(null);
  const [chartView, setChartView] = useState<"live" | "compare">("live");
  const [compareSeries, setCompareSeries] = useState<CompareSeries[] | null>(null);
  const [compareRaw, setCompareRaw] = useState<LatestByModelResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [serverRuns, setServerRuns] = useState<RunSummary[]>([]);
  const [serverRunsPanelOpen, setServerRunsPanelOpen] = useState(false);
  const [serverRunsLoading, setServerRunsLoading] = useState(false);
  const [benchStepLines, setBenchStepLines] = useState<BenchStepLine[]>([]);
  const [benchCurrent, setBenchCurrent] = useState<BenchCurrent | null>(null);
  /** 이번 벤치 런에서 `scenario_start`가 있었던 시나리오 id */
  const [touchedScenarioIds, setTouchedScenarioIds] = useState<string[]>([]);

  // 영속 저장 (debounce 350ms). `/stress` 등 다른 라우트에서는 게이트로 차단해
  // App의 stale state가 stress 페이지의 공유 키 변경(baseUrl/apiKey 등)을 되돌리는 회귀 방지.
  useEffect(() => {
    if (!onBenchPage) return;
    const t = window.setTimeout(() => {
      saveUiSnapshot({
        baseUrl,
        unloadOtherModels,
        autoUnloadAfterBench,
        loadTtlSeconds,
        fitPolicy,
        hlPreview,
        hlLog,
        persistApiKeyToDisk,
        apiKey,
        profileId,
        profileMaxTokens,
        thinkingIntent,
        preserveThinking,
        reasoningEffort,
        presetOverride,
        samplingOverridesText,
        profileAdvancedOpen,
        selectedScenarioIds,
        scenarioPickerOpen,
        benchmarkThroughputMode,
        contentionGuardEnabled,
        contentionPreBenchTimeoutSec,
        contentionMaxRetries,
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    onBenchPage,
    apiKey,
    baseUrl,
    hlLog,
    hlPreview,
    persistApiKeyToDisk,
    unloadOtherModels,
    autoUnloadAfterBench,
    loadTtlSeconds,
    fitPolicy,
    profileId,
    profileMaxTokens,
    thinkingIntent,
    preserveThinking,
    reasoningEffort,
    presetOverride,
    samplingOverridesText,
    profileAdvancedOpen,
    selectedScenarioIds,
    scenarioPickerOpen,
    benchmarkThroughputMode,
    contentionGuardEnabled,
    contentionPreBenchTimeoutSec,
    contentionMaxRetries,
  ]);

  // bench → 다른 라우트 전이 시 *즉시 flush*. 게이트가 debounce를 폐기해도 최종 값 보존.
  const latestBenchSnapshotRef = useRef({
    baseUrl,
    unloadOtherModels,
    autoUnloadAfterBench,
    loadTtlSeconds,
    fitPolicy,
    hlPreview,
    hlLog,
    persistApiKeyToDisk,
    apiKey,
    profileId,
    profileMaxTokens,
    thinkingIntent,
    preserveThinking,
    reasoningEffort,
    presetOverride,
    samplingOverridesText,
    profileAdvancedOpen,
    selectedScenarioIds,
    scenarioPickerOpen,
    benchmarkThroughputMode,
    contentionGuardEnabled,
    contentionPreBenchTimeoutSec,
    contentionMaxRetries,
  });
  latestBenchSnapshotRef.current = {
    baseUrl,
    unloadOtherModels,
    autoUnloadAfterBench,
    loadTtlSeconds,
    fitPolicy,
    hlPreview,
    hlLog,
    persistApiKeyToDisk,
    apiKey,
    profileId,
    profileMaxTokens,
    thinkingIntent,
    preserveThinking,
    reasoningEffort,
    presetOverride,
    samplingOverridesText,
    profileAdvancedOpen,
    selectedScenarioIds,
    scenarioPickerOpen,
    benchmarkThroughputMode,
    contentionGuardEnabled,
    contentionPreBenchTimeoutSec,
    contentionMaxRetries,
  };
  const prevOnBenchPageRef = useRef(onBenchPage);
  useEffect(() => {
    if (prevOnBenchPageRef.current && !onBenchPage) {
      saveUiSnapshot(latestBenchSnapshotRef.current);
    }
    prevOnBenchPageRef.current = onBenchPage;
  }, [onBenchPage]);

  // 다른 라우트 → bench 재진입 시 공유 필드 (baseUrl/apiKey/persistApiKeyToDisk)를
  // 디스크에서 다시 읽어 App state에 반영. /stress가 바꾼 값을 App input이 stale로 보여주지 않게.
  useEffect(() => {
    if (!onBenchPage) return;
    const latest = readInitialUiState();
    setBaseUrl(latest.baseUrl);
    setApiKey(latest.apiKey);
    setPersistApiKeyToDisk(latest.persistApiKeyToDisk);
  }, [onBenchPage]);

  useEffect(() => {
    const el = profileDetailsRef.current;
    if (el) el.open = profileAdvancedOpen;
  }, [profileAdvancedOpen]);

  const appendLog = useCallback((s: string) => {
    const stamped = `${formatTimeWithMs(Date.now())} ${s}`;
    setLog((prev) => [...prev.slice(-400), stamped]);
  }, []);

  useEffect(() => {
    if (!detect) {
      setModelOrderIds([]);
      setModelTableSorting(DEFAULT_MODEL_TABLE_SORTING);
      return;
    }
    setModelTableSorting(DEFAULT_MODEL_TABLE_SORTING);
    setModelOrderIds([]);
  }, [detect]);

  const handleSortedModelIdsChange = useCallback((ids: string[]) => {
    setModelOrderIds((prev) => {
      if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return prev;
      return ids;
    });
  }, []);

  const orderedSelectedModels = useMemo(() => {
    if (!detect) return [];
    const byId = new Map(detect.models.map((m: DetectModel) => [m.id, m]));
    const order = modelOrderIds.length > 0 ? modelOrderIds : detect.models.map((m: DetectModel) => m.id);
    const out: DetectModel[] = [];
    for (const id of order) {
      if (!selected[id]) continue;
      const m = byId.get(id);
      if (m) out.push(m);
    }
    return out;
  }, [detect, modelOrderIds, selected]);

  const activeBenchApiRoutes = useMemo(
    () =>
      detect
        ? resolveBenchApiRoutes(
            detect.capabilities,
            benchmarkThroughputMode ? ["chat_completions"] : undefined,
          )
        : [],
    [detect, benchmarkThroughputMode],
  );

  const pendingSkeletonRows = useMemo(() => {
    if (!running || activeBenchApiRoutes.length === 0) return [];
    const completedKeys = new Set(rows.map((r) => r.rowKey));
    const result: Array<{ rowKey: string; model_id: string; scenario: string; api: string }> = [];
    for (const model of benchQueueDraft) {
      for (const scenarioId of visibleSelectedScenarioIds) {
        for (const api of activeBenchApiRoutes) {
          const rk = scenarioRowKey(scenarioId, api, model.id);
          if (!completedKeys.has(rk)) {
            result.push({ rowKey: rk, model_id: model.id, scenario: scenarioId, api });
          }
        }
      }
    }
    return result;
  }, [running, rows, benchQueueDraft, visibleSelectedScenarioIds, activeBenchApiRoutes]);

  const profileHintByModelId = useMemo(() => {
    if (!detect) return {} as Record<string, { family: LlmProfileFamily; preset: SamplingPresetName }>;
    const out: Record<string, { family: LlmProfileFamily; preset: SamplingPresetName }> = {};
    for (const m of detect.models) {
      const inferred = inferLlmProfileFamily(m.id);
      const effectiveQwen36 =
        profileId === "auto" ? inferred === "qwen36" : profileId === "qwen36";
      const effectiveGptOss =
        profileId === "auto" ? inferred === "gpt_oss" : profileId === "gpt_oss";
      const resolved = resolveBenchProfile({
        modelId: m.id,
        taskMode: "general",
        thinkingIntent: thinkingIntent,
        preserveThinking: effectiveQwen36 ? preserveThinking : false,
        presetOverride: presetOverride || null,
        samplingOverrides: parseSamplingOverridesJson(samplingOverridesText),
        maxTokensOverride: profileMaxTokens.trim() ? Number(profileMaxTokens) : null,
        reasoningEffort: effectiveGptOss ? reasoningEffort : null,
        profileFamilyOverride: profileId === "auto" ? null : profileId,
      });
      const famLabel = profileId === "auto" ? inferred : profileId;
      out[m.id] = { family: famLabel, preset: resolved.preset };
    }
    return out;
  }, [
    detect,
    parseSamplingOverridesJson,
    presetOverride,
    preserveThinking,
    profileId,
    profileMaxTokens,
    reasoningEffort,
    samplingOverridesText,
    thinkingIntent,
  ]);

  const chartRows = useMemo(
    () =>
      sortChartRowsForBarOrder(
        rowsToChartData(
          rows.map((r) => {
            const last = detailAggregate[r.rowKey]?.runs?.at(-1);
            return {
              scenario: r.scenario,
              api: r.api,
              ttft_ms: r.ttft_ms,
              pass: r.pass,
              model_id: r.model_id,
              total_ms: last?.total_ms,
              output_text: last?.output_text,
              usage_output_tokens: last?.usage_output_tokens,
              reasoning_hidden: last?.reasoning_hidden,
            };
          }),
        ),
      ),
    [rows, detailAggregate],
  );

  const chartModelIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of chartRows) {
      if (r.modelId) s.add(r.modelId);
    }
    if (compareSeries) {
      for (const c of compareSeries) {
        if (c.modelId) s.add(c.modelId);
      }
    }
    return [...s].sort();
  }, [chartRows, compareSeries]);

  const [chartModelFilter, setChartModelFilter] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setChartModelFilter((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of chartModelIds) {
        next[id] = prev[id] === false ? false : true;
      }
      return next;
    });
  }, [chartModelIds.join("\0")]);

  const filteredChartRows = useMemo(
    () => chartRows.filter((r) => !r.modelId || chartModelFilter[r.modelId] !== false),
    [chartRows, chartModelFilter],
  );

  const filteredCompareSeries = useMemo(() => {
    if (!compareSeries) return null;
    return compareSeries.filter((s) => chartModelFilter[s.modelId] !== false);
  }, [compareSeries, chartModelFilter]);

  const openDrawerForRow = useCallback(
    (row: ResultRow) => {
      const agg = detailAggregate[row.rowKey];
      const runs = agg?.runs ?? [];
      const last = runs[runs.length - 1];
      const n = runs.length;
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.model_id,
        ttft_ms: row.ttft_ms,
        pass: row.pass,
        score: row.score ?? last?.quality?.score,
        qualityReason: row.reason ?? last?.quality?.reason,
        systemPrompt:
          agg?.system_prompt ??
          liveSystemPromptByRowKey[row.rowKey] ??
          defaultScenarioSystemPromptPreview(row.scenario),
        userPrompt:
          agg?.user_prompt ??
          liveUserPromptByRowKey[row.rowKey] ??
          defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
        reasoningHidden: row.reasoning_hidden ?? last?.reasoning_hidden,
        toolCallArgsCorrupted: row.tool_call_args_corrupted ?? last?.tool_call_args_corrupted,
        // #80: 일반화된 channel_tag_leak를 우선(구버전 런은 기존 reasoning_leaked_into_content로 폴백).
        reasoningLeakedIntoContent:
          row.channel_tag_leak_detected ??
          last?.channel_tag_leak_detected ??
          row.reasoning_leaked_into_content ??
          last?.reasoning_leaked_into_content,
        measuredRunIndex: n > 0 ? n : undefined,
        measuredRunTotal: n > 0 ? n : undefined,
      });
      setDrawerOpen(true);
    },
    [detailAggregate, liveSystemPromptByRowKey, liveUserPromptByRowKey],
  );

  const openFromChartRow = useCallback(
    (row: ChartRow) => {
      const key = scenarioRowKey(row.scenario, row.api, row.modelId);
      const tableRow = rows.find((r) => r.rowKey === key);
      if (tableRow) {
        openDrawerForRow(tableRow);
        return;
      }
      const agg = detailAggregate[key];
      const runs = agg?.runs ?? [];
      const last = runs[runs.length - 1];
      const n = runs.length;
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.modelId,
        ttft_ms: row.ttft != null && Number.isFinite(row.ttft) ? row.ttft : null,
        pass: row.pass,
        score: last?.quality?.score,
        qualityReason: last?.quality?.reason,
        systemPrompt:
          agg?.system_prompt ??
          liveSystemPromptByRowKey[key] ??
          defaultScenarioSystemPromptPreview(row.scenario),
        userPrompt:
          agg?.user_prompt ??
          liveUserPromptByRowKey[key] ??
          defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
        reasoningHidden: row.reasoningHidden ?? last?.reasoning_hidden,
        toolCallArgsCorrupted: last?.tool_call_args_corrupted,
        // #80: 상세 드로어의 "추론 누수" 신호를 일반화된 channel_tag_leak로 구동(구버전 런은 기존 플래그로 폴백).
        reasoningLeakedIntoContent: last?.channel_tag_leak_detected ?? last?.reasoning_leaked_into_content,
        measuredRunIndex: n > 0 ? n : undefined,
        measuredRunTotal: n > 0 ? n : undefined,
      });
      setDrawerOpen(true);
    },
    [detailAggregate, liveSystemPromptByRowKey, liveUserPromptByRowKey, openDrawerForRow, rows],
  );

  const openCompareCell = useCallback(
    (scenario: string, api: string, modelId?: string) => {
      if (!compareRaw) return;
      const items = modelId ? compareRaw.items.filter((it) => it.model_id === modelId) : compareRaw.items;
      for (const it of items) {
        if (!it.run) continue;
        const sc = it.run.scenarios.find((s) => s.id === scenario && s.api_route === api);
        if (!sc) continue;
        const runs = sc.runs ?? [];
        const last = runs[runs.length - 1];
        const n = runs.length;
        setDrawerPayload({
          title: `${scenario} / ${api} · ${it.model_id}`,
          scenario,
          api,
          modelId: it.model_id,
          ttft_ms: last?.ttft_ms ?? null,
          pass: last?.quality?.pass,
          score: last?.quality?.score,
          qualityReason: last?.quality?.reason,
          systemPrompt:
            sc.prompt_system_preview ?? defaultScenarioSystemPromptPreview(scenario),
          userPrompt: sc.prompt_preview ?? defaultScenarioPromptPreview(scenario),
          outputText: last?.output_text ?? "",
          reasoningHidden: last?.reasoning_hidden,
          toolCallArgsCorrupted: last?.tool_call_args_corrupted,
          // #80: 상세 드로어의 "추론 누수" 신호를 일반화된 channel_tag_leak로 구동(구버전 런은 기존 플래그로 폴백).
        reasoningLeakedIntoContent: last?.channel_tag_leak_detected ?? last?.reasoning_leaked_into_content,
          measuredRunIndex: n > 0 ? n : undefined,
          measuredRunTotal: n > 0 ? n : undefined,
        });
        setDrawerOpen(true);
        return;
      }
    },
    [compareRaw],
  );

  const loadCompareFromServer = useCallback(async () => {
    if (!detect) {
      toast.error(msg().bench.detectFirst);
      return;
    }
    const modelIds = orderedSelectedModels.map((m) => m.id);
    if (modelIds.length < 2) {
      toast.error(msg().bench.compareNeedTwoModels);
      return;
    }
    setCompareLoading(true);
    try {
      const u = new URL("/api/runs/latest-by-model", window.location.origin);
      u.searchParams.set("baseUrl", detect.baseUrl);
      u.searchParams.set("modelIds", modelIds.join(","));
      const res = await fetch(u.toString());
      if (!res.ok) {
        toast.error(msg().bench.compareApiError(res.status));
        return;
      }
      const data = (await res.json()) as LatestByModelResponse;
      if (data.sqlite_available === false) {
        toast.warning(msg().bench.sqliteUnavailableCompare);
        setCompareSeries(null);
        setCompareRaw(null);
        setChartView("live");
        return;
      }
      const series: CompareSeries[] = [];
      for (const it of data.items) {
        if (!it.run) continue;
        const label = detect.models.find((x: DetectModel) => x.id === it.model_id)?.label ?? it.model_id;
        const chartRowsForModel: ChartRow[] = (it.run.scenarios ?? [])
          .map((sc) => {
            const runs = sc.runs ?? [];
            const last = runs[runs.length - 1];
            if (!last) return null;
            return rowsToChartData([
              {
                scenario: sc.id,
                api: sc.api_route,
                ttft_ms: last.ttft_ms,
                pass: last.quality?.pass,
                model_id: it.model_id,
                total_ms: last.total_ms,
                output_text: last.output_text,
                usage_output_tokens: last.usage_output_tokens,
                reasoning_hidden: last.reasoning_hidden,
              },
            ])[0];
          })
          .filter((x): x is ChartRow => x != null);
        if (chartRowsForModel.length) {
          series.push({ modelId: it.model_id, label, rows: chartRowsForModel });
        }
      }
      if (series.length < 2) {
        toast.warning(msg().bench.compareFewerThanTwoStored);
        setCompareSeries(null);
        setCompareRaw(null);
        setChartView("live");
        return;
      }
      setCompareRaw(data);
      setCompareSeries(series);
      setChartView("compare");
      toast.success(msg().bench.compareLoaded);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCompareLoading(false);
    }
  }, [detect, orderedSelectedModels]);

  const refreshServerRuns = useCallback(async () => {
    setServerRunsLoading(true);
    try {
      const res = await fetch("/api/runs?limit=30");
      if (!res.ok) {
        toast.error(msg().bench.runsListError(res.status));
        return;
      }
      const j = (await res.json()) as RunsListResponse;
      setServerRuns(j.runs ?? []);
      setServerRunsPanelOpen(true);
      if (j.sqlite_available === false) {
        toast.warning(msg().bench.sqliteDisabledRunsList);
      } else {
        toast.success(msg().bench.serverRunsCount(j.runs?.length ?? 0));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setServerRunsLoading(false);
    }
  }, []);

  const openServerRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) {
        toast.error(msg().bench.runDetailError(res.status));
        return;
      }
      const detail = (await res.json()) as BenchRunDetailResponse;
      const sc = detail.scenarios[0];
      if (!sc) {
        toast.error(msg().bench.noScenarioData);
        return;
      }
      const runs = sc.runs ?? [];
      const last = runs[runs.length - 1];
      const n = runs.length;
      setDrawerPayload({
        title: `${sc.id} / ${sc.api_route} · ${detail.meta.model_id}`,
        scenario: sc.id,
        api: sc.api_route,
        modelId: String(detail.meta.model_id),
        ttft_ms: last?.ttft_ms ?? null,
        pass: last?.quality?.pass,
        score: last?.quality?.score,
        qualityReason: last?.quality?.reason,
        systemPrompt: sc.prompt_system_preview ?? defaultScenarioSystemPromptPreview(sc.id),
        userPrompt: sc.prompt_preview ?? defaultScenarioPromptPreview(sc.id),
        outputText: last?.output_text ?? "",
        reasoningHidden: last?.reasoning_hidden,
        toolCallArgsCorrupted: last?.tool_call_args_corrupted,
        // #80: 상세 드로어의 "추론 누수" 신호를 일반화된 channel_tag_leak로 구동(구버전 런은 기존 플래그로 폴백).
        reasoningLeakedIntoContent: last?.channel_tag_leak_detected ?? last?.reasoning_leaked_into_content,
        measuredRunIndex: n > 0 ? n : undefined,
        measuredRunTotal: n > 0 ? n : undefined,
      });
      setDrawerOpen(true);
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  const runDetect = useCallback(async () => {
    setDetecting(true);
    setDetect(null);
    setRows([]);
    setLog([]);
    setDetailAggregate({});
    setLiveSystemPromptByRowKey({});
    setLiveUserPromptByRowKey({});
    setCompareSeries(null);
    setCompareRaw(null);
    setChartView("live");
    try {
      const r = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const j = (await r.json()) as DetectResult | { error: unknown };
      if (!r.ok) {
        appendLog(`detect failed: ${JSON.stringify(j)}`);
        toast.error(msg().bench.detectFailed);
        return;
      }
      const d = j as DetectResult;
      setDetect(d);
      setBaseUrl(d.baseUrl);
      const sel: Record<string, boolean> = {};
      for (const m of d.models) sel[m.id] = false;
      setSelected(sel);
      appendLog(`provider=${d.provider} models=${d.models.length} reachability=${d.reachability?.state ?? "n/a"}`);
      const rch = d.reachability;
      if (rch?.state === "unreachable") {
        toast.error(rch.reason ?? msg().bench.unreachableDefault);
      } else if (rch?.state === "partial") {
        toast.warning(rch.reason ?? msg().bench.partialDefault);
      } else if (d.models.length === 0) {
        const hint =
          d.provider === "lm_studio" ? msg().bench.noModelsHintLmStudio : msg().bench.noModelsHintGeneric;
        toast.warning(msg().bench.detectedNoModels(hint));
      } else {
        toast.success(msg().bench.detectSuccess(d.provider, d.models.length));
      }
      saveUiSnapshot({
        baseUrl: d.baseUrl,
        unloadOtherModels,
        autoUnloadAfterBench,
        loadTtlSeconds,
        fitPolicy,
        hlPreview,
        hlLog,
        persistApiKeyToDisk,
        apiKey,
        profileId,
        profileMaxTokens,
        thinkingIntent,
        preserveThinking,
        reasoningEffort,
        presetOverride,
        samplingOverridesText,
        profileAdvancedOpen,
        selectedScenarioIds,
        scenarioPickerOpen,
        benchmarkThroughputMode,
        contentionGuardEnabled,
        contentionPreBenchTimeoutSec,
        contentionMaxRetries,
      });
    } catch (e) {
      appendLog(String(e));
      toast.error(msg().bench.detectRequestError);
    } finally {
      setDetecting(false);
    }
  }, [
    apiKey,
    appendLog,
    baseUrl,
    hlLog,
    hlPreview,
    persistApiKeyToDisk,
    unloadOtherModels,
    autoUnloadAfterBench,
    loadTtlSeconds,
    fitPolicy,
    profileId,
    profileMaxTokens,
    thinkingIntent,
    preserveThinking,
    reasoningEffort,
    presetOverride,
    samplingOverridesText,
    profileAdvancedOpen,
  ]);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const selectAllModels = useCallback((next: boolean, ids: string[]) => {
    setSelected((s) => {
      const o = { ...s };
      for (const id of ids) o[id] = next;
      return o;
    });
  }, []);

  const runBench = useCallback(async (modelsToRun: DetectModel[]) => {
    if (!detect) return;
    const models = modelsToRun;
    if (!models.length) {
      appendLog(msg().bench.selectModelToBench);
      toast.error(msg().bench.selectModelToBench);
      return;
    }
    setRunning(true);
    setRows([]);
    setDetailAggregate({});
    setLiveSystemPromptByRowKey({});
    setLiveUserPromptByRowKey({});
    setPreview("");
    setBenchStepLines([]);
    setBenchCurrent(null);
    setTouchedScenarioIds([]);
    let anyHttpFail = false;
    let streamErrorCount = 0;
    let streamIncomplete = false;
    for (const m of models) {
      appendLog(`bench start model=${m.id}`);
      setBenchCurrent({ modelId: m.id });
      let sawRunFinished = false;
      let streamMeta: BenchRunMeta | null = null;
      let lastScenarioStart: { sid: string; api: string } | null = null;
      let iterInScenario = 0;
      // 오염 폐기 후 같은 측정 인덱스를 재실행할 때 다음 scenario_start가 iter를 다시 올리지 않게 한다.
      let pendingRetry = false;
      const pushBenchLine = (kind: BenchStepKind, text: string) => {
        setBenchStepLines((prev) => [...prev.slice(-79), { ts: Date.now(), kind, text }]);
      };
      try {
        const r = await fetch("/api/bench/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detect,
            bench: {
              baseUrl: detect.baseUrl,
              apiKey: apiKey || undefined,
              provider: detect.provider,
              modelId: m.id,
              skipModelLoad: detect.provider !== "lm_studio",
              unloadOtherModels,
              autoUnloadAfterBench,
              ...(loadTtlSecondsNum ? { loadTtlSeconds: loadTtlSecondsNum } : {}),
              ...(fitPolicy ? { fitPolicy } : {}),
              publicAssetsOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
              scenarioIds: visibleSelectedScenarioIds,
              ...(benchmarkThroughputMode ? { apiRoutes: ["chat_completions"] as const } : {}),
              contentionGuardEnabled,
              ...(Number.isFinite(Number(contentionPreBenchTimeoutSec)) && contentionPreBenchTimeoutSec.trim()
                ? { contentionPreBenchTimeoutMs: Math.max(0, Math.floor(Number(contentionPreBenchTimeoutSec) * 1000)) }
                : {}),
              ...(Number.isFinite(Number(contentionMaxRetries)) && contentionMaxRetries.trim()
                ? { contentionMaxRetriesPerIteration: Math.max(0, Math.floor(Number(contentionMaxRetries))) }
                : {}),
              ...buildBenchProfilePayload(m.id),
            },
          }),
        });
        if (!r.ok || !r.body) {
          anyHttpFail = true;
          appendLog(`bench http error ${r.status}`);
          pushBenchLine("err", `HTTP ${r.status} · ${m.id}`);
          continue;
        }
        await consumeSseJsonLines(r.body, (ev) => {
          if (ev.type === "run_started") {
            sawRunFinished = false;
            streamMeta = ev.meta ?? null;
            lastScenarioStart = null;
            iterInScenario = 0;
            pendingRetry = false;
            const ridShort = ev.run_id.length > 28 ? `${ev.run_id.slice(0, 28)}…` : ev.run_id;
            pushBenchLine("info", msg().bench.eventRunStart(ridShort));
            setBenchCurrent({ modelId: m.id });
          }
          if (ev.type === "preflight_memory_fit") {
            // #81: 후보 로드 전 메모리-핏 예측 결과. skip이면 조용히 사라지지 않게 명확히 표시.
            const gb = (b: number | null) => (b != null ? `${(b / 1024 ** 3).toFixed(1)}GB` : "?");
            const detail = msg().bench.eventMemFitDetail(gb(ev.required_bytes), gb(ev.free_bytes));
            if (ev.action === "skip") {
              pushBenchLine("err", msg().bench.eventMemSkip(ev.model_id, detail));
              appendLog(`preflight skip ${ev.model_id}: ${ev.reason}`);
              toast.warning(`${ev.model_id}: ${ev.reason}`);
            } else if (ev.action === "unload_other_models") {
              pushBenchLine("info", msg().bench.eventMemUnloadOthers(ev.model_id, detail));
              appendLog(`preflight unload_other_models ${ev.model_id}: ${ev.reason}`);
            } else {
              appendLog(`preflight ${ev.model_id}: ${ev.reason} (${detail})`);
            }
          }
          if (ev.type === "model_loaded") {
            pushBenchLine("info", msg().bench.eventModelLoaded(ev.model_id));
            setBenchCurrent({ modelId: ev.model_id });
          }
          if (ev.type === "model_unloaded") {
            const st = ev.status != null ? String(ev.status) : "?";
            const phaseLabel =
              ev.phase === "after_bench"
                ? msg().bench.unloadPhaseAfterBench
                : ev.phase === "preflight_fit"
                  ? msg().bench.unloadPhasePreflightFit
                  : "";
            if (ev.ok) {
              appendLog(msg().bench.logUnloadDone(phaseLabel, ev.model_id, st));
              pushBenchLine("ok", msg().bench.eventUnloadDone(phaseLabel, ev.model_id, st));
            } else {
              appendLog(msg().bench.logUnloadFail(phaseLabel, ev.model_id, st));
              pushBenchLine("err", msg().bench.eventUnloadFail(phaseLabel, ev.model_id, st));
            }
          }
          if (ev.type === "scenario_start") {
            if (typeof ev.system_prompt === "string" && ev.system_prompt.length > 0) {
              setLiveSystemPromptByRowKey((prev) => ({
                ...prev,
                [scenarioRowKey(ev.scenario_id, ev.api_route, m.id)]: ev.system_prompt as string,
              }));
            }
            if (typeof ev.user_prompt === "string" && ev.user_prompt.length > 0) {
              setLiveUserPromptByRowKey((prev) => ({
                ...prev,
                [scenarioRowKey(ev.scenario_id, ev.api_route, m.id)]: ev.user_prompt as string,
              }));
            }
            const p = { sid: ev.scenario_id, api: ev.api_route };
            if (!lastScenarioStart || lastScenarioStart.sid !== p.sid || lastScenarioStart.api !== p.api) {
              iterInScenario = 1;
              lastScenarioStart = p;
            } else if (pendingRetry) {
              // 오염 재측정 — 같은 인덱스 재실행이므로 iter를 올리지 않는다.
            } else {
              iterInScenario += 1;
            }
            pendingRetry = false;
            const wr = streamMeta?.warmup_runs ?? 1;
            const mr = streamMeta?.measured_runs ?? 3;
            const phase: BenchCurrent["phase"] = iterInScenario <= wr ? "warmup" : "measured";
            const iterLabel =
              phase === "warmup"
                ? msg().bench.iterWarmup(iterInScenario, wr)
                : msg().bench.iterMeasured(Math.min(iterInScenario - wr, mr), mr);
            setBenchCurrent({
              modelId: m.id,
              scenario: p.sid,
              api: p.api,
              phase,
              iterLabel,
            });
            setTouchedScenarioIds((prev) => (prev.includes(p.sid) ? prev : [...prev, p.sid]));
            pushBenchLine("info", msg().bench.eventScenarioStart(p.sid, p.api, iterLabel));
          }
          if (ev.type === "run_finished") {
            sawRunFinished = true;
            pushBenchLine("ok", msg().bench.eventRunFinished(m.id));
            setBenchCurrent({ modelId: m.id });
          }
          if (ev.type === "token_delta") {
            setPreview((p) => (p + ev.text).slice(-8000));
          }
          if (ev.type === "contention_waiting") {
            const where = ev.phase === "pre_bench" ? msg().bench.waitPhasePre : msg().bench.waitPhaseBetween;
            const gpu = ev.gpu_util_pct != null ? ` · GPU ${ev.gpu_util_pct}%` : "";
            pushBenchLine(
              "warn",
              msg().bench.eventContentionWaiting(where, ev.waiting_reason, gpu, ev.elapsed_ms),
            );
          }
          if (ev.type === "contention_resumed") {
            pushBenchLine("ok", msg().bench.eventContentionResumed(ev.waited_ms));
          }
          if (ev.type === "iteration_discarded") {
            // 폐기된 부분 출력 미리보기 초기화 + 다음 scenario_start를 재측정으로 표시.
            setPreview("");
            if (ev.will_retry) pendingRetry = true;
            pushBenchLine(
              "warn",
              msg().bench.eventIterationDiscarded(ev.retry_count + 1, ev.max_retries, ev.scenario_id, ev.reason),
            );
          }
          if (ev.type === "contention_summary") {
            if (
              ev.total_iterations_discarded > 0 ||
              ev.max_pre_bench_wait_ms > 0 ||
              ev.max_between_iteration_wait_ms > 0 ||
              ev.abort_reason
            ) {
              const maxWait = Math.max(ev.max_pre_bench_wait_ms, ev.max_between_iteration_wait_ms);
              const eff = ev.guard_effective ? "" : msg().bench.guardIneffective;
              pushBenchLine(
                "info",
                msg().bench.eventContentionSummary(ev.total_iterations_discarded, maxWait, eff),
              );
            }
          }
          if (ev.type === "metrics_update") {
            const agg = ev.aggregate as MetricsAgg;
            if (!agg?.scenario_id || !agg?.api_route || !Array.isArray(agg.runs)) return;
            const apiLabel = agg.api_route === "chat_completions" ? "chat" : agg.api_route === "messages" ? "msg" : agg.api_route;
            setBenchCurrent({
              modelId: m.id,
              scenario: agg.scenario_id,
              api: agg.api_route,
              phase: "aggregate",
            });
            pushBenchLine("ok", msg().bench.eventAggregateDone(agg.scenario_id, apiLabel));
            const rowKey = scenarioRowKey(agg.scenario_id, agg.api_route, m.id);
            setDetailAggregate((prev) => ({ ...prev, [rowKey]: agg }));
            const runs = agg.runs;
            const last = runs[runs.length - 1];
            if (!last) return;
            const tpsSource =
              last.usage_output_tokens != null && last.usage_output_tokens > 0 ? "usage" : "approx";
            const outputTokens = outputTokensFromRun(last.output_text, last.usage_output_tokens);
            const tpsRaw = tokensPerSecondFromRun(last.total_ms, last.output_text, last.usage_output_tokens);
            const tps = tpsRaw > 0 ? Math.round(tpsRaw * 10) / 10 : null;
            setRows((prev) => {
              const filtered = prev.filter((x) => x.rowKey !== rowKey);
              return [
                ...filtered,
                {
                  rowKey,
                  model_id: m.id,
                  scenario: agg.scenario_id,
                  api: agg.api_route,
                  ttft_ms: last.ttft_ms ?? null,
                  output_tokens: outputTokens,
                  tps,
                  tps_source: tpsSource,
                  reasoning_hidden: last.reasoning_hidden,
                  tool_call_args_corrupted: last.tool_call_args_corrupted,
                  reasoning_leaked_into_content: last.reasoning_leaked_into_content,
                  channel_tag_leak_detected: last.channel_tag_leak_detected,
                  agent_completion_reason: last.agent_completion_reason,
                  turns_to_completion: last.turns_to_completion,
                  empty_turn_count: last.empty_turn_count,
                  thinking_exhausted_budget: last.thinking_exhausted_budget,
                  pass: last.quality?.pass,
                  score: last.quality?.score,
                  reason: last.quality?.reason,
                },
              ];
            });
          }
          if (ev.type === "error") {
            streamErrorCount += 1;
            appendLog(`error[${ev.layer}] ${ev.code}: ${ev.message}`);
            const hint = benchErrorHint(ev.code);
            const lineMessage = hint
              ? `${hint} · ${ev.message}`
              : ev.message;
            pushBenchLine(
              "err",
              `error[${ev.layer}] ${ev.code} — ${lineMessage.slice(0, 220)}`,
            );
          }
        });
        if (!sawRunFinished) {
          streamIncomplete = true;
          appendLog(msg().bench.logBenchIncomplete(m.id));
        }
      } catch (e) {
        anyHttpFail = true;
        appendLog(String(e));
        pushBenchLine("err", msg().bench.eventRequestFailed(m.id, String(e).slice(0, 200)));
      }
    }
    setRunning(false);
    appendLog("bench finished");
    if (anyHttpFail || streamErrorCount > 0 || streamIncomplete) {
      toast.warning(msg().bench.benchDoneWithIssues);
    } else {
      toast.success(msg().bench.benchAllDone);
    }
  }, [apiKey, appendLog, autoUnloadAfterBench, benchmarkThroughputMode, buildBenchProfilePayload, contentionGuardEnabled, contentionMaxRetries, contentionPreBenchTimeoutSec, detect, fitPolicy, loadTtlSecondsNum, unloadOtherModels, visibleSelectedScenarioIds]);

  const requestBench = useCallback(() => {
    if (!detect) return;
    if (visibleSelectedScenarioIds.length === 0) {
      toast.error(msg().bench.selectScenarioToRun);
      return;
    }
    const models = orderedSelectedModels;
    if (!models.length) {
      toast.error(msg().bench.selectModelToBench);
      return;
    }
    setBenchQueueDraft([...models]);
    setBenchConfirmOpen(true);
  }, [detect, orderedSelectedModels, visibleSelectedScenarioIds.length]);

  const handleConfirmBench = useCallback(() => {
    setBenchConfirmOpen(false);
    void runBench(benchQueueDraft);
  }, [benchQueueDraft, runBench]);

  const moveBenchQueueDraft = useCallback((index: number, delta: -1 | 1) => {
    setBenchQueueDraft((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const logText = log.join("\n");
  const benchProgress = useMemo(() => {
    const routeCount = Math.max(activeBenchApiRoutes.length, 1);
    const total = benchQueueDraft.length * visibleSelectedScenarioIds.length * routeCount;
    const completed = rows.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, pct };
  }, [
    benchQueueDraft.length,
    visibleSelectedScenarioIds.length,
    activeBenchApiRoutes.length,
    rows.length,
  ]);
  const benchLiveSoft = "bench-live-panel--soft";
  const benchMetricsPanelsClass = running && rows.length > 0 ? benchLiveSoft : "";
  const benchPreviewPanelClass = running && preview.length > 0 ? benchLiveSoft : "";
  const benchProgressClass = running ? benchLiveSoft : "";
  const benchStartReady = !running && !!detect && visibleSelectedScenarioIds.length > 0;
  const benchStartEmphasis = benchStartReady || running;
  const samplingOverridesInvalid =
    samplingOverridesText.trim().length > 0 && parseSamplingOverridesJson(samplingOverridesText) === null;

  const detectButton = (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
      onClick={() => void runDetect()}
      disabled={detecting}
      aria-busy={detecting}
      aria-label={msg().bench.detectAria}
    >
      {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      {msg().bench.detectButton}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--foreground)]">
      <Toaster richColors theme={themeResolved} position="bottom-right" closeButton />
      <ConfirmDialog
        open={benchConfirmOpen}
        title={msg().bench.runSelected}
        confirmLabel={msg().bench.confirmRun}
        onCancel={() => setBenchConfirmOpen(false)}
        onConfirm={handleConfirmBench}
      >
        {detect ? (
          <>
            <p>
              {msg().bench.confirmOrderLabel}
              <strong className="text-[var(--foreground)]">{benchQueueDraft.length}</strong>
              {msg().bench.confirmOrderUnit}
              {detect.provider === "lm_studio" ? msg().bench.confirmLmStudioLoadNote : ""}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">{msg().bench.confirmReorderHint}</p>
            <ol className="mt-2 max-h-48 list-decimal space-y-1.5 overflow-y-auto overscroll-contain pl-5 text-[var(--foreground)]">
              {benchQueueDraft.map((m, i) => (
                <li key={m.id} className="font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{m.id}</span>
                      {m.label && m.label !== m.id ? (
                        <span className="truncate font-sans text-[10px] text-[var(--muted)]">{m.label}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
                        aria-label={msg().bench.moveUpAria(m.id)}
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBenchQueueDraft(i, -1);
                        }}
                      >
                        <ChevronUp className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
                        aria-label={msg().bench.moveDownAria(m.id)}
                        disabled={i === benchQueueDraft.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBenchQueueDraft(i, 1);
                        }}
                      >
                        <ChevronDown className="size-4" aria-hidden />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <ul className="mt-2 space-y-1 text-xs">
              {unloadOtherModels && detect.provider === "lm_studio" ? (
                <li>{msg().bench.confirmUnloadOthersOn}</li>
              ) : null}
              {autoUnloadAfterBench && detect.provider === "lm_studio" ? (
                <li>{msg().bench.confirmAutoUnloadOn}</li>
              ) : null}
              {loadTtlSecondsNum && providerSupportsLoadTtl(detect.provider) ? (
                <li>
                  {msg().bench.confirmLoadTtl(
                    loadTtlSecondsNum,
                    detect.provider === "lm_studio" ? "LM Studio load ttl" : "Ollama keep_alive",
                  )}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-white"
      >
        {msg().common.skipToContent}
      </a>
      <AppHeader
        themeChoice={themeChoice}
        setThemeChoice={setThemeChoice}
        running={running}
        benchProgress={running ? benchProgress : undefined}
      />

      <main id="main" tabIndex={-1} className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 outline-none">
        <ErrorBoundary resetKeys={[pathname]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <Link2 className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
                Base URL
              </span>
              <div className="flex min-w-0 flex-wrap items-stretch gap-2">
                <input
                  inputMode="url"
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                {detectButton}
              </div>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <KeyRound className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
                {msg().bench.apiKeyLabel}
              </span>
              <input
                type="password"
                autoComplete="off"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={msg().bench.apiKeyPlaceholder}
              />
            </label>
          </div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              className="mt-1"
              checked={persistApiKeyToDisk}
              onChange={(e) => setPersistApiKeyToDisk(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">{msg().bench.persistApiKeyLabel}</span>
              <span className="mt-1 flex items-start gap-1 text-xs leading-snug">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
                {msg().bench.persistApiKeyHintA}
                <code className="rounded bg-[var(--surface)] px-1">sessionStorage</code>
                {msg().bench.persistApiKeyHintB}
                <code className="rounded bg-[var(--surface)] px-1">localStorage</code>
                {msg().bench.persistApiKeyHintC}
              </span>
            </span>
          </label>
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <button
              type="button"
              onClick={() => setScenarioPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={scenarioPickerOpen}
            >
              <span className="font-medium text-[var(--foreground)]">
                {msg().bench.runScenariosLabel}{" "}
                <span className={visibleSelectedScenarioIds.length === 0 ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
                  ({visibleSelectedScenarioIds.length}/{PUBLIC_SCENARIO_IDS.length + dynamicScenarios.length})
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--muted)]">
                  {msg().bench.categoryText} {selectedTextCount}/{totalTextScenarios}
                </span>
                <span
                  className={[
                    "rounded px-1.5 py-0.5",
                    selectedVisionCount > 0
                      ? "bg-[var(--accent)]/15 text-[var(--accent-2)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)]",
                  ].join(" ")}
                >
                  {msg().bench.categoryVision} {selectedVisionCount}/{VISION_SCENARIO_IDS.length}
                </span>
                {agentScenarioIds.length > 0 ? (
                  <span
                    className={[
                      "rounded px-1.5 py-0.5",
                      selectedAgentCount > 0
                        ? "bg-[var(--accent)]/15 text-[var(--accent-2)]"
                        : "bg-[var(--surface-2)] text-[var(--muted)]",
                    ].join(" ")}
                  >
                    {msg().bench.categoryAgent} {selectedAgentCount}/{agentScenarioIds.length}
                  </span>
                ) : null}
                <span className="text-[var(--muted)]" aria-hidden>{scenarioPickerOpen ? "▴" : "▾"}</span>
              </span>
            </button>
            {visibleSelectedScenarioIds.length === 0 && !scenarioPickerOpen ? (
              <p className="mt-2 text-xs text-[var(--danger)]">
                {msg().bench.scenarioRequiredHint}
              </p>
            ) : null}
            {scenarioPickerOpen ? (
              <div className="mt-2 space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  {(() => {
                    const allDefaultSelected = DEFAULT_SCENARIO_IDS.every(id => selectedScenarioIds.includes(id));
                    const allVisionSelected = VISION_SCENARIO_IDS.every(id => selectedScenarioIds.includes(id));
                    const allAgentSelected = agentScenarioIds.length > 0 && agentScenarioIds.every(id => selectedScenarioIds.includes(id));
                    return (
                      <>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() => {
                      if (allDefaultSelected) {
                        setSelectedScenarioIds(prev => prev.filter(id => !(DEFAULT_SCENARIO_IDS as string[]).includes(id)));
                      } else {
                        setSelectedScenarioIds(prev => [...new Set([...prev, ...DEFAULT_SCENARIO_IDS])]);
                      }
                    }}
                    title={msg().bench.toggleTextTitle(DEFAULT_SCENARIO_IDS.length)}
                  >
                    <MessageSquare className="size-3" aria-hidden />
                    {msg().bench.textCountButton(DEFAULT_SCENARIO_IDS.length)}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() => {
                      if (allVisionSelected) {
                        setSelectedScenarioIds(prev => prev.filter(id => !(VISION_SCENARIO_IDS as string[]).includes(id)));
                      } else {
                        setSelectedScenarioIds(prev => [...new Set([...prev, ...VISION_SCENARIO_IDS])]);
                      }
                    }}
                    title={msg().bench.toggleVisionTitle(VISION_SCENARIO_IDS.length)}
                  >
                    <Eye className="size-3" aria-hidden />
                    {msg().bench.visionCountButton(VISION_SCENARIO_IDS.length)}
                  </button>
                  {agentScenarioIds.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                        onClick={() => {
                          if (allAgentSelected) {
                            setSelectedScenarioIds(prev => prev.filter(id => !agentScenarioIds.includes(id)));
                          } else {
                            setSelectedScenarioIds(prev => [...new Set([...prev, ...agentScenarioIds])]);
                          }
                        }}
                        title={msg().bench.toggleAgentTitle}
                      >
                        <Bot className="size-3" aria-hidden />
                        {msg().bench.agentCountButton(agentScenarioIds.length)}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                        onClick={() =>
                          setSelectedScenarioIds([
                            ...DEFAULT_SCENARIO_IDS,
                            ...VISION_SCENARIO_IDS,
                            ...agentScenarioIds,
                          ])
                        }
                        title={msg().bench.selectAllCategoriesTitle}
                      >
                        <CheckSquare className="size-3" aria-hidden />
                        {msg().bench.selectAllCountButton(
                          DEFAULT_SCENARIO_IDS.length + VISION_SCENARIO_IDS.length + agentScenarioIds.length,
                        )}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() => setSelectedScenarioIds([])}
                  >
                    <Square className="size-3" aria-hidden />
                    {msg().bench.clearAll}
                  </button>
                      </>
                    );
                  })()}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">{msg().bench.textScenariosHeading}</div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {(PUBLIC_SCENARIO_IDS as string[])
                      .filter((id) => !isVisionScenario(id))
                      .map((id) => {
                        const meta = getScenarioBenchMeta(id);
                        const checked = selectedScenarioIds.includes(id);
                        return (
                          <label key={id} className="flex items-start gap-2 text-xs text-[var(--muted)]">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggleScenarioSelection(id)}
                            />
                            <span>
                              <span className="font-mono text-[var(--foreground)]">{id}</span>
                              {meta ? <span className="ml-1">— {meta.purposeKo.slice(0, 60)}</span> : null}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">
                    {msg().bench.visionScenariosHeading}{" "}
                    <span className="text-[var(--muted)]">
                      {msg().bench.visionScenariosNote}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {(VISION_SCENARIO_IDS as string[]).map((id) => {
                      const meta = getScenarioBenchMeta(id);
                      const checked = selectedScenarioIds.includes(id);
                      return (
                        <label key={id} className="flex items-start gap-2 text-xs text-[var(--muted)]">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={() => toggleScenarioSelection(id)}
                          />
                          <span>
                            <span className="font-mono text-[var(--foreground)]">{id}</span>
                            {meta ? <span className="ml-1">— {meta.purposeKo.slice(0, 60)}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                {dynamicScenarios.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">
                      {msg().bench.customAgentScenariosHeading}{" "}
                      <span className="text-[var(--muted)]">{msg().bench.customAgentScenariosNote}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {dynamicScenarios.map((s) => {
                        const checked = selectedScenarioIds.includes(s.id);
                        return (
                          <label key={s.id} className="flex items-start gap-2 text-xs text-[var(--muted)]">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggleScenarioSelection(s.id)}
                            />
                            <span>
                              <span className="font-mono text-[var(--foreground)]">{s.id}</span>
                              {s.isAgentLoop ? (
                                <span className="ml-1">— agent_loop · maxTurns {s.maxTurns ?? "?"}</span>
                              ) : (
                                <span className="ml-1">— custom</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]"
            title={detect?.provider === "lm_studio" ? msg().bench.unloadOthersTitleLmStudio : msg().bench.onlyLmStudio}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={unloadOtherModels}
              disabled={detect?.provider !== "lm_studio"}
              onChange={(e) => setUnloadOtherModels(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">{msg().bench.unloadOthersLabel}</span>
              <span className="mt-1 flex items-start gap-1 text-xs leading-snug">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
                {msg().bench.unloadOthersHint}
                {detect && detect.provider !== "lm_studio" ? msg().bench.inactiveOnCurrentProvider : ""}
              </span>
            </span>
          </label>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]"
            title={detect?.provider === "lm_studio" ? msg().bench.autoUnloadTitleLmStudio : msg().bench.onlyLmStudio}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={autoUnloadAfterBench}
              disabled={detect?.provider !== "lm_studio"}
              onChange={(e) => setAutoUnloadAfterBench(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">{msg().bench.autoUnloadLabel}</span>
              <span className="mt-0.5 block text-xs leading-snug">
                {msg().bench.autoUnloadHint}
                {detect && detect.provider !== "lm_studio" ? msg().bench.inactiveOnCurrentProvider : ""}
              </span>
            </span>
          </label>
          <div
            className="mt-2 flex items-start gap-2 text-sm text-[var(--muted)]"
            title={msg().bench.memFitTitle}
          >
            <span className="mt-1 flex-1">
              <span id="fit-policy-label" className="font-medium text-[var(--foreground)]">{msg().bench.memFitLabel}</span>
              <span className="mt-0.5 block text-xs leading-snug">
                {msg().bench.memFitHintA}<b>{msg().bench.memFitUnload}</b>{msg().bench.memFitHintB}<b>{msg().bench.memFitSkip}</b>{msg().bench.memFitHintC}
                {detect && detect.provider !== "lm_studio" ? msg().bench.inactiveOnCurrentProvider : ""}
              </span>
            </span>
            <select
              className="mt-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
              value={fitPolicy}
              disabled={detect?.provider !== "lm_studio"}
              aria-labelledby="fit-policy-label"
              onChange={(e) => setFitPolicy(e.target.value as "" | "skip" | "unload_other_models")}
            >
              <option value="">{msg().bench.memFitOptionLog}</option>
              <option value="unload_other_models">{msg().bench.memFitUnload}</option>
              <option value="skip">{msg().bench.memFitOptionSkip}</option>
            </select>
          </div>
          <div
            className="mt-2 flex items-start gap-2 text-sm text-[var(--muted)]"
            title={msg().bench.loadTtlTitle}
          >
            <span className="mt-1 flex-1">
              <span id="load-ttl-label" className="font-medium text-[var(--foreground)]">{msg().bench.loadTtlLabel}</span>
              <span className="mt-0.5 block text-xs leading-snug">
                {msg().bench.loadTtlHintA}<code>ttl</code>{msg().bench.loadTtlHintB}<code>keep_alive</code>{msg().bench.loadTtlHintC}<code>/v1</code>{msg().bench.loadTtlHintD}
                {detect && !providerSupportsLoadTtl(detect.provider) ? msg().bench.inactiveOnCurrentProvider : ""}
              </span>
            </span>
            <input
              type="number"
              min={1}
              step={1}
              placeholder={msg().bench.notApplied}
              className="mt-1 w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
              value={loadTtlSeconds}
              disabled={!detect || !providerSupportsLoadTtl(detect.provider)}
              aria-labelledby="load-ttl-label"
              onChange={(e) => setLoadTtlSeconds(e.target.value)}
            />
          </div>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]"
            title={msg().bench.contentionGuardTitle}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={contentionGuardEnabled}
              onChange={(e) => setContentionGuardEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">{msg().bench.contentionGuardLabel}</span>
              <span className="mt-0.5 block text-xs leading-snug">
                {msg().bench.contentionGuardHint}
              </span>
            </span>
          </label>
          {contentionGuardEnabled ? (
            <div className="mt-2 ml-6 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
              <label className="flex items-center gap-1.5">
                {msg().bench.preBenchTimeoutLabel}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  value={contentionPreBenchTimeoutSec}
                  onChange={(e) => setContentionPreBenchTimeoutSec(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1.5">
                {msg().bench.retriesPerRunLabel}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={5}
                  className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  value={contentionMaxRetries}
                  onChange={(e) => setContentionMaxRetries(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          {detect ? <ProviderSummary detect={detect} /> : null}
        </section>

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <h2 className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <span className="inline-flex items-center gap-2">
              <Monitor className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              {msg().bench.modelSelectHeading}
            </span>
            <NavLink
              to="/profile"
              className="shrink-0 text-xs font-normal text-[var(--accent-2)] no-underline hover:underline"
            >
              {msg().bench.profileDetailLink}
            </NavLink>
          </h2>
          <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid min-w-0 gap-1">
              <span className="text-xs font-medium text-[var(--muted)]">{msg().bench.profile}</span>
              <select
                className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value as "auto" | LlmProfileFamily)}
                aria-label={msg().bench.profileSelectAria}
              >
                <option value="auto">{msg().bench.profileAuto}</option>
                <option value="gemma4">Gemma 4</option>
                <option value="qwen35">Qwen 3.5</option>
                <option value="qwen36">Qwen 3.6</option>
                <option value="gpt_oss">gpt-oss</option>
                <option value="minimax">MiniMax</option>
                <option value="nemotron3">Nemotron 3</option>
                <option value="qwen3_coder_next">Qwen3-Coder-Next</option>
                <option value="glm47_flash">GLM-4.7-Flash</option>
                <option value="unknown">{msg().bench.profileUnknown}</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="text-xs font-medium text-[var(--muted)]">{msg().bench.thinkingIntentLabel}</span>
              <select
                className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--foreground)] disabled:opacity-50"
                value={benchmarkThroughputMode ? "off" : thinkingIntent}
                disabled={benchmarkThroughputMode}
                title={benchmarkThroughputMode ? msg().bench.thinkingLockedTitle : undefined}
                onChange={(e) => setThinkingIntent(e.target.value as ThinkingIntent)}
              >
                <option value="on">{msg().bench.thinkingOn}</option>
                <option value="off">{msg().bench.thinkingOff}</option>
              </select>
            </label>
            <label className="flex min-w-0 cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2 lg:col-span-3">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={benchmarkThroughputMode}
                disabled={detect != null && !detect.capabilities.openaiChat}
                onChange={(e) => setBenchmarkThroughputMode(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="font-medium text-[var(--foreground)]">{msg().bench.throughputModeLabel}</span>
                <span className="mt-0.5 block leading-snug">
                  {msg().bench.throughputHintA}<strong>off</strong> · <code className="font-mono">chat_completions</code>{msg().bench.throughputHintB}<strong>{BENCH_THROUGHPUT_MAX_TOKENS}</strong>{msg().bench.throughputHintC}
                  {detect != null && !detect.capabilities.openaiChat ? (
                    <span className="block text-[var(--danger)]">{msg().bench.throughputNoChatRoute}</span>
                  ) : null}
                </span>
              </span>
            </label>
            {profileId === "auto" || profileId === "gpt_oss" ? (
              <label className="grid min-w-0 gap-1">
                <span className="text-xs font-medium text-[var(--muted)]">gpt-oss reasoning_effort</span>
                <select
                  className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--foreground)] disabled:opacity-50"
                  value={reasoningEffort}
                  disabled={profileId !== "auto" && profileId !== "gpt_oss"}
                  onChange={(e) => setReasoningEffort(e.target.value as typeof reasoningEffort)}
                >
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            ) : null}
            <label className="grid min-w-0 gap-1 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-[var(--muted)]">{msg().bench.maxTokensLabel}</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs"
                inputMode="numeric"
                value={profileMaxTokens}
                onChange={(e) => setProfileMaxTokens(e.target.value.replace(/[^\d]/g, ""))}
                placeholder={msg().bench.maxTokensPlaceholder}
              />
            </label>
            {profileId === "auto" || profileId === "qwen36" ? (
              <label className="flex min-w-0 cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2 lg:col-span-3">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={preserveThinking}
                  disabled={profileId !== "auto" && profileId !== "qwen36"}
                  onChange={(e) => setPreserveThinking(e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="font-medium text-[var(--foreground)]">Qwen3.6: preserve_thinking</span>
                  <span className="mt-0.5 block leading-snug">{msg().bench.preserveThinkingHint}</span>
                </span>
              </label>
            ) : null}
            <details
              ref={profileDetailsRef}
              className="sm:col-span-2 lg:col-span-3"
              open={profileAdvancedOpen}
              onToggle={(e) => setProfileAdvancedOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">{msg().bench.advancedSummary}</summary>
              <div className="mt-2 grid gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--muted)]">{msg().bench.presetOverrideLabel}</span>
                  <select
                    className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs"
                    value={presetOverride}
                    onChange={(e) => setPresetOverride((e.target.value || "") as SamplingPresetName | "")}
                  >
                    <option value="">{msg().bench.presetAuto}</option>
                    <option value="default">default</option>
                    <option value="thinking_general">thinking_general</option>
                    <option value="thinking_coding">thinking_coding</option>
                    <option value="nonthinking_general">nonthinking_general</option>
                    <option value="tool_call">tool_call</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--muted)]">{msg().bench.samplingOverridesLabel}</span>
                  <textarea
                    className="min-h-[4.5rem] rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[11px] leading-snug text-[var(--foreground)]"
                    value={samplingOverridesText}
                    onChange={(e) => setSamplingOverridesText(e.target.value)}
                    placeholder='{"temperature":0.8,"top_p":0.9}'
                    spellCheck={false}
                    aria-invalid={samplingOverridesInvalid}
                    aria-describedby={samplingOverridesInvalid ? "sampling-overrides-error" : undefined}
                  />
                  {samplingOverridesInvalid ? (
                    <span id="sampling-overrides-error" className="text-xs text-[var(--danger)]">
                      {msg().bench.samplingOverridesInvalid}
                    </span>
                  ) : null}
                </label>
              </div>
            </details>
          </div>
          {detecting ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              {msg().bench.detecting}
            </p>
          ) : detect && detect.models.length > 0 ? (
            <>
              <div className="mb-3 flex justify-end">{detectButton}</div>
              <ModelTable
                models={detect.models}
                selected={selected}
                onToggle={toggle}
                onSelectAll={selectAllModels}
                sorting={modelTableSorting}
                onSortingChange={setModelTableSorting}
                onSortedModelIdsChange={handleSortedModelIdsChange}
                selectionDisabled={running}
                profileHintByModelId={profileHintByModelId}
                benchActiveModelId={running ? benchCurrent?.modelId ?? null : null}
                benchRunning={running}
              />
            </>
          ) : detect && detect.models.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-[var(--muted)]">
              <p>
                {msg().bench.noModelsPrefix}<strong className="text-[var(--foreground)]">{msg().bench.detectButton}</strong>{msg().bench.noModelsSuffix}
              </p>
              {detectButton}
            </div>
          ) : (
            <div
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]"
              aria-live="polite"
            >
              <p>
                {msg().bench.emptyModelsPrefix}<strong className="text-[var(--foreground)]">{msg().bench.detectButton}</strong>{msg().bench.emptyModelsSuffix}
              </p>
              {detectButton}
            </div>
          )}
        </section>

        <div className="space-y-2">
          <div className="flex justify-end">
            <NavLink
              to={
                running && benchCurrent?.scenario
                  ? `/scenarios#${benchCurrent.scenario}`
                  : "/scenarios"
              }
              className="text-xs text-[var(--accent-2)] no-underline hover:underline"
            >
              {msg().bench.scenarioDetailDocLink}
            </NavLink>
          </div>
          <ScenarioGuideCards
            currentScenario={running ? benchCurrent?.scenario : null}
            running={running}
            touchedScenarioIds={touchedScenarioIds}
          />
        </div>

        <BenchProgressPanel
          className={benchProgressClass}
          running={running}
          current={benchCurrent}
          lines={benchStepLines}
          progress={running ? benchProgress : undefined}
          benchAction={
            <button
              type="button"
              className={[
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-50",
                benchStartEmphasis
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
              ].join(" ")}
              onClick={requestBench}
              disabled={!detect || running || visibleSelectedScenarioIds.length === 0}
              aria-busy={running}
              aria-label={msg().bench.runSelectedAria}
              title={visibleSelectedScenarioIds.length === 0 ? msg().bench.selectScenarioTitle : undefined}
            >
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {msg().bench.runSelected}
            </button>
          }
        />

        <Scoreboard
          rows={rows}
          detailAggregate={detailAggregate}
          loading={running}
          benchModelOrder={benchQueueDraft.map((m) => m.id)}
          providerByModel={providerByModel}
        />

        <section
          className={["rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", benchMetricsPanelsClass].filter(Boolean).join(" ")}
        >
          <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            {msg().bench.metricsChartHeading}
          </h2>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--foreground)]">
              <input
                type="radio"
                name="chartView"
                checked={chartView === "live"}
                onChange={() => setChartView("live")}
              />
              {msg().bench.thisSession}
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--foreground)]">
              <input
                type="radio"
                name="chartView"
                checked={chartView === "compare"}
                onChange={() => setChartView("compare")}
              />
              {msg().bench.compareStoredLast}
            </label>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50"
              disabled={compareLoading || !detect || running}
              onClick={() => void loadCompareFromServer()}
            >
              {compareLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {msg().bench.loadCompare}
            </button>
            {chartView === "compare" && (!compareSeries || compareSeries.length < 2) ? (
              <span className="text-xs text-[var(--muted)]">{msg().bench.compareHint}</span>
            ) : null}
          </div>
          {chartModelIds.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
              <span className="text-xs font-medium text-[var(--muted)]">{msg().bench.chartModels}</span>
              {chartModelIds.map((id) => {
                const label = detect?.models.find((m: DetectModel) => m.id === id)?.label ?? id;
                return (
                  <label
                    key={id}
                    className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
                  >
                    <input
                      type="checkbox"
                      checked={chartModelFilter[id] !== false}
                      onChange={() =>
                        setChartModelFilter((prev) => ({
                          ...prev,
                          [id]: !(prev[id] !== false),
                        }))
                      }
                    />
                    <span className="truncate font-mono" title={id}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {chartView === "compare" && compareSeries && compareSeries.length >= 2 ? (
            filteredCompareSeries && filteredCompareSeries.length >= 2 ? (
              <BenchCharts
                chartRows={[]}
                compareSeries={filteredCompareSeries}
                onCompareCell={(scenario, api, modelId) => openCompareCell(scenario, api, modelId)}
              />
            ) : (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                {msg().bench.compareSelectTwo}
              </p>
            )
          ) : chartRows.length > 0 && filteredChartRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">{msg().bench.selectModelToShow}</p>
          ) : (
            <BenchCharts chartRows={filteredChartRows} onBarPayload={(row) => openFromChartRow(row)} />
          )}
        </section>

        <section
          className={["rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", benchMetricsPanelsClass].filter(Boolean).join(" ")}
        >
          <h2 className="mb-3 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">{msg().bench.resultsTableHeading}</h2>
          <ResultsTable
            rows={rows}
            benchModelOrder={benchQueueDraft.map((m) => m.id)}
            pendingRows={pendingSkeletonRows}
            maxRows={visibleSelectedScenarioIds.length * Math.max(activeBenchApiRoutes.length, 1)}
            onRowClick={(r) => openDrawerForRow(r)}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div
            className={["min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", benchPreviewPanelClass].filter(Boolean).join(
              " ",
            )}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">{msg().bench.tokenPreview}</h2>
              <HighlightToggle on={hlPreview} onChange={setHlPreview} />
            </div>
            <JsonCodeBlock
              code={preview || "—"}
              language="markdown"
              enabled={hlPreview}
              maxHeight={280}
              stickToBottom={running}
            />
          </div>
          <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">{msg().bench.logHeading}</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs disabled:opacity-50"
                  disabled={serverRunsLoading}
                  onClick={() => {
                    if (serverRunsPanelOpen && !serverRunsLoading) {
                      setServerRunsPanelOpen(false);
                      return;
                    }
                    if (serverRuns.length > 0 && !serverRunsLoading) {
                      setServerRunsPanelOpen(true);
                      return;
                    }
                    void refreshServerRuns();
                  }}
                  aria-label={
                    serverRunsPanelOpen && serverRuns.length > 0
                      ? msg().bench.collapseServerRuns
                      : msg().bench.loadServerRuns
                  }
                >
                  {serverRunsLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <History className="size-3.5" aria-hidden />}
                  {serverRunsPanelOpen && serverRuns.length > 0 ? msg().bench.collapseList : msg().bench.serverRunsList}
                </button>
                <HighlightToggle on={hlLog} onChange={setHlLog} />
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs disabled:opacity-50"
                  disabled={!rows.length}
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify({ rows, detailAggregate, baseUrl, provider: detect?.provider }, null, 2)],
                      {
                      type: "application/json",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "bench-export.json";
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  aria-label={msg().bench.downloadLastJsonAria}
                >
                  <Download className="size-3.5" aria-hidden />
                  {msg().bench.downloadLastJson}
                </button>
              </div>
            </div>
            <JsonCodeBlock code={logText || "—"} language="markdown" enabled={hlLog} maxHeight={224} />
            {serverRuns.length > 0 && serverRunsPanelOpen ? (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {msg().bench.sqliteStoredRuns}
                  </h3>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-2)]"
                    onClick={() => setServerRunsPanelOpen(false)}
                  >
                    {msg().bench.closeList}
                  </button>
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs break-all">
                  {serverRuns.map((run) => (
                    <li key={run.run_id}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left hover:bg-[var(--surface)]"
                        onClick={() => void openServerRunDetail(run.run_id)}
                      >
                        <span className="text-[var(--muted)]">{run.created_at.slice(0, 19)}</span>{" "}
                        <span className="text-[var(--foreground)]">{run.model_id}</span>{" "}
                        <span className="text-[var(--muted)]">{run.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
              </>
            }
          />
          <Route path="/stress" element={<StressPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/provider-stats" element={<StressStatsPage />} />
          <Route path="/profile" element={<ProfileDocPage />} />
          <Route path="/provider-monitor" element={<ProviderMonitorPage />} />
          <Route path="/scenarios" element={<ScenariosDocPage />} />
          <Route
            path="/harness"
            element={
              <Suspense
                fallback={
                  <p className="text-sm text-[var(--muted)]" aria-busy="true">
                    {msg().bench.docLoading}
                  </p>
                }
              >
                <HarnessDocPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <ScenarioDetailDrawer
        open={drawerOpen}
        payload={drawerPayload}
        hlPreview={hlPreview}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerPayload(null);
        }}
      />
    </div>
  );
}
