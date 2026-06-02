import type { BenchRunMeta, DetectResult, LlmProfileFamily, SamplingPresetName, StreamEvent, ThinkingIntent } from "@llm-bench/shared";
import {
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  VISION_SCENARIO_IDS,
  getScenarioBenchMeta,
  inferLlmProfileFamily,
  isVisionScenario,
  resolveBenchProfile,
} from "@llm-bench/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { toast, Toaster } from "sonner";
import type { SortingState } from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  FlaskConical,
  Gauge,
  History,
  KeyRound,
  Link2,
  Loader2,
  Monitor,
  Moon,
  Play,
  Settings2,
  Sun,
  SunMoon,
} from "lucide-react";
import type {
  BenchRunDetailResponse,
  LatestByModelResponse,
  RunSummary,
  RunsListResponse,
} from "./api-types";
import { BenchCharts } from "./components/BenchCharts";
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
import {
  BenchProgressPanel,
  formatBenchRunningLine,
  type BenchCompletedItem,
  type BenchCurrent,
  type BenchStepKind,
  type BenchStepLine,
} from "./components/BenchProgressPanel";
import { ScenarioDetailDrawer, type ScenarioDetailPayload } from "./components/ScenarioDetailDrawer";
import { ScenarioGuideCards } from "./components/ScenarioGuideCards";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { readInitialUiState, saveUiSnapshot } from "./persisted-settings";
import { defaultScenarioPromptPreview, defaultScenarioSystemPromptPreview } from "./lib/scenario-prompt-preview";
import { ProfileDocPage } from "./ProfileDocPage";
import { ProviderMonitorPage } from "./ProviderMonitorPage";
import { ScenariosDocPage } from "./ScenariosDocPage";
import { StatsPage } from "./StatsPage";
import { StressPage } from "./StressPage";
import { StressStatsPage } from "./StressStatsPage";
import { formatTimeWithMs } from "./lib/time-format";
import type { ThemeChoice } from "./useTheme";
import { useTheme } from "./useTheme";

type DetectModel = DetectResult["models"][number];

type MetricsAgg = {
  scenario_id: string;
  api_route: "chat_completions" | "messages";
  system_prompt?: string;
  user_prompt?: string;
  runs: Array<{
    ttft_ms: number | null;
    tpot_ms: number | null;
    total_ms: number;
    output_text: string;
    stream_completed: boolean;
    quality?: { pass: boolean; score?: number; reason?: string };
  }>;
};

function benchErrorHint(code: string): string | null {
  if (code === "request_timeout") return "요청 시간 초과";
  if (code === "upstream_exception") return "업스트림 처리 예외";
  if (code === "provider_or_model_unavailable")
    return "프로바이더/모델 준비 상태 불가";
  return null;
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

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "dark") return <Moon className="size-4 text-[var(--muted)]" aria-hidden />;
  if (choice === "light") return <Sun className="size-4 text-[var(--muted)]" aria-hidden />;
  return <Monitor className="size-4 text-[var(--muted)]" aria-hidden />;
}

export function App() {
  const { choice: themeChoice, setChoice: setThemeChoice, resolved: themeResolved } = useTheme();
  const { pathname } = useLocation();
  const onBenchPage = pathname === "/";
  const onStressPage = pathname === "/stress";
  const onStatsPage = pathname === "/stats";
  const onProviderStatsPage = pathname === "/provider-stats";
  const onProviderMonitorPage = pathname === "/provider-monitor";
  const onProfilePage = pathname === "/profile";
  const onScenariosPage = pathname === "/scenarios";
  const [boot] = useState(() => readInitialUiState());
  const [baseUrl, setBaseUrl] = useState(boot.baseUrl);
  const [apiKey, setApiKey] = useState(boot.apiKey);
  const [persistApiKeyToDisk, setPersistApiKeyToDisk] = useState(boot.persistApiKeyToDisk);
  const [parallel, setParallel] = useState(boot.parallel);
  const [unloadOtherModels, setUnloadOtherModels] = useState(boot.unloadOtherModels);
  const [autoUnloadAfterBench, setAutoUnloadAfterBench] = useState(boot.autoUnloadAfterBench);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>(boot.selectedScenarioIds);
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(boot.scenarioPickerOpen);
  const toggleScenarioSelection = useCallback((id: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);
  const visibleSelectedScenarioIds = useMemo(
    () => selectedScenarioIds.filter((id) => (PUBLIC_SCENARIO_IDS as readonly string[]).includes(id)),
    [selectedScenarioIds],
  );
  const selectedTextCount = useMemo(
    () => visibleSelectedScenarioIds.filter((id) => !isVisionScenario(id)).length,
    [visibleSelectedScenarioIds],
  );
  const selectedVisionCount = useMemo(
    () => visibleSelectedScenarioIds.filter((id) => isVisionScenario(id)).length,
    [visibleSelectedScenarioIds],
  );
  const totalTextScenarios = useMemo(
    () => (PUBLIC_SCENARIO_IDS as string[]).filter((id) => !isVisionScenario(id)).length,
    [],
  );
  const [profileId, setProfileId] = useState<"auto" | LlmProfileFamily>(boot.profileId);
  const [profileMaxTokens, setProfileMaxTokens] = useState(boot.profileMaxTokens);
  const [thinkingIntent, setThinkingIntent] = useState<ThinkingIntent>(boot.thinkingIntent);
  const [preserveThinking, setPreserveThinking] = useState(boot.preserveThinking);
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
      return {
        profileId,
        profileMaxTokens: profileMaxTokensNum,
        thinkingIntent,
        preserveThinking: fam === "qwen36" ? preserveThinking : false,
        reasoningEffort: fam === "gpt_oss" ? reasoningEffort : undefined,
        presetOverride: presetOverride || undefined,
        samplingOverrides: samplingOverrides ?? undefined,
      };
    },
    [
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
  const [benchCompleted, setBenchCompleted] = useState<BenchCompletedItem[]>([]);
  /** 이번 벤치 런에서 `scenario_start`가 있었던 시나리오 id */
  const [touchedScenarioIds, setTouchedScenarioIds] = useState<string[]>([]);

  // 영속 저장 (debounce 350ms). `/stress` 등 다른 라우트에서는 게이트로 차단해
  // App의 stale state가 stress 페이지의 공유 키 변경(baseUrl/apiKey 등)을 되돌리는 회귀 방지.
  useEffect(() => {
    if (!onBenchPage) return;
    const t = window.setTimeout(() => {
      saveUiSnapshot({
        baseUrl,
        parallel,
        unloadOtherModels,
        autoUnloadAfterBench,
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
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    onBenchPage,
    apiKey,
    baseUrl,
    hlLog,
    hlPreview,
    parallel,
    persistApiKeyToDisk,
    unloadOtherModels,
    autoUnloadAfterBench,
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
  ]);

  // bench → 다른 라우트 전이 시 *즉시 flush*. 게이트가 debounce를 폐기해도 최종 값 보존.
  const latestBenchSnapshotRef = useRef({
    baseUrl,
    parallel,
    unloadOtherModels,
    autoUnloadAfterBench,
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
  });
  latestBenchSnapshotRef.current = {
    baseUrl,
    parallel,
    unloadOtherModels,
    autoUnloadAfterBench,
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

  const pendingSkeletonRows = useMemo(() => {
    if (!running) return [];
    const completedKeys = new Set(rows.map((r) => r.rowKey));
    const result: Array<{ rowKey: string; model_id: string; scenario: string; api: string }> = [];
    for (const model of benchQueueDraft) {
      for (const scenarioId of visibleSelectedScenarioIds) {
        for (const api of ["chat_completions", "messages"] as const) {
          const rk = scenarioRowKey(scenarioId, api, model.id);
          if (!completedKeys.has(rk)) {
            result.push({ rowKey: rk, model_id: model.id, scenario: scenarioId, api });
          }
        }
      }
    }
    return result;
  }, [running, rows, benchQueueDraft, visibleSelectedScenarioIds]);

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
              tpot_ms: r.tpot_ms,
              pass: r.pass,
              model_id: r.model_id,
              total_ms: last?.total_ms,
              output_text: last?.output_text,
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
        tpot_ms: row.tpot_ms,
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
        ttft_ms: row.ttft > 0 ? row.ttft : null,
        tpot_ms: row.tpot > 0 ? row.tpot : null,
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
          tpot_ms: last?.tpot_ms ?? null,
          pass: last?.quality?.pass,
          score: last?.quality?.score,
          qualityReason: last?.quality?.reason,
          systemPrompt:
            sc.prompt_system_preview ?? defaultScenarioSystemPromptPreview(scenario),
          userPrompt: sc.prompt_preview ?? defaultScenarioPromptPreview(scenario),
          outputText: last?.output_text ?? "",
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
      toast.error("먼저 연결 / 감지를 실행하세요.");
      return;
    }
    const modelIds = orderedSelectedModels.map((m) => m.id);
    if (modelIds.length < 2) {
      toast.error("비교하려면 모델을 2개 이상 선택하세요.");
      return;
    }
    setCompareLoading(true);
    try {
      const u = new URL("/api/runs/latest-by-model", window.location.origin);
      u.searchParams.set("baseUrl", detect.baseUrl);
      u.searchParams.set("modelIds", modelIds.join(","));
      const res = await fetch(u.toString());
      if (!res.ok) {
        toast.error(`비교 API 오류 (${res.status})`);
        return;
      }
      const data = (await res.json()) as LatestByModelResponse;
      if (data.sqlite_available === false) {
        toast.warning(
          `SQLite를 사용할 수 없어 저장된 런을 불러올 수 없습니다. 서버의 DB 파일 경로·권한·잠금 상태를 확인하세요.`,
        );
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
                tpot_ms: last.tpot_ms,
                pass: last.quality?.pass,
                model_id: it.model_id,
                total_ms: last.total_ms,
                output_text: last.output_text,
              },
            ])[0];
          })
          .filter((x): x is ChartRow => x != null);
        if (chartRowsForModel.length) {
          series.push({ modelId: it.model_id, label, rows: chartRowsForModel });
        }
      }
      if (series.length < 2) {
        toast.warning("저장된 최종 런이 있는 모델이 2개 미만입니다. 동일 Base URL에서 벤치를 먼저 실행하세요.");
        setCompareSeries(null);
        setCompareRaw(null);
        setChartView("live");
        return;
      }
      setCompareRaw(data);
      setCompareSeries(series);
      setChartView("compare");
      toast.success("저장된 마지막 런 기준 비교 차트를 불러왔습니다.");
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
        toast.error(`런 목록 오류 (${res.status})`);
        return;
      }
      const j = (await res.json()) as RunsListResponse;
      setServerRuns(j.runs ?? []);
      setServerRunsPanelOpen(true);
      if (j.sqlite_available === false) {
        toast.warning("SQLite 비활성화 — 서버 런 목록을 사용할 수 없습니다.");
      } else {
        toast.success(`서버 런 ${j.runs?.length ?? 0}건`);
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
        toast.error(`런 조회 실패 (${res.status})`);
        return;
      }
      const detail = (await res.json()) as BenchRunDetailResponse;
      const sc = detail.scenarios[0];
      if (!sc) {
        toast.error("시나리오 데이터가 없습니다.");
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
        tpot_ms: last?.tpot_ms ?? null,
        pass: last?.quality?.pass,
        score: last?.quality?.score,
        qualityReason: last?.quality?.reason,
        systemPrompt: sc.prompt_system_preview ?? defaultScenarioSystemPromptPreview(sc.id),
        userPrompt: sc.prompt_preview ?? defaultScenarioPromptPreview(sc.id),
        outputText: last?.output_text ?? "",
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
        toast.error("프로바이더 감지에 실패했습니다.");
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
        toast.error(
          rch.reason ?? "Base URL에 연결할 수 없습니다. 서버가 켜져 있는지·주소·방화벽을 확인하세요.",
        );
      } else if (rch?.state === "partial") {
        toast.warning(
          rch.reason ?? "모델 목록 경로 일부만 응답했습니다. 네트워크 또는 프록시 설정을 확인하세요.",
        );
      } else if (d.models.length === 0) {
        const hint =
          d.provider === "lm_studio"
            ? "LM Studio에서 모델을 로드한 뒤 다시 시도하세요."
            : "모델 목록이 비어 있습니다. Base URL·API 키를 확인하세요.";
        toast.warning(`감지됐지만 모델이 없습니다. ${hint}`);
      } else {
        toast.success(`감지 완료 · ${d.provider} · 모델 ${d.models.length}개`);
      }
      saveUiSnapshot({
        baseUrl: d.baseUrl,
        parallel,
        unloadOtherModels,
        autoUnloadAfterBench,
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
      });
    } catch (e) {
      appendLog(String(e));
      toast.error("감지 요청 중 오류가 발생했습니다.");
    } finally {
      setDetecting(false);
    }
  }, [
    apiKey,
    appendLog,
    baseUrl,
    hlLog,
    hlPreview,
    parallel,
    persistApiKeyToDisk,
    unloadOtherModels,
    autoUnloadAfterBench,
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
      appendLog("모델을 하나 이상 선택하세요.");
      toast.error("벤치할 모델을 하나 이상 선택하세요.");
      return;
    }
    if (parallel) {
      appendLog("경고: 병렬 실행은 GPU/단일 로드 전제를 깨뜨릴 수 있습니다.");
    }
    setRunning(true);
    setRows([]);
    setDetailAggregate({});
    setLiveSystemPromptByRowKey({});
    setLiveUserPromptByRowKey({});
    setPreview("");
    setBenchStepLines([]);
    setBenchCurrent(null);
    setBenchCompleted([]);
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
              parallel,
              skipModelLoad: detect.provider !== "lm_studio",
              unloadOtherModels,
              autoUnloadAfterBench,
              publicAssetsOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
              scenarioIds: visibleSelectedScenarioIds,
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
            const ridShort = ev.run_id.length > 28 ? `${ev.run_id.slice(0, 28)}…` : ev.run_id;
            pushBenchLine("info", `런 시작 · ${ridShort}`);
            setBenchCurrent({ modelId: m.id });
          }
          if (ev.type === "model_loaded") {
            pushBenchLine("info", `모델 로드 완료 · ${ev.model_id}`);
            setBenchCurrent({ modelId: ev.model_id });
          }
          if (ev.type === "model_unloaded") {
            const st = ev.status != null ? String(ev.status) : "?";
            if (ev.ok) {
              appendLog(
                ev.phase === "after_bench"
                  ? `벤치 후 모델 언로드 완료 · ${ev.model_id} · HTTP ${st}`
                  : `모델 언로드 완료 · ${ev.model_id} · HTTP ${st}`,
              );
              pushBenchLine("ok", `언로드 완료 · ${ev.model_id} · ${st}`);
            } else {
              appendLog(
                ev.phase === "after_bench"
                  ? `벤치 후 모델 언로드 실패 · ${ev.model_id} · HTTP ${st}`
                  : `모델 언로드 실패 · ${ev.model_id} · HTTP ${st}`,
              );
              pushBenchLine("err", `언로드 실패 · ${ev.model_id} · ${st}`);
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
            } else {
              iterInScenario += 1;
            }
            const wr = streamMeta?.warmup_runs ?? 1;
            const mr = streamMeta?.measured_runs ?? 3;
            const phase: BenchCurrent["phase"] = iterInScenario <= wr ? "warmup" : "measured";
            const iterLabel =
              phase === "warmup" ? `워밍업 ${iterInScenario}/${wr}` : `측정 ${Math.min(iterInScenario - wr, mr)}/${mr}`;
            setBenchCurrent({
              modelId: m.id,
              scenario: p.sid,
              api: p.api,
              phase,
              iterLabel,
            });
            setTouchedScenarioIds((prev) => (prev.includes(p.sid) ? prev : [...prev, p.sid]));
            pushBenchLine("info", `시작 · ${p.sid} · ${p.api} (${iterLabel})`);
          }
          if (ev.type === "run_finished") {
            sawRunFinished = true;
            pushBenchLine("ok", `런 완료 · ${m.id}`);
            setBenchCurrent({ modelId: m.id });
          }
          if (ev.type === "token_delta") {
            setPreview((p) => (p + ev.text).slice(-8000));
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
            pushBenchLine("ok", `집계 완료 · ${agg.scenario_id} · ${apiLabel}`);
            const doneKey = `${m.id}|${agg.scenario_id}|${agg.api_route}`;
            const doneLabel = `${agg.scenario_id} (${apiLabel})`;
            setBenchCompleted((prev) => (prev.some((x) => x.key === doneKey) ? prev : [...prev, { key: doneKey, label: doneLabel }]));
            const rowKey = scenarioRowKey(agg.scenario_id, agg.api_route, m.id);
            setDetailAggregate((prev) => ({ ...prev, [rowKey]: agg }));
            const runs = agg.runs;
            const last = runs[runs.length - 1];
            if (!last) return;
            const tpsRaw = tokensPerSecondFromRun(last.total_ms, last.output_text);
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
                  tpot_ms: last.tpot_ms ?? null,
                  tps,
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
          appendLog(`bench incomplete: run_finished 없음 model=${m.id}`);
        }
      } catch (e) {
        anyHttpFail = true;
        appendLog(String(e));
        pushBenchLine("err", `요청 실패 · ${m.id}: ${String(e).slice(0, 200)}`);
      }
    }
    setRunning(false);
    appendLog("bench finished");
    if (anyHttpFail || streamErrorCount > 0 || streamIncomplete) {
      toast.warning("벤치 종료 — 오류·미완료 스트림이 있었습니다. 로그를 확인하세요.");
    } else {
      toast.success("벤치가 모두 완료되었습니다.");
    }
  }, [apiKey, appendLog, autoUnloadAfterBench, buildBenchProfilePayload, detect, parallel, unloadOtherModels]);

  const requestBench = useCallback(() => {
    if (!detect) return;
    if (visibleSelectedScenarioIds.length === 0) {
      toast.error("실행할 시나리오를 1개 이상 선택하세요.");
      return;
    }
    const models = orderedSelectedModels;
    if (!models.length) {
      toast.error("벤치할 모델을 하나 이상 선택하세요.");
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
  const benchHeaderLine = useMemo(() => formatBenchRunningLine(benchCurrent), [benchCurrent]);
  const benchLiveSoft = "bench-live-panel--soft";
  const benchMetricsPanelsClass = running && rows.length > 0 ? benchLiveSoft : "";
  const benchPreviewPanelClass = running && preview.length > 0 ? benchLiveSoft : "";
  const benchProgressClass = running ? benchLiveSoft : "";

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--foreground)]">
      <Toaster richColors theme={themeResolved} position="bottom-right" closeButton />
      <ConfirmDialog
        open={benchConfirmOpen}
        title="선택 모델 벤치"
        confirmLabel="벤치 실행"
        onCancel={() => setBenchConfirmOpen(false)}
        onConfirm={handleConfirmBench}
      >
        {detect ? (
          <>
            <p>
              실행 순서 · 모델 <strong className="text-[var(--foreground)]">{benchQueueDraft.length}</strong>개
              {detect.provider === "lm_studio" ? " · LM Studio에서 로드/언로드가 동작할 수 있습니다." : ""}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">위/아래로 직렬 실행 순서를 바꿀 수 있습니다.</p>
            <ol className="mt-2 max-h-48 list-decimal space-y-1.5 overflow-y-auto pl-5 text-[var(--foreground)]">
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
                        aria-label={`${m.id} 위로 이동`}
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
                        aria-label={`${m.id} 아래로 이동`}
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
              {parallel ? (
                <li className="text-[var(--danger)]">병렬 실행이 켜져 있습니다. GPU 부하에 유의하세요.</li>
              ) : null}
              {unloadOtherModels && detect.provider === "lm_studio" ? (
                <li>벤치 대상 외 모델 언로드가 켜져 있습니다(감지 목록 기준).</li>
              ) : null}
              {autoUnloadAfterBench && detect.provider === "lm_studio" ? (
                <li>이번 벤치에서 로드한 대상 모델만 끝날 때 자동 언로드합니다(이미 로드된 모델은 유지).</li>
              ) : null}
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
      <header className="sticky top-0 z-20 grid grid-cols-1 items-center gap-y-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 shadow-sm sm:grid-cols-[1fr_auto_1fr] sm:gap-x-4 sm:gap-y-0 sm:px-6">
        <div className="flex min-w-0 items-start gap-3 justify-self-start sm:min-w-0">
          <span className="mt-0.5 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--accent)]">
            <Activity className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">LLM Model Bench</h1>
            {onStatsPage ? (
              <p className="text-sm text-[var(--muted)]">SQLite에 저장된 최신 런 기준 메트릭·결과</p>
            ) : onProviderStatsPage ? (
              <p className="text-sm text-[var(--muted)]">SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제</p>
            ) : onProviderMonitorPage ? (
              <p className="text-sm text-[var(--muted)]">로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작</p>
            ) : onProfilePage ? (
              <p className="text-sm text-[var(--muted)]">모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙</p>
            ) : onScenariosPage ? (
              <p className="text-sm text-[var(--muted)]">시나리오 목적·도구·채점·프롬프트 미리보기</p>
            ) : onStressPage ? (
              <p className="text-sm text-[var(--muted)]">동시 사용자 부하 · 단계별 TPS · 라이브 워커 모니터</p>
            ) : (
              <p className="text-sm text-[var(--muted)]">로컬 프로바이더 감지 · 단일 모델 시나리오 벤치</p>
            )}
            {running && onBenchPage ? (
              <div
                className={[
                  "mt-2 flex min-w-0 items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--foreground)]",
                  benchLiveSoft,
                ].join(" ")}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-hidden />
                <span className="min-w-0 truncate">
                  벤치 실행 중 · {benchHeaderLine}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="justify-self-center sm:px-2" role="tablist" aria-label="페이지">
          <span className="sr-only">페이지</span>
          <div className="flex max-w-[100vw] flex-wrap justify-center gap-1 rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] p-1 shadow-sm sm:max-w-none sm:flex-nowrap">
            <NavLink
              to="/"
              end
              role="tab"
              aria-selected={onBenchPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <FlaskConical className="size-4" aria-hidden />
                모델 벤치
              </span>
            </NavLink>
            <NavLink
              to="/stats"
              role="tab"
              aria-selected={onStatsPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <BarChart3 className="size-4" aria-hidden />
                모델 통계
              </span>
            </NavLink>
            <NavLink
              to="/stress"
              role="tab"
              aria-selected={onStressPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Gauge className="size-4" aria-hidden />
                프로바이더 벤치
              </span>
            </NavLink>
            <NavLink
              to="/provider-stats"
              role="tab"
              aria-selected={onProviderStatsPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <History className="size-4" aria-hidden />
                프로바이더 통계
              </span>
            </NavLink>
            <NavLink
              to="/profile"
              role="tab"
              aria-selected={onProfilePage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Settings2 className="size-4" aria-hidden />
                프로파일
              </span>
            </NavLink>
            <NavLink
              to="/provider-monitor"
              role="tab"
              aria-selected={onProviderMonitorPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Cpu className="size-4" aria-hidden />
                프로바이더 모니터
              </span>
            </NavLink>
            <NavLink
              to="/scenarios"
              role="tab"
              aria-selected={onScenariosPage}
              className={({ isActive }) =>
                `min-w-[4rem] rounded-md px-3 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors sm:min-w-[4.5rem] sm:px-4 sm:text-base ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-md"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <BookOpen className="size-4" aria-hidden />
                시나리오
              </span>
            </NavLink>
          </div>
        </div>
        <label className="grid justify-self-end gap-1 text-sm">
          <span className="inline-flex items-center gap-1 text-[var(--muted)]">
            <SunMoon className="size-3.5" aria-hidden />
            테마
          </span>
          <div className="flex items-center gap-2">
            <ThemeIcon choice={themeChoice} />
            <select
              className="min-w-[10rem] rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
              value={themeChoice}
              onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
              aria-label="테마 선택"
            >
              <option value="dark">다크</option>
              <option value="light">라이트</option>
              <option value="system">시스템</option>
            </select>
          </div>
        </label>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
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
              <input
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <KeyRound className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
                API 키 (선택)
              </span>
              <input
                type="password"
                autoComplete="off"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Bearer / 게이트웨이 키"
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
              <span className="font-medium text-[var(--foreground)]">이 브라우저에 API 키 저장 (로컬 디스크, 평문)</span>
              <span className="mt-1 flex items-start gap-1 text-xs leading-snug">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
                끄면 같은 탭에서만 <code className="rounded bg-[var(--surface)] px-1">sessionStorage</code>에 보관되어 새로고침은 유지되나 브라우저를 닫으면 사라질 수 있습니다. 켜면{" "}
                <code className="rounded bg-[var(--surface)] px-1">localStorage</code> 평문으로 남으며 XSS 등에 노출될 수 있습니다.
              </span>
            </span>
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
            <input type="checkbox" checked={parallel} onChange={(e) => setParallel(e.target.checked)} />
            병렬 실행 (기본은 직렬; 켜면 경고)
          </label>
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <button
              type="button"
              onClick={() => setScenarioPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="font-medium text-[var(--foreground)]">
                실행 시나리오{" "}
                <span className={visibleSelectedScenarioIds.length === 0 ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
                  ({visibleSelectedScenarioIds.length}/{PUBLIC_SCENARIO_IDS.length})
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--muted)]">
                  텍스트 {selectedTextCount}/{totalTextScenarios}
                </span>
                <span
                  className={[
                    "rounded px-1.5 py-0.5",
                    selectedVisionCount > 0
                      ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)]",
                  ].join(" ")}
                >
                  비전 {selectedVisionCount}/{VISION_SCENARIO_IDS.length}
                </span>
                <span className="text-[var(--muted)]">{scenarioPickerOpen ? "▴" : "▾"}</span>
              </span>
            </button>
            {visibleSelectedScenarioIds.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--danger)]">
                실행할 시나리오를 1개 이상 선택해야 합니다.
              </p>
            ) : null}
            {scenarioPickerOpen ? (
              <div className="mt-2 space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() => setSelectedScenarioIds([...DEFAULT_SCENARIO_IDS])}
                    title="기존 텍스트 8개만 실행"
                  >
                    기본 (텍스트 8개)
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() =>
                      setSelectedScenarioIds([...DEFAULT_SCENARIO_IDS, ...VISION_SCENARIO_IDS])
                    }
                    title="처음 실행하는 모델용: 텍스트 8 + 비전 10 = 18개 시나리오"
                  >
                    전체 18개 (텍스트+비전)
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 hover:bg-[var(--accent)]/20"
                    onClick={() => setSelectedScenarioIds([...VISION_SCENARIO_IDS])}
                    title="이미 텍스트 벤치 완료한 모델에 비전 10개만 추가로 실행"
                  >
                    비전만 (10개) · 보완 벤치
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
                    onClick={() => setSelectedScenarioIds([])}
                  >
                    모두 해제
                  </button>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">텍스트 시나리오</div>
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
                    비전 시나리오{" "}
                    <span className="text-[var(--muted)]">
                      (opt-in · 비전 미지원 모델은 400/거부 가능 · 호출 비용 ↑)
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
              </div>
            ) : null}
          </div>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]"
            title={
              detect?.provider === "lm_studio"
                ? "감지된 모델 목록에 있는 다른 모델에 대해 unload를 시도합니다. 목록에 없는 로드는 건드리지 못합니다."
                : "LM Studio에서만 적용됩니다."
            }
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={unloadOtherModels}
              disabled={detect?.provider !== "lm_studio"}
              onChange={(e) => setUnloadOtherModels(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">벤치 대상 외 모델 언로드 (LM Studio)</span>
              <span className="mt-1 flex items-start gap-1 text-xs leading-snug">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
                켜면 각 벤치 시작 전 감지된 다른 모델 키에 대해 unload를 베스트 에포트로 호출합니다. 실패해도 벤치는 계속됩니다.
                {detect && detect.provider !== "lm_studio" ? " 현재 프로바이더에서는 비활성입니다." : ""}
              </span>
            </span>
          </label>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]"
            title={
              detect?.provider === "lm_studio"
                ? "시작 시점에 이미 VRAM에 있던 모델은 언로드하지 않고, 이번 실행이 load로 올린 경우에만 끝날 때 unload를 시도합니다."
                : "LM Studio에서만 적용됩니다."
            }
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={autoUnloadAfterBench}
              disabled={detect?.provider !== "lm_studio"}
              onChange={(e) => setAutoUnloadAfterBench(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">벤치 후 대상 모델 자동 언로드 (LM Studio)</span>
              <span className="mt-0.5 block text-xs leading-snug">
                이미 로드되어 있던 모델은 그대로 두고, 이번 벤치에서 로드한 경우에만 런 종료 시 unload를 베스트 에포트로 호출합니다.
                {detect && detect.provider !== "lm_studio" ? " 현재 프로바이더에서는 비활성입니다." : ""}
              </span>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              onClick={() => void runDetect()}
              disabled={detecting}
              aria-busy={detecting}
              aria-label="연결 및 프로바이더 감지"
            >
              {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
              연결 / 감지
            </button>
          </div>
          {detect ? <ProviderSummary detect={detect} /> : null}
        </section>

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <h2 className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <span className="inline-flex items-center gap-2">
              <Monitor className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              모델 선택
            </span>
            <NavLink
              to="/profile"
              className="shrink-0 text-xs font-normal text-[var(--accent)] no-underline hover:underline"
            >
              프로파일 수치·규칙 상세
            </NavLink>
          </h2>
          <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid min-w-0 gap-1">
              <span className="text-xs font-medium text-[var(--muted)]">프로파일</span>
              <select
                className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value as "auto" | LlmProfileFamily)}
                aria-label="벤치 프로파일"
              >
                <option value="auto">자동(모델 id로 추론)</option>
                <option value="gemma4">Gemma 4</option>
                <option value="qwen35">Qwen 3.5</option>
                <option value="qwen36">Qwen 3.6</option>
                <option value="gpt_oss">gpt-oss</option>
                <option value="minimax">MiniMax</option>
                <option value="nemotron3">Nemotron 3</option>
                <option value="qwen3_coder_next">Qwen3-Coder-Next</option>
                <option value="glm47_flash">GLM-4.7-Flash</option>
                <option value="unknown">unknown (기본 샘플링)</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="text-xs font-medium text-[var(--muted)]">사고(thinking) 의도</span>
              <select
                className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--foreground)]"
                value={thinkingIntent}
                onChange={(e) => setThinkingIntent(e.target.value as ThinkingIntent)}
              >
                <option value="on">켜기 (기본)</option>
                <option value="off">끄기 (Qwen·Nemotron: enable_thinking=false)</option>
              </select>
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
              <span className="text-xs font-medium text-[var(--muted)]">max_tokens (비워두면 모델 카드 권장값)</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs"
                inputMode="numeric"
                value={profileMaxTokens}
                onChange={(e) => setProfileMaxTokens(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="예: 32768"
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
                  <span className="mt-0.5 block leading-snug">에이전트형 멀티턴에서만 켜는 것을 권장합니다.</span>
                </span>
              </label>
            ) : null}
            <details
              ref={profileDetailsRef}
              className="sm:col-span-2 lg:col-span-3"
              open={profileAdvancedOpen}
              onToggle={(e) => setProfileAdvancedOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">고급: 프리셋·샘플링 JSON 오버라이드</summary>
              <div className="mt-2 grid gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--muted)]">preset 강제 (비우면 자동)</span>
                  <select
                    className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs"
                    value={presetOverride}
                    onChange={(e) => setPresetOverride((e.target.value || "") as SamplingPresetName | "")}
                  >
                    <option value="">자동</option>
                    <option value="default">default</option>
                    <option value="thinking_general">thinking_general</option>
                    <option value="thinking_coding">thinking_coding</option>
                    <option value="nonthinking_general">nonthinking_general</option>
                    <option value="tool_call">tool_call</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--muted)]">samplingOverrides (JSON 객체)</span>
                  <textarea
                    className="min-h-[4.5rem] rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[11px] leading-snug text-[var(--foreground)]"
                    value={samplingOverridesText}
                    onChange={(e) => setSamplingOverridesText(e.target.value)}
                    placeholder='{"temperature":0.8,"top_p":0.9}'
                    spellCheck={false}
                  />
                </label>
              </div>
            </details>
          </div>
          {detecting ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              프로바이더 감지 중…
            </p>
          ) : detect && detect.models.length > 0 ? (
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
          ) : detect && detect.models.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              감지된 모델이 없습니다. Base URL·API 키를 확인한 뒤 다시 <strong className="text-[var(--foreground)]">연결 / 감지</strong>를 실행하세요.
            </p>
          ) : (
            <div
              className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]"
              aria-live="polite"
            >
              아직 모델 목록이 없습니다. 위에서{" "}
              <strong className="text-[var(--foreground)]">연결 / 감지</strong>를 실행하면 목록이 여기에 표시됩니다.
            </div>
          )}
        </section>

        <div className="space-y-2">
          <div className="flex justify-end">
            <NavLink
              to="/scenarios"
              className="text-xs text-[var(--accent)] no-underline hover:underline"
            >
              시나리오 상세 문서
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
          completed={benchCompleted}
          benchAction={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              onClick={requestBench}
              disabled={!detect || running || visibleSelectedScenarioIds.length === 0}
              aria-busy={running}
              aria-label="선택한 모델 벤치 실행"
              title={
                visibleSelectedScenarioIds.length === 0
                  ? "실행할 시나리오를 1개 이상 선택하세요"
                  : undefined
              }
            >
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              선택 모델 벤치
            </button>
          }
        />

        <section
          className={["rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", benchMetricsPanelsClass].filter(Boolean).join(" ")}
        >
          <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            메트릭 차트
          </h2>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--foreground)]">
              <input
                type="radio"
                name="chartView"
                checked={chartView === "live"}
                onChange={() => setChartView("live")}
              />
              이번 세션
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--foreground)]">
              <input
                type="radio"
                name="chartView"
                checked={chartView === "compare"}
                onChange={() => setChartView("compare")}
              />
              저장된 마지막 런 비교
            </label>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50"
              disabled={compareLoading || !detect || running}
              onClick={() => void loadCompareFromServer()}
            >
              {compareLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              비교 불러오기
            </button>
            {chartView === "compare" && (!compareSeries || compareSeries.length < 2) ? (
              <span className="text-xs text-[var(--muted)]">선택 모델 2개 이상 · 비교 불러오기 실행</span>
            ) : null}
          </div>
          {chartModelIds.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
              <span className="text-xs font-medium text-[var(--muted)]">차트 모델</span>
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
                비교 차트를 보려면 위에서 모델을 2개 이상 선택하세요.
              </p>
            )
          ) : chartRows.length > 0 && filteredChartRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">표시할 모델을 하나 이상 선택하세요.</p>
          ) : (
            <BenchCharts chartRows={filteredChartRows} onBarPayload={(row) => openFromChartRow(row)} />
          )}
        </section>

        <section
          className={["rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", benchMetricsPanelsClass].filter(Boolean).join(" ")}
        >
          <h2 className="mb-3 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">결과 테이블</h2>
          <ResultsTable
            rows={rows}
            pendingRows={pendingSkeletonRows}
            maxRows={visibleSelectedScenarioIds.length * 2}
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
              <h2 className="text-sm font-semibold text-[var(--foreground)]">토큰 프리뷰 (스트림)</h2>
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
              <h2 className="text-sm font-semibold text-[var(--foreground)]">로그</h2>
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
                      ? "서버 런 목록 접기"
                      : "서버에 저장된 벤치 런 목록 불러오기"
                  }
                >
                  {serverRunsLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <History className="size-3.5" aria-hidden />}
                  {serverRunsPanelOpen && serverRuns.length > 0 ? "목록 접기" : "서버 런 목록"}
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
                  aria-label="마지막 결과 JSON 다운로드"
                >
                  <Download className="size-3.5" aria-hidden />
                  마지막 결과 JSON보내기
                </button>
              </div>
            </div>
            <JsonCodeBlock code={logText || "—"} language="markdown" enabled={hlLog} maxHeight={224} />
            {serverRuns.length > 0 && serverRunsPanelOpen ? (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    SQLite 저장 런 (클릭 시 첫 시나리오 상세)
                  </h3>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-2)]"
                    onClick={() => setServerRunsPanelOpen(false)}
                  >
                    목록 닫기
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
