import {
  defaultMaxTokensForWorkload,
  expectedScriptForWorkload,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  STRESS_MAX_LIVE_CELLS,
  STRESS_WORKLOAD_IDS,
  type DetectResult,
  type StressRampConfig,
  type StressStageResult,
  type StressStreamEvent,
  type StressWorkloadId,
} from "@llm-bench/shared";
import { AlertTriangle, Loader2, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SortingState } from "@tanstack/react-table";
import { DEFAULT_MODEL_TABLE_SORTING, ModelTable } from "./components/ModelTable";
import { ProviderMemoryWidget } from "./components/ProviderMemoryWidget";
import { StressMonitorGrid, emptyCellState, type StressCellState } from "./components/StressMonitorGrid";
import { StressResultTable } from "./components/StressResultTable";
import { StressTpsChart } from "./components/StressTpsChart";
import {
  readInitialStressState,
  readInitialUiState,
  saveStressSnapshot,
  saveUiSnapshot,
  type StressSaveSnapshot,
} from "./persisted-settings";

import { useI18n, msg } from "./i18n";

type DetectModel = DetectResult["models"][number];

function consumeSseJsonLines(
  stream: ReadableStream<Uint8Array>,
  onEvent: (ev: StressStreamEvent) => void,
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
            onEvent(JSON.parse(json) as StressStreamEvent);
          } catch {
            /* ignore */
          }
        }
      }
    }
  })();
}

export function StressPage() {
  const { m } = useI18n();
  // 공유 키(baseUrl/apiKey/persistApiKeyToDisk)는 모델 벤치와 같은 namespace 사용.
  // boot은 마운트 시 한 번 잡힌 고정 스냅샷 — save effect에서 spread base로 사용해 모델 벤치 필드 보호.
  const [boot] = useState(() => readInitialUiState());
  const [stressBoot] = useState(() => readInitialStressState());
  const [baseUrl, setBaseUrl] = useState(boot.baseUrl);
  const [apiKey, setApiKey] = useState(boot.apiKey);
  const [persistApiKeyToDisk, setPersistApiKeyToDisk] = useState(boot.persistApiKeyToDisk);
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  // 이전 런에서 저장한 모델 id — 첫 detect 이후 1회만 자동 선택에 사용 후 무효화.
  const lastSelectedModelIdRef = useRef<string | null>(stressBoot.lastSelectedModelId);
  const [sorting, setSorting] = useState<SortingState>(() => DEFAULT_MODEL_TABLE_SORTING);

  const [workloadId, setWorkloadId] = useState<StressWorkloadId>(stressBoot.workloadId);
  const [startCC, setStartCC] = useState(stressBoot.startCC);
  const [maxCC, setMaxCC] = useState(stressBoot.maxCC);
  const [stepCC, setStepCC] = useState(stressBoot.stepCC);
  const [durationMs, setDurationMs] = useState(stressBoot.durationMs);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(stressBoot.requestTimeoutMs);
  const [workerPromptSuffix, setWorkerPromptSuffix] = useState(stressBoot.workerPromptSuffix);
  const [maxTokensOverride, setMaxTokensOverride] = useState<string>(stressBoot.maxTokensOverride);

  const [running, setRunning] = useState(false);
  // runStatus는 그리드/헤더 메시지용. running boolean은 폼·버튼 비활성용으로만 유지.
  // 종료 후(finished/aborted/error)는 다음 startRun까지 그대로 유지 → 그리드 스냅샷 보존.
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "finished" | "aborted" | "error">("idle");
  const [stages, setStages] = useState<StressStageResult[]>([]);
  const [currentStageIndex, setCurrentStageIndex] = useState<number | null>(null);
  const [currentConcurrency, setCurrentConcurrency] = useState<number>(0);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [cells, setCells] = useState<StressCellState[]>([]);
  const [stageStartedAt, setStageStartedAt] = useState<number | null>(null);
  const [stageDurationMs, setStageDurationMs] = useState<number | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 영속 저장: 공유 키 (debounce 350ms).
  // boot은 마운트 시 고정 — deps에 넣지 않음 (변경 시 deps만 추가하면 매번 다시 저장).
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveUiSnapshot({
        ...boot,
        baseUrl,
        apiKey,
        persistApiKeyToDisk,
      });
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey, persistApiKeyToDisk]);

  // 영속 저장: stress 전용 키.
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveStressSnapshot({
        workloadId,
        startCC,
        maxCC,
        stepCC,
        durationMs,
        requestTimeoutMs,
        workerPromptSuffix,
        maxTokensOverride,
        lastSelectedModelId: selectedModelId,
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    workloadId,
    startCC,
    maxCC,
    stepCC,
    durationMs,
    requestTimeoutMs,
    workerPromptSuffix,
    maxTokensOverride,
    selectedModelId,
  ]);

  // Unmount-on-flush: 라우트 이탈 시 pending debounce가 폐기되어도 최종 값이 보존되도록
  // ref에 매 렌더 동기화된 최신 스냅샷을 즉시 저장.
  const latestSharedRef = useRef({ baseUrl, apiKey, persistApiKeyToDisk });
  latestSharedRef.current = { baseUrl, apiKey, persistApiKeyToDisk };
  const latestStressRef = useRef<StressSaveSnapshot>({
    workloadId,
    startCC,
    maxCC,
    stepCC,
    durationMs,
    requestTimeoutMs,
    workerPromptSuffix,
    maxTokensOverride,
    lastSelectedModelId: selectedModelId,
  });
  latestStressRef.current = {
    workloadId,
    startCC,
    maxCC,
    stepCC,
    durationMs,
    requestTimeoutMs,
    workerPromptSuffix,
    maxTokensOverride,
    lastSelectedModelId: selectedModelId,
  };
  useEffect(() => {
    return () => {
      saveUiSnapshot({
        ...boot,
        ...latestSharedRef.current,
      });
      saveStressSnapshot(latestStressRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expectedScript = expectedScriptForWorkload(workloadId);

  const previewUserPrompt = useMemo(() => {
    return getScenarioUserPromptPreview(workloadId, {
      stressWorkerIndex: workerPromptSuffix ? 1 : 0,
    });
  }, [workloadId, workerPromptSuffix]);
  const previewSystemPrompt = useMemo(() => getScenarioSystemPromptPreview(workloadId), [workloadId]);
  const previewMaxTokens =
    maxTokensOverride.trim() && Number.isFinite(Number(maxTokensOverride))
      ? Math.max(1, Math.floor(Number(maxTokensOverride)))
      : defaultMaxTokensForWorkload(workloadId);

  const onDetect = useCallback(async () => {
    setDetecting(true);
    setErrorLine(null);
    try {
      const resp = await fetch("/api/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setErrorLine(msg().stress.toast.detectFailed(resp.status, text.slice(0, 200)));
        return;
      }
      const j = (await resp.json()) as DetectResult;
      setDetect(j);
      // 자동 선택 우선순위:
      //   1) 저장된 lastSelectedModelId가 결과에 있으면 그것
      //   2) 모델이 1개면 그것
      //   3) 기존 selectedModelId가 결과에 없으면 해제
      const restoreId = lastSelectedModelIdRef.current;
      const hasRestore = restoreId != null && j.models.some((m) => m.id === restoreId);
      if (hasRestore) {
        setSelectedModelId(restoreId);
      } else if (j.models.length === 1) {
        setSelectedModelId(j.models[0].id);
      } else if (selectedModelId && !j.models.find((m) => m.id === selectedModelId)) {
        setSelectedModelId(null);
      }
      // 첫 detect 이후 자동 복원 시도는 무효화 — 사용자가 수동으로 바꾼 선택이 덮이지 않게.
      lastSelectedModelIdRef.current = null;
    } catch (e) {
      setErrorLine(msg().stress.toast.detectException(String(e)));
    } finally {
      setDetecting(false);
    }
  }, [apiKey, baseUrl, selectedModelId]);

  const onToggleModel = useCallback((id: string) => {
    if (running) return;
    setSelectedModelId((cur) => (cur === id ? null : id));
  }, [running]);

  const selectedRecord = useMemo<Record<string, boolean>>(() => {
    if (!selectedModelId) return {};
    return { [selectedModelId]: true };
  }, [selectedModelId]);

  const onSelectAll = useCallback((next: boolean) => {
    if (running) return;
    if (!next || !detect) {
      setSelectedModelId(null);
      return;
    }
    if (detect.models.length === 1) setSelectedModelId(detect.models[0].id);
  }, [detect, running]);

  const ramp: StressRampConfig = useMemo(
    () => ({ start: startCC, max: Math.max(startCC, maxCC), step: stepCC, durationMs }),
    [startCC, maxCC, stepCC, durationMs],
  );

  const totalStagesExpected = useMemo(() => {
    return Math.max(1, Math.floor((ramp.max - ramp.start) / ramp.step) + 1);
  }, [ramp]);

  const startRun = useCallback(async () => {
    // (1) 검증 먼저 — 통과 못하면 state는 그대로.
    if (!detect || !selectedModelId) {
      toast.error(msg().stress.toast.selectModel);
      return;
    }
    // (2) 검증 통과 후 일괄 초기화. 사전 슬롯 = min(ramp.max, STRESS_MAX_LIVE_CELLS).
    const slots = Math.min(ramp.max, STRESS_MAX_LIVE_CELLS);
    setRunStatus("running");
    setRunning(true);
    setStages([]);
    setErrorLine(null);
    setCells(Array.from({ length: slots }, () => emptyCellState()));
    setCurrentStageIndex(null);
    setCurrentConcurrency(0);
    setStageStartedAt(null);
    setStageDurationMs(null);
    setLiveTps(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/stress/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          detect,
          stress: {
            baseUrl,
            apiKey: apiKey || undefined,
            provider: detect.provider,
            modelId: selectedModelId,
            workloadId,
            ramp,
            maxTokens: maxTokensOverride.trim() ? previewMaxTokens : undefined,
            workerPromptSuffix,
            requestTimeoutMs,
            temperature: 0,
          },
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        setErrorLine(msg().stress.toast.serverError(resp.status, text.slice(0, 200)));
        // HTTP 응답 실패는 사전 할당된 빈 N칸이 남지 않도록 cells 롤백.
        setCells([]);
        setRunStatus("error");
        return;
      }
      await consumeSseJsonLines(resp.body, (ev) => {
        switch (ev.type) {
          case "stress_stage_started": {
            // cells는 startRun에서 사전 할당된 슬롯을 *유지* — 단계마다 재할당하지 않음.
            // 워커가 새 request_start 이벤트를 보내면 해당 슬롯이 자연스럽게 갱신됨.
            setCurrentStageIndex(ev.stage_index);
            setCurrentConcurrency(ev.concurrency);
            setStageStartedAt(performance.now());
            setStageDurationMs(ramp.durationMs);
            setLiveTps(null);
            break;
          }
          case "stress_worker_request_start": {
            if (ev.worker_index >= STRESS_MAX_LIVE_CELLS) break;
            setCells((prev) => {
              const next = [...prev];
              const cur = next[ev.worker_index] ?? emptyCellState();
              next[ev.worker_index] = {
                ...cur, // requestCount/lastTotalMs는 이전 값 보존; 명시적으로 증분
                status: "requesting",
                userPrompt: ev.user_prompt,
                systemPrompt: ev.system_prompt,
                responseText: "",
                reasoningText: "",
                errorMessage: undefined,
                requestCount: cur.requestCount + 1,
              };
              return next;
            });
            break;
          }
          case "stress_worker_token_delta": {
            if (ev.worker_index >= STRESS_MAX_LIVE_CELLS) break;
            setCells((prev) => {
              const next = [...prev];
              const cur = next[ev.worker_index] ?? emptyCellState();
              next[ev.worker_index] = {
                ...cur,
                status: "streaming",
                responseText: ev.reasoning ? cur.responseText : cur.responseText + ev.text,
                reasoningText: ev.reasoning ? cur.reasoningText + ev.text : cur.reasoningText,
              };
              return next;
            });
            break;
          }
          case "stress_worker_request_end": {
            if (ev.worker_index >= STRESS_MAX_LIVE_CELLS) break;
            setCells((prev) => {
              const next = [...prev];
              const cur = next[ev.worker_index] ?? emptyCellState();
              next[ev.worker_index] = {
                ...cur,
                status: ev.ok ? "done" : "error",
                errorMessage: ev.ok ? undefined : `${ev.error_code ?? ""} ${ev.error_message ?? ""}`.trim(),
                lastTotalMs: ev.total_ms,
              };
              return next;
            });
            break;
          }
          case "stress_stage_tick": {
            setLiveTps(ev.aggregate_tps_so_far);
            break;
          }
          case "stress_stage_finished": {
            setStages((prev) => [...prev, ev.result]);
            break;
          }
          case "run_finished": {
            setStages(ev.stages);
            setRunStatus("finished");
            setStageStartedAt(null);
            break;
          }
          case "error": {
            setErrorLine(`${ev.code}: ${ev.message}`);
            setRunStatus("error");
            toast.error(msg().stress.toast.benchError(ev.code));
            break;
          }
          default:
            break;
        }
      });
    } catch (e) {
      const err = e as { name?: string };
      if (err?.name === "AbortError") {
        setRunStatus("aborted");
        toast(msg().stress.toast.aborted);
      } else {
        setRunStatus("error");
        setErrorLine(msg().stress.toast.streamException(String(e)));
      }
      // 스트림 중 비-AbortError 예외는 그동안 보인 진행을 보존(cells 유지).
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [
    detect,
    selectedModelId,
    baseUrl,
    apiKey,
    workloadId,
    ramp,
    maxTokensOverride,
    workerPromptSuffix,
    requestTimeoutMs,
    previewMaxTokens,
  ]);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.intro.heading}</h2>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          {m.stress.intro.before}<strong>{m.stress.intro.emphasis}</strong>{m.stress.intro.after}
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.detect.heading}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">base URL</span>
            <input
              inputMode="url"
              className="min-w-[20rem] rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.detect.apiKeyLabel}</span>
            <input
              type="password"
              className="min-w-[12rem] rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={running}
            />
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            onClick={onDetect}
            disabled={detecting || running}
          >
            {detecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {m.stress.detect.detectBtn}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            className="mt-1"
            checked={persistApiKeyToDisk}
            onChange={(e) => setPersistApiKeyToDisk(e.target.checked)}
            disabled={running}
          />
          <span>
            <span className="font-medium text-[var(--foreground)]">{m.stress.detect.persistLabel}</span>
            <span className="mt-1 flex items-start gap-1 text-xs leading-snug">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
              {m.stress.detect.persistWarnBefore}<code className="rounded bg-[var(--surface)] px-1">sessionStorage</code>{m.stress.detect.persistWarnMid}
              <code className="rounded bg-[var(--surface)] px-1">localStorage</code>{m.stress.detect.persistWarnAfter}
            </span>
          </span>
        </label>
        {detect ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            provider=<span className="font-mono">{detect.provider}</span> · {m.stress.detect.models(detect.models.length)} ·{" "}
            {m.stress.detect.routes([detect.capabilities.openaiChat ? "chat_completions" : null, detect.capabilities.anthropicMessages ? "messages" : null].filter(Boolean).join(", ") || m.stress.detect.routesNone)}
          </p>
        ) : null}
      </section>

      {detect ? (
        <ProviderMemoryWidget baseUrl={baseUrl} provider={detect.provider} apiKey={apiKey || undefined} />
      ) : null}

      {detect && detect.models.length > 0 ? (
        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.model.heading}</h3>
          <ModelTable
            models={detect.models as DetectModel[]}
            selected={selectedRecord}
            onToggle={onToggleModel}
            onSelectAll={onSelectAll}
            sorting={sorting}
            onSortingChange={setSorting}
            selectionDisabled={running}
            benchActiveModelId={selectedModelId}
          />
          {selectedModelId ? (
            <p className="mt-2 text-xs text-[var(--muted)]">{m.stress.model.selectedLabel} <span className="font-mono">{selectedModelId}</span></p>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">{m.stress.model.hint}</p>
          )}
        </section>
      ) : null}

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.ramp.heading}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.workload}</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={workloadId}
              onChange={(e) => setWorkloadId(e.target.value as StressWorkloadId)}
              disabled={running}
            >
              {STRESS_WORKLOAD_IDS.map((id) => (
                <option key={id} value={id}>{m.stress.workload[id]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.startCC}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={256}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={startCC}
              onChange={(e) => setStartCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.maxCC}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={256}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={maxCC}
              onChange={(e) => setMaxCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.step}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={64}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={stepCC}
              onChange={(e) => setStepCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.stageDuration}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1000}
              max={600000}
              step={500}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={durationMs}
              onChange={(e) => setDurationMs(Math.max(1000, Number(e.target.value) || 1000))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">{m.stress.ramp.requestTimeout}</span>
            <input
              type="number"
              inputMode="numeric"
              min={5000}
              max={600000}
              step={1000}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={requestTimeoutMs}
              onChange={(e) => setRequestTimeoutMs(Math.max(5000, Number(e.target.value) || 5000))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">max_tokens (override)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={4096}
              placeholder={String(defaultMaxTokensForWorkload(workloadId))}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={maxTokensOverride}
              onChange={(e) => setMaxTokensOverride(e.target.value)}
              disabled={running}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={workerPromptSuffix}
              onChange={(e) => setWorkerPromptSuffix(e.target.checked)}
              disabled={running}
            />
            <span>{m.stress.ramp.perWorkerSuffix}</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {m.stress.ramp.expectedStages} <span className="font-mono">{totalStagesExpected}</span> · {m.stress.ramp.expectedLanguage}
          <span className="font-mono"> {expectedScript}</span>
        </p>
        {workloadId.startsWith("stress_long_context") ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {m.stress.ramp.longContextTips}
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.preview.heading}</h3>
        <div className="grid gap-2 text-xs">
          <div>
            <div className="text-[var(--muted)]">system</div>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 font-mono text-[11px]">{previewSystemPrompt}</pre>
          </div>
          <div>
            <div className="text-[var(--muted)]">user</div>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 font-mono text-[11px]">{previewUserPrompt}</pre>
          </div>
          <div className="text-[var(--muted)]">
            max_tokens: <span className="font-mono text-[var(--foreground)]">{previewMaxTokens}</span> · temperature: <span className="font-mono text-[var(--foreground)]">0</span>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              onClick={startRun}
              disabled={!detect || !selectedModelId}
            >
              <Play className="size-3.5" aria-hidden /> {m.stress.run.runBtn}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-red-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              onClick={onStop}
            >
              <Square className="size-3.5" aria-hidden /> {m.stress.run.stopBtn}
            </button>
          )}
          {running ? (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {/* 단계·동시성은 그리드 헤더에서 보여주므로, 상단 라인은 라이브 TPS만. */}
              {liveTps != null ? m.stress.run.running(liveTps.toFixed(1)) : m.stress.run.runningIdle}
            </span>
          ) : null}
          {errorLine ? <span className="text-xs text-red-500">{errorLine}</span> : null}
        </div>
      </section>

      <StressTpsChart stages={stages} />

      {cells.length > 0 ? (
        <StressMonitorGrid
          concurrency={currentConcurrency}
          cells={cells}
          runStatus={runStatus}
          lastStageIndex={currentStageIndex}
          stageStartedAt={stageStartedAt}
          stageDurationMs={stageDurationMs}
        />
      ) : null}

      <StressResultTable stages={stages} expectedScript={expectedScript} />

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)] shadow-sm">
        <strong className="text-[var(--foreground)]">{m.stress.memNote.label}</strong>{m.stress.memNote.body}
      </section>
    </div>
  );
}
