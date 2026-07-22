import {
  BUILTIN_AGENT_LOOP_IDS,
  DEFAULT_CALENDAR_TIMEZONE,
  PUBLIC_SCENARIO_IDS,
  getScenarioBenchMeta,
  getScenarioImageAssets,
  isVisionScenario,
  scenarioCategory,
  visionSubcategory,
  type ScenarioId,
  type VisionSubcategory,
} from "@llm-bench/shared";
import { Layers, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";
import { VisionImageModal } from "./components/VisionImageModal";
import { defaultScenarioBenchRequestPreview } from "./lib/scenario-prompt-preview";
import { useI18n } from "./i18n";

function formatRequestJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const TEXT_SCENARIO_IDS = PUBLIC_SCENARIO_IDS.filter((id) => scenarioCategory(id) === "text");
const VISION_SCENARIO_IDS_PUBLIC = PUBLIC_SCENARIO_IDS.filter((id) => scenarioCategory(id) === "vision");
const AGENT_SCENARIO_IDS: readonly string[] = BUILTIN_AGENT_LOOP_IDS;

const VISION_SUBCATEGORIES = ["ocr", "count", "chart", "meme", "wireframe"] as const satisfies readonly VisionSubcategory[];

function scenariosInVisionSubcategory(sub: VisionSubcategory): ScenarioId[] {
  return VISION_SCENARIO_IDS_PUBLIC.filter((id) => visionSubcategory(id) === sub);
}

function ScenarioArticle({
  id,
  hlPreview,
  calendarReferenceIso,
  baseUrl,
  onImageClick,
}: {
  id: ScenarioId;
  hlPreview: boolean;
  calendarReferenceIso: string;
  baseUrl: string | undefined;
  onImageClick: (url: string, scenarioId: string, category?: string) => void;
}) {
  const { locale, m } = useI18n();
  const s = m.docs.scenarios;
  const meta = getScenarioBenchMeta(id, locale);
  const subLabel = (sid: string): string | undefined => {
    const sub = visionSubcategory(sid);
    return sub ? m.docs.visionSubcategory[sub] : undefined;
  };
  const previewOpts = useMemo(
    () => ({
      referenceIso: calendarReferenceIso,
      calendarTimeZone: DEFAULT_CALENDAR_TIMEZONE,
      publicAssetBaseUrl: baseUrl,
    }),
    [calendarReferenceIso, baseUrl],
  );
  const requestPreview = useMemo(
    () => defaultScenarioBenchRequestPreview(id, previewOpts),
    [id, previewOpts],
  );
  const isVision = isVisionScenario(id);
  const images = isVision
    ? getScenarioImageAssets(id, baseUrl, (sub, sid) =>
        sub ? m.docs.imageAlt(m.docs.visionSubcategory[sub], sid) : sid,
      )
    : [];

  return (
    <article
      id={id}
      className="scroll-mt-20 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-mono text-sm font-semibold text-[var(--foreground)]">{id}</h4>
        {isVision ? (
          <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-2)]">
            Vision
          </span>
        ) : null}
      </div>
      {images.length > 0 ? (
        <button
          type="button"
          className="group relative mt-3 block w-full max-w-2xl cursor-zoom-in overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          onClick={() => onImageClick(images[0].url, id, subLabel(id))}
          aria-label={s.enlargeImageAria(id)}
        >
          <img
            src={images[0].url}
            alt={images[0].alt}
            loading="lazy"
            className="block max-h-64 w-full object-contain"
          />
          <span
            aria-hidden
            className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
          >
            <ZoomIn className="size-3" />
            {s.zoom}
          </span>
        </button>
      ) : null}
      {meta ? (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.purpose}</h4>
            <p className="mt-1 leading-relaxed text-[var(--muted)]">{meta.purpose}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.criteria}</h4>
            <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.criteria}</p>
          </div>
          {meta.promptNotes ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.promptNotes}</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.promptNotes}</p>
            </div>
          ) : null}
          {meta.toolsSummary ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.tools}</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.toolsSummary}</p>
            </div>
          ) : null}
          {meta.routes ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.routes}</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.routes}</p>
            </div>
          ) : null}
          {meta.implementation ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.implementation}</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.implementation}</p>
            </div>
          ) : null}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.requestPreview}</h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{s.previewIntro}</p>
            {(requestPreview.defaultMaxTokensFloor != null ||
              requestPreview.imageDelivery != null ||
              requestPreview.imageRefs.length > 0) && (
              <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {requestPreview.defaultMaxTokensFloor != null ? (
                  <>
                    <dt className="font-medium text-[var(--foreground)]">{s.visionMaxTokensFloor}</dt>
                    <dd className="font-mono text-[var(--muted)]">{requestPreview.defaultMaxTokensFloor}</dd>
                  </>
                ) : null}
                {requestPreview.imageDelivery ? (
                  <>
                    <dt className="font-medium text-[var(--foreground)]">image_delivery</dt>
                    <dd className="font-mono text-[var(--muted)]">{requestPreview.imageDelivery}</dd>
                  </>
                ) : null}
                {requestPreview.imageRefs.length > 0 ? (
                  <>
                    <dt className="font-medium text-[var(--foreground)]">image_refs</dt>
                    <dd className="font-mono text-[var(--muted)]">{requestPreview.imageRefs.join(", ")}</dd>
                  </>
                ) : null}
              </dl>
            )}
            {requestPreview.openAiChatCompletions ? (
              <div className="mt-3">
                <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  OpenAI Chat Completions (`messages`{requestPreview.openAiChatCompletions.tools ? ", `tools`, `tool_choice`" : ""})
                </h5>
                <JsonCodeBlock
                  code={formatRequestJson(requestPreview.openAiChatCompletions)}
                  enabled={hlPreview}
                  maxHeight={420}
                  language="json"
                />
              </div>
            ) : null}
            {requestPreview.anthropicMessages ? (
              <div className="mt-3">
                <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Anthropic Messages (`system`, `messages`{requestPreview.anthropicMessages.tools ? ", `tools`" : ""})
                </h5>
                <JsonCodeBlock
                  code={formatRequestJson(requestPreview.anthropicMessages)}
                  enabled={hlPreview}
                  maxHeight={420}
                  language="json"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">{s.noDescription}</p>
      )}
    </article>
  );
}

/**
 * 멀티턴 에이전트 시나리오 카드(경량). `ScenarioArticle`은 닫힌 `ScenarioId` 유니온 + 단일-턴
 * 요청 미리보기에 묶여 있어 agent_* 빌트인에 못 쓴다 — 여기선 레지스트리 메타(목적·기준·도구·라우트)만 표시한다.
 */
function AgentScenarioArticle({ id }: { id: string }) {
  const { locale, m } = useI18n();
  const s = m.docs.scenarios;
  const meta = getScenarioBenchMeta(id, locale);
  return (
    <article id={id} className="scroll-mt-20 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h4 className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-[var(--foreground)]">
        {id}
        <span className="rounded border border-[var(--accent)] px-1 py-px text-[10px] font-normal text-[var(--accent-2)]">
          agent_loop
        </span>
      </h4>
      {meta ? (
        <dl className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--muted)]">
          <div>
            <dt className="font-semibold text-[var(--foreground)]">{s.purpose}</dt>
            <dd>{meta.purpose}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--foreground)]">{s.agentCriteria}</dt>
            <dd>{meta.criteria}</dd>
          </div>
          {meta.toolsSummary ? (
            <div>
              <dt className="font-semibold text-[var(--foreground)]">{s.tools}</dt>
              <dd>{meta.toolsSummary}</dd>
            </div>
          ) : null}
          {meta.routes ? (
            <div>
              <dt className="font-semibold text-[var(--foreground)]">{s.agentRoutes}</dt>
              <dd>{meta.routes}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">{s.noMetadata}</p>
      )}
    </article>
  );
}

export function ScenariosDocPage() {
  const { m } = useI18n();
  const s = m.docs.scenarios;
  const [hlPreview, setHlPreview] = useState(false);
  const [modal, setModal] = useState<{ url: string; scenarioId: string; category?: string } | null>(null);
  const location = useLocation();
  const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
  const calendarReferenceIso = useMemo(() => new Date().toISOString(), []);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const onImageClick = (url: string, scenarioId: string, category?: string) => {
    setModal({ url, scenarioId, category });
  };

  return (
    <div className="space-y-8">
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Layers className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          {s.heading}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          {s.intro}{" "}
          <strong className="text-[var(--foreground)]">{s.introPreviewTerm}</strong>
          {s.introTail}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <HighlightToggle on={hlPreview} onChange={setHlPreview} />
        </div>
      </section>

      <nav
        aria-label={s.tocAria}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{s.toc}</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">{s.textGroup(TEXT_SCENARIO_IDS.length)}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {TEXT_SCENARIO_IDS.map((id) => (
                <li key={id}>
                  <a href={`#${id}`} className="font-mono text-[var(--accent-2)] no-underline hover:underline">
                    {id}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">{s.visionGroup(VISION_SCENARIO_IDS_PUBLIC.length)}</p>
            {VISION_SUBCATEGORIES.map((sub) => {
              const ids = scenariosInVisionSubcategory(sub);
              if (ids.length === 0) return null;
              return (
                <div key={sub} className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {m.docs.visionSubcategory[sub]}
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {ids.map((id) => (
                      <li key={id}>
                        <a href={`#${id}`} className="font-mono text-[var(--accent-2)] no-underline hover:underline">
                          {id}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {AGENT_SCENARIO_IDS.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">{s.agentGroup(AGENT_SCENARIO_IDS.length)}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {AGENT_SCENARIO_IDS.map((id) => (
                  <li key={id}>
                    <a href={`#${id}`} className="font-mono text-[var(--accent-2)] no-underline hover:underline">
                      {id}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </nav>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{s.textSection}</h3>
        <div className="space-y-6">
          {TEXT_SCENARIO_IDS.map((id) => (
            <ScenarioArticle
              key={id}
              id={id}
              hlPreview={hlPreview}
              calendarReferenceIso={calendarReferenceIso}
              baseUrl={baseUrl}
              onImageClick={onImageClick}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{s.visionSection}</h3>
        {VISION_SUBCATEGORIES.map((sub) => {
          const ids = scenariosInVisionSubcategory(sub);
          if (ids.length === 0) return null;
          return (
            <div key={sub} className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {m.docs.visionSubcategory[sub]}
              </h4>
              <div className="space-y-6">
                {ids.map((id) => (
                  <ScenarioArticle
                    key={id}
                    id={id}
                    hlPreview={hlPreview}
                    calendarReferenceIso={calendarReferenceIso}
                    baseUrl={baseUrl}
                    onImageClick={onImageClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {AGENT_SCENARIO_IDS.length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{s.agentSection}</h3>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{s.agentIntro}</p>
          <div className="space-y-6">
            {AGENT_SCENARIO_IDS.map((id) => (
              <AgentScenarioArticle key={id} id={id} />
            ))}
          </div>
        </section>
      ) : null}

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
