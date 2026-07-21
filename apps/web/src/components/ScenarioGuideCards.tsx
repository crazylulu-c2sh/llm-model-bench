import {
  PUBLIC_SCENARIO_IDS,
  getScenarioBenchMeta,
  getScenarioImageAssets,
  isVisionScenario,
  visionSubcategoryLabel,
} from "@llm-bench/shared";
import { Layers, ZoomIn } from "lucide-react";
import { useState } from "react";
import { VisionImageModal } from "./VisionImageModal";

export function ScenarioGuideCards({
  currentScenario,
  running = false,
  touchedScenarioIds,
}: {
  currentScenario?: string | null;
  running?: boolean;
  touchedScenarioIds?: readonly string[];
}) {
  const touched = touchedScenarioIds ?? [];
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const [modal, setModal] = useState<{ url: string; scenarioId: string; category?: string } | null>(null);
  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
      <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
        <Layers className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
        벤치 시나리오 안내
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
        각 카드는 해당 시나리오가 무엇을 검증하는지 요약합니다. <strong>Vision</strong> 뱃지 카드는 이미지 입력을 받으며 비전 미지원 모델에서는 400을 받을 수 있습니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PUBLIC_SCENARIO_IDS.map((id) => {
          const meta = getScenarioBenchMeta(id);
          const active = Boolean(currentScenario && currentScenario === id);
          const wasTouched = running && touched.includes(id);
          const cardBench =
            running && active
              ? "scenario-guide-card--bench-active"
              : running && wasTouched && !active
                ? "scenario-guide-card--bench-touched border-[var(--border)]"
                : "border-[var(--border)]";
          const isVision = isVisionScenario(id);
          const images = isVision ? getScenarioImageAssets(id, baseUrl) : [];
          return (
            <article
              key={id}
              className={["rounded-md border bg-[var(--surface)] p-3 text-xs shadow-sm transition-[box-shadow,border-color]", cardBench].join(
                " ",
              )}
              aria-current={active ? "true" : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-mono text-[11px] font-medium text-[var(--foreground)]">{id}</h3>
                {isVision ? (
                  <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-2)]">
                    Vision
                  </span>
                ) : null}
              </div>
              {images.length > 0 ? (
                <button
                  type="button"
                  className="group mt-2 relative block w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-2)] cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  onClick={() =>
                    setModal({
                      url: images[0].url,
                      scenarioId: id,
                      category: visionSubcategoryLabel(id),
                    })
                  }
                  aria-label={`${id} 이미지 확대`}
                >
                  <img
                    src={images[0].url}
                    alt={images[0].alt}
                    loading="lazy"
                    className="block w-full max-h-40 object-contain"
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
                <>
                  <p className="mt-2 leading-relaxed text-[var(--muted)]">{meta.purposeKo}</p>
                  <details className="mt-2 border-t border-[var(--border)] pt-2">
                    <summary className="cursor-pointer select-none font-semibold text-[var(--foreground)]">
                      합격 / 불합격 기준
                    </summary>
                    <p className="mt-1.5 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.criteriaKo}</p>
                  </details>
                </>
              ) : (
                <p className="mt-2 text-[var(--muted)]">등록된 설명이 없습니다.</p>
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
    </section>
  );
}
