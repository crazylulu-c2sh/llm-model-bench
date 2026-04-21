import { getScenarioBenchMeta } from "@llm-bench/shared";
import { X } from "lucide-react";
import { JsonCodeBlock } from "./JsonCodeBlock";

export type ScenarioDetailPayload = {
  title: string;
  scenario: string;
  api: string;
  modelId?: string;
  ttft_ms: number | null;
  tpot_ms: number | null;
  pass?: boolean;
  qualityReason?: string;
  prompt: string;
  outputText: string;
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
  if (!open || !payload) return null;

  const benchMeta = getScenarioBenchMeta(payload.scenario);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-detail-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-2xl flex-col rounded-t-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="scenario-detail-title" className="text-sm font-semibold text-[var(--foreground)]">
              시나리오 상세
            </h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--muted)]">{payload.title}</p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            onClick={onClose}
            aria-label="패널 닫기"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <span className="text-[var(--muted)]">시나리오</span>
              <p className="font-mono text-[var(--foreground)]">{payload.scenario}</p>
            </div>
            <div>
              <span className="text-[var(--muted)]">API</span>
              <p className="text-[var(--foreground)]">{payload.api}</p>
            </div>
            {payload.modelId ? (
              <div>
                <span className="text-[var(--muted)]">모델</span>
                <p className="font-mono text-[var(--foreground)]">{payload.modelId}</p>
              </div>
            ) : null}
            <div>
              <span className="text-[var(--muted)]">TTFT / TPOT</span>
              <p className="font-mono text-[var(--foreground)]">
                {payload.ttft_ms != null ? `${Math.round(payload.ttft_ms)} ms` : "—"} ·{" "}
                {payload.tpot_ms != null ? `${Math.round(payload.tpot_ms)} ms` : "—"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[var(--muted)]">품질</span>
              <p className="text-[var(--foreground)]">
                {payload.pass === true ? "통과" : payload.pass === false ? "실패" : "—"}
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
                  <span className="font-semibold text-[var(--foreground)]">시나리오 목적</span>
                  <p className="mt-0.5 leading-relaxed text-[var(--muted)]">{benchMeta.purposeKo}</p>
                </div>
                <div>
                  <span className="font-semibold text-[var(--foreground)]">합격 / 불합격 기준</span>
                  <p className="mt-0.5 leading-relaxed text-[var(--muted)]">{benchMeta.criteriaKo}</p>
                </div>
              </div>
            ) : (
              <p className="sm:col-span-2 text-xs text-[var(--muted)]">
                등록되지 않은 시나리오라 목적·기준 설명을 불러올 수 없습니다.
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">프롬프트</h3>
            <JsonCodeBlock code={payload.prompt || "—"} language="markdown" enabled={hlPreview} maxHeight={200} />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">모델 출력 (마지막 측정 런)</h3>
            <JsonCodeBlock code={payload.outputText || "—"} language="markdown" enabled={hlPreview} maxHeight={320} />
          </div>
        </div>
      </div>
    </div>
  );
}
