import {
  PUBLIC_SCENARIO_IDS,
  getScenarioBenchMeta,
  getScenarioImageAssets,
  isVisionScenario,
  visionSubcategory,
} from "@llm-bench/shared";
import { Layers, ZoomIn } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
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
  const { m, locale } = useI18n();
  const touched = touchedScenarioIds ?? [];
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const [modal, setModal] = useState<{ url: string; scenarioId: string; category?: string } | null>(null);
  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
      <h2 className="mb-3 inline-flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
        <Layers className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
        {m.bench.scenarioGuideHeading}
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
        {m.bench.scenarioGuideIntroA}<strong>Vision</strong>{m.bench.scenarioGuideIntroB}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PUBLIC_SCENARIO_IDS.map((id) => {
          const meta = getScenarioBenchMeta(id, locale);
          const active = Boolean(currentScenario && currentScenario === id);
          const wasTouched = running && touched.includes(id);
          const cardBench =
            running && active
              ? "scenario-guide-card--bench-active"
              : running && wasTouched && !active
                ? "scenario-guide-card--bench-touched border-[var(--border)]"
                : "border-[var(--border)]";
          const isVision = isVisionScenario(id);
          const visionSub = visionSubcategory(id);
          const visionLabel = visionSub ? m.docs.visionSubcategory[visionSub] : undefined;
          const images = isVision
            ? getScenarioImageAssets(id, baseUrl, (sub, sid) =>
                sub ? m.docs.imageAlt(m.docs.visionSubcategory[sub], sid) : sid,
              )
            : [];
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
                      category: visionLabel,
                    })
                  }
                  aria-label={m.bench.enlargeImageAria(id)}
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
                    {m.bench.enlarge}
                  </span>
                </button>
              ) : null}
              {meta ? (
                <>
                  <p className="mt-2 leading-relaxed text-[var(--muted)]">{meta.purpose}</p>
                  <details className="mt-2 border-t border-[var(--border)] pt-2">
                    <summary className="cursor-pointer select-none font-semibold text-[var(--foreground)]">
                      {m.bench.passFailCriteria}
                    </summary>
                    <p className="mt-1.5 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.criteria}</p>
                  </details>
                </>
              ) : (
                <p className="mt-2 text-[var(--muted)]">{m.bench.noDescription}</p>
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
