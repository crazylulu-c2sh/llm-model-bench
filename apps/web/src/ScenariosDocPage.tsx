import {
  PUBLIC_SCENARIO_IDS,
  getScenarioBenchMeta,
  getScenarioImageAssets,
  isVisionScenario,
} from "@llm-bench/shared";
import { Layers, ZoomIn } from "lucide-react";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";
import { VisionImageModal } from "./components/VisionImageModal";
import { defaultScenarioPromptPreview } from "./lib/scenario-prompt-preview";
import { useState } from "react";

function visionCategoryLabel(id: string): string | undefined {
  if (id.startsWith("vision_table_ocr")) return "OCR";
  if (id.startsWith("vision_count_red_cars")) return "카운트";
  if (id.startsWith("vision_chart_peak")) return "차트";
  if (id.startsWith("vision_meme_explain")) return "밈";
  if (id.startsWith("vision_wireframe_html")) return "와이어프레임";
  return undefined;
}

export function ScenariosDocPage() {
  const [hlPreview, setHlPreview] = useState(false);
  const [modal, setModal] = useState<{ url: string; scenarioId: string; category?: string } | null>(null);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;

  return (
    <div className="space-y-8">
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Layers className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          벤치 시나리오 문서
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          벤치 화면의 시나리오 카드는 목적·합격 기준만 요약합니다. 여기서는 동일 메타데이터를 확장 필드로 풀고, 실제 벤치와 같은 규칙으로 생성되는{" "}
          <strong className="text-[var(--foreground)]">사용자 프롬프트 미리보기</strong>를 둡니다(일부 시나리오는 현재 시각·origin이
          포함됩니다). 비전 시나리오는 입력 이미지 썸네일을 클릭하면 확대해 볼 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <HighlightToggle on={hlPreview} onChange={setHlPreview} />
        </div>
      </section>

      <div className="space-y-6">
        {PUBLIC_SCENARIO_IDS.map((id) => {
          const meta = getScenarioBenchMeta(id);
          const preview = defaultScenarioPromptPreview(id);
          const isVision = isVisionScenario(id);
          const images = isVision ? getScenarioImageAssets(id, baseUrl) : [];
          return (
            <article
              key={id}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-[var(--foreground)]">{id}</h3>
                {isVision ? (
                  <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Vision
                  </span>
                ) : null}
              </div>
              {images.length > 0 ? (
                <button
                  type="button"
                  className="group mt-3 relative block w-full max-w-2xl overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)] cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  onClick={() =>
                    setModal({
                      url: images[0].url,
                      scenarioId: id,
                      category: visionCategoryLabel(id),
                    })
                  }
                  aria-label={`${id} 이미지 확대`}
                >
                  <img
                    src={images[0].url}
                    alt={images[0].alt}
                    loading="lazy"
                    className="block w-full max-h-64 object-contain"
                  />
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                  >
                    <ZoomIn className="size-3" />
                    확대
                  </span>
                </button>
              ) : null}
              {meta ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">목적</h4>
                    <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.purposeKo}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">합격 / 불합격 기준</h4>
                    <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.criteriaKo}</p>
                  </div>
                  {meta.promptNotesKo ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">프롬프트·주입</h4>
                      <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.promptNotesKo}</p>
                    </div>
                  ) : null}
                  {meta.toolsSummaryKo ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">도구</h4>
                      <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.toolsSummaryKo}</p>
                    </div>
                  ) : null}
                  {meta.routesKo ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">API 라우트</h4>
                      <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.routesKo}</p>
                    </div>
                  ) : null}
                  {meta.implementationKo ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">채점·실행</h4>
                      <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.implementationKo}</p>
                    </div>
                  ) : null}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">사용자 메시지 미리보기</h4>
                    <div className="mt-2">
                      <JsonCodeBlock code={preview} enabled={hlPreview} maxHeight={320} language="markdown" />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted)]">등록된 설명이 없습니다.</p>
              )}
            </article>
          );
        })}
      </div>
      <VisionImageModal
        open={modal !== null}
        imageUrl={modal?.url ?? ""}
        scenarioId={modal?.scenarioId ?? ""}
        categoryLabel={modal?.category}
        onClose={() => setModal(null)}
      />
    </div>
  );
}
