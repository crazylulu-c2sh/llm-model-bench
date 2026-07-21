import {
  BUILTIN_AGENT_LOOP_IDS,
  DEFAULT_CALENDAR_TIMEZONE,
  PUBLIC_SCENARIO_IDS,
  getScenarioBenchMeta,
  getScenarioImageAssets,
  isVisionScenario,
  scenarioCategory,
  visionSubcategoryLabel,
  type ScenarioId,
} from "@llm-bench/shared";
import { Layers, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";
import { VisionImageModal } from "./components/VisionImageModal";
import { defaultScenarioBenchRequestPreview } from "./lib/scenario-prompt-preview";

function formatRequestJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const TEXT_SCENARIO_IDS = PUBLIC_SCENARIO_IDS.filter((id) => scenarioCategory(id) === "text");
const VISION_SCENARIO_IDS_PUBLIC = PUBLIC_SCENARIO_IDS.filter((id) => scenarioCategory(id) === "vision");
const AGENT_SCENARIO_IDS: readonly string[] = BUILTIN_AGENT_LOOP_IDS;

const VISION_SUBCATEGORIES = ["OCR", "카운트", "차트", "밈", "와이어프레임"] as const;

function scenariosInVisionSubcategory(sub: (typeof VISION_SUBCATEGORIES)[number]): ScenarioId[] {
  return VISION_SCENARIO_IDS_PUBLIC.filter((id) => visionSubcategoryLabel(id) === sub);
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
  const meta = getScenarioBenchMeta(id);
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
  const images = isVision ? getScenarioImageAssets(id, baseUrl) : [];

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
          onClick={() =>
            onImageClick(images[0].url, id, visionSubcategoryLabel(id))
          }
          aria-label={`${id} 이미지 확대`}
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
            <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.criteriaKo}</p>
          </div>
          {meta.promptNotesKo ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">프롬프트·주입</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.promptNotesKo}</p>
            </div>
          ) : null}
          {meta.toolsSummaryKo ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">도구</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.toolsSummaryKo}</p>
            </div>
          ) : null}
          {meta.routesKo ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">API 라우트</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.routesKo}</p>
            </div>
          ) : null}
          {meta.implementationKo ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">채점·실행</h4>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-[var(--muted)]">{meta.implementationKo}</p>
            </div>
          ) : null}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">프롬프트·요청 미리보기</h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              서버가 조립하는 upstream 본문과 동일한 구조입니다. `model`·최종 `max_tokens`·프로파일 샘플링은 UI/프로파일에서
              추가되며, 여기서는 메시지·도구·멀티모달 파트만 표시합니다.
            </p>
            {(requestPreview.defaultMaxTokensFloor != null ||
              requestPreview.imageDelivery != null ||
              requestPreview.imageRefs.length > 0) && (
              <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {requestPreview.defaultMaxTokensFloor != null ? (
                  <>
                    <dt className="font-medium text-[var(--foreground)]">비전 max_tokens floor</dt>
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
        <p className="mt-2 text-sm text-[var(--muted)]">등록된 설명이 없습니다.</p>
      )}
    </article>
  );
}

/**
 * 멀티턴 에이전트 시나리오 카드(경량). `ScenarioArticle`은 닫힌 `ScenarioId` 유니온 + 단일-턴
 * 요청 미리보기에 묶여 있어 agent_* 빌트인에 못 쓴다 — 여기선 레지스트리 메타(목적·기준·도구·라우트)만 표시한다.
 */
function AgentScenarioArticle({ id }: { id: string }) {
  const meta = getScenarioBenchMeta(id);
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
            <dt className="font-semibold text-[var(--foreground)]">목적</dt>
            <dd>{meta.purposeKo}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--foreground)]">합격 기준</dt>
            <dd>{meta.criteriaKo}</dd>
          </div>
          {meta.toolsSummaryKo ? (
            <div>
              <dt className="font-semibold text-[var(--foreground)]">도구</dt>
              <dd>{meta.toolsSummaryKo}</dd>
            </div>
          ) : null}
          {meta.routesKo ? (
            <div>
              <dt className="font-semibold text-[var(--foreground)]">라우트</dt>
              <dd>{meta.routesKo}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">등록된 메타데이터 없음.</p>
      )}
    </article>
  );
}

export function ScenariosDocPage() {
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
          벤치 시나리오 문서
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          벤치 화면의 시나리오 카드는 목적·합격 기준만 요약합니다. 여기서는 동일 메타데이터를 확장 필드로 풀고, 실제 벤치와 같은 규칙으로 생성되는{" "}
          <strong className="text-[var(--foreground)]">요청 미리보기</strong>(OpenAI/Anthropic 라우트별 JSON — 메시지·도구·멀티모달 포함)를 둡니다. 비전 시나리오는 입력 이미지 썸네일을 클릭하면 확대해 볼 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <HighlightToggle on={hlPreview} onChange={setHlPreview} />
        </div>
      </section>

      <nav
        aria-label="시나리오 목차"
        className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">목차</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">텍스트 ({TEXT_SCENARIO_IDS.length})</p>
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
            <p className="text-xs font-semibold text-[var(--foreground)]">비전 ({VISION_SCENARIO_IDS_PUBLIC.length})</p>
            {VISION_SUBCATEGORIES.map((sub) => {
              const ids = scenariosInVisionSubcategory(sub);
              if (ids.length === 0) return null;
              return (
                <div key={sub} className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{sub}</p>
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
              <p className="text-xs font-semibold text-[var(--foreground)]">에이전트 ({AGENT_SCENARIO_IDS.length})</p>
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
        <h3 className="text-sm font-semibold text-[var(--foreground)]">텍스트 시나리오</h3>
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
        <h3 className="text-sm font-semibold text-[var(--foreground)]">비전 시나리오</h3>
        {VISION_SUBCATEGORIES.map((sub) => {
          const ids = scenariosInVisionSubcategory(sub);
          if (ids.length === 0) return null;
          return (
            <div key={sub} className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{sub}</h4>
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
          <h3 className="text-sm font-semibold text-[var(--foreground)]">에이전트 시나리오</h3>
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            멀티턴 도구 사용 루프. 단일-샷과 달리 여러 턴에 걸쳐 도구를 호출하고 최종 답을 낸다 — 빈-턴 정체·사고
            예산 소진·도구 인자 충실도처럼 턴을 가로질러야 드러나는 결함을 측정한다. 모든 도구 응답은 mock이다.
          </p>
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
