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
import { Loader2, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SortingState } from "@tanstack/react-table";
import { DEFAULT_MODEL_TABLE_SORTING, ModelTable } from "./components/ModelTable";
import { StressMonitorGrid, emptyCellState, type StressCellState } from "./components/StressMonitorGrid";
import { StressResultTable } from "./components/StressResultTable";
import { StressTpsChart } from "./components/StressTpsChart";

type DetectModel = DetectResult["models"][number];

const WORKLOAD_LABEL: Record<StressWorkloadId, string> = {
  stress_ping: "짧은 ping (영어)",
  stress_short_reply: "짧은 문장 응답 (영어)",
  stress_short_reply_ko: "짧은 문장 응답 (한국어)",
  stress_short_reply_ja: "짧은 문장 응답 (일본어)",
};

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
  const [baseUrl, setBaseUrl] = useState<string>(() => {
    try {
      const raw = window.localStorage.getItem("llm_bench_ui_prefs");
      if (raw) {
        const j = JSON.parse(raw) as { baseUrl?: string };
        if (typeof j.baseUrl === "string" && j.baseUrl) return j.baseUrl;
      }
    } catch {}
    return "http://localhost:1234";
  });
  const [apiKey, setApiKey] = useState<string>("");
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>(() => DEFAULT_MODEL_TABLE_SORTING);

  const [workloadId, setWorkloadId] = useState<StressWorkloadId>("stress_ping");
  const [startCC, setStartCC] = useState(1);
  const [maxCC, setMaxCC] = useState(8);
  const [stepCC, setStepCC] = useState(1);
  const [durationMs, setDurationMs] = useState(5000);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(30000);
  const [workerPromptSuffix, setWorkerPromptSuffix] = useState(true);
  const [maxTokensOverride, setMaxTokensOverride] = useState<string>("");

  const [running, setRunning] = useState(false);
  // runStatus는 그리드/헤더 메시지용. running boolean은 폼·버튼 비활성용으로만 유지.
  // 종료 후(finished/aborted/error)는 다음 startRun까지 그대로 유지 → 그리드 스냅샷 보존.
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "finished" | "aborted" | "error">("idle");
  const [stages, setStages] = useState<StressStageResult[]>([]);
  const [currentStageIndex, setCurrentStageIndex] = useState<number | null>(null);
  const [currentConcurrency, setCurrentConcurrency] = useState<number>(0);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [cells, setCells] = useState<StressCellState[]>([]);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
        setErrorLine(`감지 실패: ${resp.status} ${text.slice(0, 200)}`);
        return;
      }
      const j = (await resp.json()) as DetectResult;
      setDetect(j);
      if (j.models.length === 1) setSelectedModelId(j.models[0].id);
      else if (selectedModelId && !j.models.find((m) => m.id === selectedModelId)) setSelectedModelId(null);
    } catch (e) {
      setErrorLine(`감지 예외: ${String(e)}`);
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
      toast.error("프로바이더를 감지하고 모델 1개를 선택하세요.");
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
        setErrorLine(`서버 오류: ${resp.status} ${text.slice(0, 200)}`);
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
            break;
          }
          case "error": {
            setErrorLine(`${ev.code}: ${ev.message}`);
            setRunStatus("error");
            toast.error(`프로바이더 벤치 오류: ${ev.code}`);
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
        toast("중단됨 — 부분 결과가 유지됩니다.");
      } else {
        setRunStatus("error");
        setErrorLine(`스트림 예외: ${String(e)}`);
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
        <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">프로바이더 벤치 — v1</h2>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          같은 모델을 여러 사용자가 동시에 사용할 때 처리량(TPS)이 어떻게 변하는지 측정합니다. 1순위 지표는 <strong>동시 사용자 수 대비 집계 TPS</strong>입니다. 메모리·CPU 사용량 등 OS 지표는 v1에서 제공하지 않습니다.
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">1) 프로바이더 감지</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">base URL</span>
            <input
              className="min-w-[20rem] rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">API key (선택)</span>
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
            감지
          </button>
        </div>
        {detect ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            provider=<span className="font-mono">{detect.provider}</span> · 모델 {detect.models.length}개 ·
            라우트 {[detect.capabilities.openaiChat ? "chat_completions" : null, detect.capabilities.anthropicMessages ? "messages" : null].filter(Boolean).join(", ") || "없음"}
          </p>
        ) : null}
      </section>

      {detect && detect.models.length > 0 ? (
        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">2) 모델 선택 (단일)</h3>
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
            <p className="mt-2 text-xs text-[var(--muted)]">선택됨: <span className="font-mono">{selectedModelId}</span></p>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">v1은 *한 모델*만 측정합니다. 행을 한 번 더 클릭해 해제 가능.</p>
          )}
        </section>
      ) : null}

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">3) 워크로드 & ramp</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">워크로드</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={workloadId}
              onChange={(e) => setWorkloadId(e.target.value as StressWorkloadId)}
              disabled={running}
            >
              {STRESS_WORKLOAD_IDS.map((id) => (
                <option key={id} value={id}>{WORKLOAD_LABEL[id]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">시작 동시성</span>
            <input
              type="number"
              min={1}
              max={256}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={startCC}
              onChange={(e) => setStartCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">최대 동시성</span>
            <input
              type="number"
              min={1}
              max={256}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={maxCC}
              onChange={(e) => setMaxCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">스텝</span>
            <input
              type="number"
              min={1}
              max={64}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              value={stepCC}
              onChange={(e) => setStepCC(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">단계 duration (ms)</span>
            <input
              type="number"
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
            <span className="text-[var(--muted)]">요청 timeout (ms)</span>
            <input
              type="number"
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
            <span>워커별 client 접미사</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          예상 단계 수: <span className="font-mono">{totalStagesExpected}</span> · 예상 응답 언어:
          <span className="font-mono"> {expectedScript}</span>
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">4) 프롬프트 미리보기 (실제 요청과 동일)</h3>
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
              <Play className="size-3.5" aria-hidden /> 실행
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-red-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              onClick={onStop}
            >
              <Square className="size-3.5" aria-hidden /> 중지
            </button>
          )}
          {running ? (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {/* 단계·동시성은 그리드 헤더에서 보여주므로, 상단 라인은 라이브 TPS만. */}
              {liveTps != null ? `실행 중 · 라이브 TPS ${liveTps.toFixed(1)}` : "실행 중…"}
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
        />
      ) : null}

      <StressResultTable stages={stages} expectedScript={expectedScript} />

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)] shadow-sm">
        <strong className="text-[var(--foreground)]">메모리 지표</strong>: v1에서는 N/A — LM Studio REST API에 런타임 메모리 엔드포인트가 없어 스코프 아웃했습니다.
      </section>
    </div>
  );
}
