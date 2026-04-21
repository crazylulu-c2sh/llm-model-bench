import type { DetectResult, StreamEvent } from "@llm-bench/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  Activity,
  AlertTriangle,
  Download,
  KeyRound,
  Link2,
  Loader2,
  Monitor,
  Moon,
  Play,
  Sun,
  SunMoon,
} from "lucide-react";
import { BenchCharts } from "./components/BenchCharts";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";
import { ModelTable } from "./components/ModelTable";
import { ProviderSummary } from "./components/ProviderSummary";
import type { ResultRow } from "./components/ResultsTable";
import { ResultsTable } from "./components/ResultsTable";
import { rowsToChartData } from "./components/chart-types";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { readInitialUiState, saveUiSnapshot } from "./persisted-settings";
import type { ThemeChoice } from "./useTheme";
import { useTheme } from "./useTheme";

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
  const [boot] = useState(() => readInitialUiState());
  const [baseUrl, setBaseUrl] = useState(boot.baseUrl);
  const [apiKey, setApiKey] = useState(boot.apiKey);
  const [persistApiKeyToDisk, setPersistApiKeyToDisk] = useState(boot.persistApiKeyToDisk);
  const [parallel, setParallel] = useState(boot.parallel);
  const [unloadOtherModels, setUnloadOtherModels] = useState(boot.unloadOtherModels);
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

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveUiSnapshot({
        baseUrl,
        parallel,
        unloadOtherModels,
        hlPreview,
        hlLog,
        persistApiKeyToDisk,
        apiKey,
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [apiKey, baseUrl, hlLog, hlPreview, parallel, persistApiKeyToDisk, unloadOtherModels]);

  const appendLog = useCallback((s: string) => {
    setLog((prev) => [...prev.slice(-400), s]);
  }, []);

  const chartRows = useMemo(() => rowsToChartData(rows), [rows]);

  const runDetect = useCallback(async () => {
    setDetecting(true);
    setDetect(null);
    setRows([]);
    setLog([]);
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
      setDetect(j as DetectResult);
      const sel: Record<string, boolean> = {};
      for (const m of (j as DetectResult).models) sel[m.id] = false;
      setSelected(sel);
      appendLog(`provider=${(j as DetectResult).provider} models=${(j as DetectResult).models.length}`);
      toast.success(
        `감지 완료 · ${(j as DetectResult).provider} · 모델 ${(j as DetectResult).models.length}개`,
      );
      saveUiSnapshot({
        baseUrl,
        parallel,
        unloadOtherModels,
        hlPreview,
        hlLog,
        persistApiKeyToDisk,
        apiKey,
      });
    } catch (e) {
      appendLog(String(e));
      toast.error("감지 요청 중 오류가 발생했습니다.");
    } finally {
      setDetecting(false);
    }
  }, [apiKey, appendLog, baseUrl, hlLog, hlPreview, parallel, persistApiKeyToDisk, unloadOtherModels]);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const selectAllModels = useCallback(
    (next: boolean) => {
      if (!detect) return;
      setSelected((s) => {
        const o = { ...s };
        for (const m of detect.models) o[m.id] = next;
        return o;
      });
    },
    [detect],
  );

  const runBench = useCallback(async () => {
    if (!detect) return;
    const models = detect.models.filter((m) => selected[m.id]);
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
    setPreview("");
    let anyHttpFail = false;
    let streamErrorCount = 0;
    for (const m of models) {
      appendLog(`bench start model=${m.id}`);
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
            },
          }),
        });
        if (!r.ok || !r.body) {
          anyHttpFail = true;
          appendLog(`bench http error ${r.status}`);
          continue;
        }
        await consumeSseJsonLines(r.body, (ev) => {
          if (ev.type === "token_delta") {
            setPreview((p) => (p + ev.text).slice(-8000));
          }
          if (ev.type === "scenario_end") {
            setRows((prev) => [
              ...prev,
              {
                scenario: ev.scenario_id,
                api: ev.api_route ?? "?",
                ttft_ms: ev.metrics.ttft_ms ?? null,
                tpot_ms: ev.metrics.tpot_ms ?? null,
                pass: ev.quality?.pass,
              },
            ]);
          }
          if (ev.type === "error") {
            streamErrorCount += 1;
            appendLog(`error[${ev.layer}] ${ev.code}: ${ev.message}`);
          }
        });
      } catch (e) {
        anyHttpFail = true;
        appendLog(String(e));
      }
    }
    setRunning(false);
    appendLog("bench finished");
    if (anyHttpFail || streamErrorCount > 0) {
      toast.warning("벤치 종료 — 일부 오류가 있었습니다. 로그를 확인하세요.");
    } else {
      toast.success("벤치가 모두 완료되었습니다.");
    }
  }, [apiKey, appendLog, detect, parallel, selected, unloadOtherModels]);

  const requestBench = useCallback(() => {
    if (!detect) return;
    const models = detect.models.filter((m) => selected[m.id]);
    if (!models.length) {
      toast.error("벤치할 모델을 하나 이상 선택하세요.");
      return;
    }
    setBenchConfirmOpen(true);
  }, [detect, selected]);

  const handleConfirmBench = useCallback(() => {
    setBenchConfirmOpen(false);
    void runBench();
  }, [runBench]);

  const benchSelectedModels = useMemo(() => {
    if (!detect) return [];
    return detect.models.filter((m) => selected[m.id]);
  }, [detect, selected]);

  const logText = log.join("\n");

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
              선택된 모델 <strong className="text-[var(--foreground)]">{benchSelectedModels.length}</strong>개
              {detect.provider === "lm_studio" ? " · LM Studio에서 로드/언로드가 동작할 수 있습니다." : ""}
            </p>
            <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto font-mono text-xs text-[var(--foreground)]">
              {benchSelectedModels.map((m) => (
                <li key={m.id}>{m.label ?? m.id}</li>
              ))}
            </ul>
            <ul className="mt-2 space-y-1 text-xs">
              {parallel ? (
                <li className="text-[var(--danger)]">병렬 실행이 켜져 있습니다. GPU 부하에 유의하세요.</li>
              ) : null}
              {unloadOtherModels && detect.provider === "lm_studio" ? (
                <li>벤치 대상 외 모델 언로드가 켜져 있습니다(감지 목록 기준).</li>
              ) : null}
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-2)] px-6 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--accent)]">
            <Activity className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">LLM Model Bench</h1>
            <p className="text-sm text-[var(--muted)]">로컬 프로바이더 감지 · 스트리밍 벤치</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
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
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
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
              <span className="mt-0.5 block text-xs leading-snug">
                켜면 각 벤치 시작 전 감지된 다른 모델 키에 대해 unload를 베스트 에포트로 호출합니다. 실패해도 벤치는 계속됩니다.
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
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm shadow-sm disabled:opacity-50"
              onClick={requestBench}
              disabled={!detect || running}
              aria-busy={running}
              aria-label="선택한 모델 벤치 실행"
            >
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              선택 모델 벤치
            </button>
          </div>
          {detect ? <ProviderSummary detect={detect} /> : null}
        </section>

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <Monitor className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            모델 선택
          </h2>
          {detecting ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              프로바이더 감지 중…
            </p>
          ) : detect && detect.models.length > 0 ? (
            <ModelTable models={detect.models} selected={selected} onToggle={toggle} onSelectAll={selectAllModels} />
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

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            메트릭 차트
          </h2>
          <BenchCharts chartRows={chartRows} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">토큰 프리뷰 (스트림)</h2>
              <HighlightToggle on={hlPreview} onChange={setHlPreview} />
            </div>
            <JsonCodeBlock code={preview || "—"} language="markdown" enabled={hlPreview} maxHeight={280} />
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
            <h2 className="mb-3 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">결과 테이블</h2>
            <ResultsTable rows={rows} />
          </div>
        </section>

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">로그</h2>
            <div className="flex flex-wrap items-center gap-3">
              <HighlightToggle on={hlLog} onChange={setHlLog} />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs disabled:opacity-50"
                disabled={!rows.length}
                onClick={() => {
                  const blob = new Blob([JSON.stringify({ rows, baseUrl, provider: detect?.provider }, null, 2)], {
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
        </section>
      </main>
    </div>
  );
}
