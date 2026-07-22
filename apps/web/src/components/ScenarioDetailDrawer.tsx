import {
  formatTtftMs,
  getScenarioBenchMeta,
  isVisionScenario,
  partitionThinkingBlocks,
  scoreToRubric,
} from "@llm-bench/shared";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { JsonCodeBlock } from "./JsonCodeBlock";
import { CopyButton } from "./CopyButton";
import { buildScenarioDetailClipboardText } from "./scenario-detail-clipboard";
import { useScrollLock } from "../useScrollLock";
import { useFocusTrap } from "../useFocusTrap";
import { useI18n } from "../i18n";

export type ScenarioDetailPayload = {
  title: string;
  scenario: string;
  api: string;
  modelId?: string;
  ttft_ms: number | null;
  pass?: boolean;
  /** 0~1 점수. 비전 시나리오에서 rubric 0~3과 함께 표시. */
  score?: number;
  qualityReason?: string;
  systemPrompt: string;
  userPrompt: string;
  outputText: string;
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의 경고 */
  reasoningHidden?: boolean;
  /** #1922: 스트리밍 tool_call 인자 연결 손상 감지 → LM Studio 엔진 프로토콜 회귀 경고 */
  toolCallArgsCorrupted?: boolean;
  /** chat 라우트에서 추론이 content로 새어 들어옴 → 엔진 프로토콜 회귀 경고 */
  reasoningLeakedIntoContent?: boolean;
  /** 마지막으로 표시 중인 측정 런(1-based) / 총 측정 런 수 */
  measuredRunIndex?: number;
  measuredRunTotal?: number;
};

export function ScenarioDetailDrawer({
  open,
  payload,
  hlPreview,
  onClose,
}: {
  open: boolean;
  payload: ScenarioDetailPayload | null;
  hlPreview: boolean;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useScrollLock(open && payload != null);
  useFocusTrap(panelRef, open && payload != null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open || !payload) return null;

  const benchMeta = getScenarioBenchMeta(payload.scenario, locale);
  const { thinking, response } = partitionThinkingBlocks(payload.outputText ?? "");
  const showThinkingSplit = thinking.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-detail-title"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        aria-label={m.results.detail.close}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative z-10 flex max-h-[min(92svh,720px)] w-full max-w-2xl flex-col rounded-t-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-xl sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="scenario-detail-title" className="text-sm font-semibold text-[var(--foreground)]">
              {m.results.detail.title}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--muted)]">{payload.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CopyButton
              text={buildScenarioDetailClipboardText(payload, m, locale)}
              label={m.results.detail.copyAll}
              copiedLabel={m.results.detail.copied}
              title={m.results.detail.copyAllTitle}
            />
            <button
              ref={closeRef}
              type="button"
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              onClick={onClose}
              aria-label={m.results.detail.closePanel}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm">
          {payload.toolCallArgsCorrupted || payload.reasoningLeakedIntoContent ? (
            <div className="flex items-start gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs leading-snug text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                {payload.toolCallArgsCorrupted ? (
                  <p>
                    <strong>{m.results.toolArgsCorrupted}</strong>
                    {m.results.detail.toolArgsCorruptedLead}
                    <code className="font-mono">{"{}{}"}</code>
                    {m.results.detail.toolArgsCorruptedTail}
                  </p>
                ) : null}
                {payload.reasoningLeakedIntoContent ? (
                  <p>
                    <strong>{m.results.reasoningLeak}</strong>
                    {m.results.detail.reasoningLeakDesc}
                  </p>
                ) : null}
                <p>
                  {m.results.detail.engineNoteLead}
                  <strong>{m.results.detail.engineNoteStrong}</strong>
                  {m.results.detail.engineNoteMid}
                  <a
                    className="underline"
                    href="/profile#lmstudio-host"
                    target="_blank"
                    rel="noreferrer"
                    title={m.results.newWindowTitle}
                  >
                    {m.results.actionGuide}
                    <span className="sr-only"> {m.results.newWindowSuffix}</span>
                  </a>
                </p>
              </div>
            </div>
          ) : null}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <span className="text-[var(--muted)]">{m.results.detail.fieldScenario}</span>
              <p className="font-mono text-[var(--foreground)]">{payload.scenario}</p>
            </div>
            <div>
              <span className="text-[var(--muted)]">API</span>
              <p className="text-[var(--foreground)]">{payload.api}</p>
            </div>
            {payload.modelId ? (
              <div>
                <span className="text-[var(--muted)]">{m.results.detail.fieldModel}</span>
                <p className="font-mono text-[var(--foreground)]">{payload.modelId}</p>
              </div>
            ) : null}
            <div>
              <span className="text-[var(--muted)]">TTFT</span>
              <p className="font-mono text-[var(--foreground)]">
                {payload.ttft_ms != null ? `${formatTtftMs(payload.ttft_ms)} ms` : "—"}
              </p>
              {payload.reasoningHidden ? (
                <p className="mt-1 inline-flex items-start gap-1 text-[11px] leading-snug text-[var(--warning)]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>{m.results.detail.reasoningHiddenNote}</span>
                </p>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <span className="text-[var(--muted)]">{m.results.detail.fieldQuality}</span>
              <p className="text-[var(--foreground)]">
                {(() => {
                  const vision = isVisionScenario(payload.scenario);
                  if (vision && typeof payload.score === "number") {
                    const rubric = scoreToRubric(payload.score);
                    const label =
                      payload.pass === true
                        ? m.results.pass
                        : payload.pass === false
                          ? m.results.notPass
                          : "—";
                    return m.results.qualityVisionLine(rubric ?? "?", payload.score.toFixed(2), label);
                  }
                  return payload.pass === true
                    ? m.results.pass
                    : payload.pass === false
                      ? m.results.fail
                      : "—";
                })()}
                {payload.qualityReason ? (
                  <span className="mt-1 block whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs">
                    {payload.qualityReason}
                  </span>
                ) : null}
              </p>
            </div>
            {benchMeta ? (
              <div className="sm:col-span-2 space-y-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                <div>
                  <span className="font-semibold text-[var(--foreground)]">{m.results.detail.purposeTitle}</span>
                  <p className="mt-0.5 leading-relaxed text-[var(--muted)]">{benchMeta.purpose}</p>
                </div>
                <div>
                  <span className="font-semibold text-[var(--foreground)]">{m.results.detail.criteriaTitle}</span>
                  <p className="mt-0.5 whitespace-pre-line leading-relaxed text-[var(--muted)]">{benchMeta.criteria}</p>
                </div>
              </div>
            ) : (
              <p className="sm:col-span-2 text-xs text-[var(--muted)]">
                {m.results.detail.noMeta}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">System Prompt</h3>
            <JsonCodeBlock code={payload.systemPrompt || "—"} language="markdown" enabled={hlPreview} maxHeight={160} />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">User Prompt</h3>
            <JsonCodeBlock code={payload.userPrompt || "—"} language="markdown" enabled={hlPreview} maxHeight={220} />
          </div>
          {showThinkingSplit ? (
            <>
              {payload.measuredRunIndex != null && payload.measuredRunTotal != null ? (
                <p className="text-xs text-[var(--muted)]">
                  {m.results.detail.measuredRunNote(payload.measuredRunIndex, payload.measuredRunTotal)}
                </p>
              ) : null}
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{m.results.detail.thinkingBlock}</h3>
                <JsonCodeBlock code={thinking || "—"} language="markdown" enabled={hlPreview} maxHeight={240} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{m.results.detail.finalResponse}</h3>
                  <CopyButton text={response} title={m.results.detail.copyFinalTitle} />
                </div>
                <JsonCodeBlock code={response || "—"} language="markdown" enabled={hlPreview} maxHeight={320} />
              </div>
            </>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {m.results.detail.modelOutput}
                  {payload.measuredRunIndex != null && payload.measuredRunTotal != null
                    ? m.results.measuredSuffix(payload.measuredRunIndex, payload.measuredRunTotal)
                    : m.results.lastMeasuredSuffix}
                </h3>
                <CopyButton text={response} title={m.results.detail.copyOutputTitle} />
              </div>
              <JsonCodeBlock code={payload.outputText || "—"} language="markdown" enabled={hlPreview} maxHeight={320} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
