import {
  LLM_PROFILE_DEFINITIONS,
  resolveBenchProfile,
  type LlmProfileDefinition,
  type LlmProfileFamily,
  type SamplingParams,
  type SamplingPresetName,
} from "@llm-bench/shared";
import { BookOpen } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PROFILE_DOC_CONTENT } from "./content/profile-doc";
import { useI18n } from "./i18n";

const PRESET_ORDER: SamplingPresetName[] = [
  "default",
  "thinking_general",
  "thinking_coding",
  "nonthinking_general",
  "tool_call",
];

const SAMPLING_KEYS: (keyof SamplingParams)[] = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "presence_penalty",
  "repetition_penalty",
];

// 프리셋별 참고 패밀리(언어 중립 데이터) — 로케일별로 다르지 않아 콘텐츠 모듈이 아닌 페이지에 둔다.
const PRESET_REFS: Record<SamplingPresetName, LlmProfileFamily[]> = {
  default: ["qwen3_coder_next", "qwen36"],
  thinking_general: ["qwen36", "nemotron3"],
  thinking_coding: ["qwen36", "qwen35"],
  nonthinking_general: ["nemotron3", "qwen36"],
  tool_call: ["qwen36", "nemotron3"],
};

/** 현재 로케일의 ProfileDoc 콘텐츠(산문·헤딩). 레이아웃·데이터 반복은 이 파일에 남는다. */
function useProfileDocContent() {
  return PROFILE_DOC_CONTENT[useI18n().locale];
}

function formatRegexList(def: LlmProfileDefinition): string {
  return def.match.map((re) => re.source).join(" · ");
}

function RuntimeNotes({ family }: { family: LlmProfileFamily }) {
  const c = useProfileDocContent();
  const notes = c.runtimeNotes[family] ?? [];
  if (notes.length === 0) return null;
  return (
    <>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.runtimeNotesHeading}</h4>
      <ul className="mb-4 list-inside list-disc space-y-1 text-sm leading-relaxed text-[var(--muted)]">
        {notes}
      </ul>
    </>
  );
}

// 콘텐츠 모듈(ko/en/ja)이 산문 안에서 이 앵커들을 쓰므로 export 한다.
// export function(선언 호이스팅) → content ↔ ProfileDocPage 순환 import에서도 안전.
export function PresetAnchor({ name }: { name: SamplingPresetName }) {
  return (
    <a href={`#preset-${name}`} className="font-mono text-xs text-[var(--accent-2)] underline">
      {name}
    </a>
  );
}

export function FamilyAnchor({ id }: { id: LlmProfileFamily }) {
  return (
    <a href={`#${id}`} className="font-mono text-xs text-[var(--accent-2)] underline">
      {id}
    </a>
  );
}

function PresetCard({ name }: { name: SamplingPresetName }) {
  const c = useProfileDocContent();
  const desc = c.presetDescriptions[name];
  const refs = PRESET_REFS[name];
  return (
    <section
      id={`preset-${name}`}
      className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
    >
      <h4 className="mb-2 font-mono text-sm font-semibold text-[var(--foreground)]">{name}</h4>
      <dl className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.presetCardLabels.when}</dt>
          <dd className="mt-1">{desc.when}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.presetCardLabels.intent}</dt>
          <dd className="mt-1">{desc.intent}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.presetCardLabels.examples}</dt>
          <dd className="mt-1">
            <ul className="list-inside list-disc space-y-0.5">
              {desc.examples.map((ex) => (
                <li key={ex}>{ex}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.presetCardLabels.refs}</dt>
          <dd className="mt-1 flex flex-wrap gap-x-2">
            {refs.map((id, idx) => (
              <span key={id}>
                <FamilyAnchor id={id} />
                {idx < refs.length - 1 ? <span className="text-[var(--muted)]"> · </span> : null}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ThinkingBlockStripSection() {
  const c = useProfileDocContent();
  return (
    <section
      id="thinking-block-strip"
      className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
    >
      <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{c.thinkingBlockStripHeading}</h3>
      {c.thinkingBlockStrip}
    </section>
  );
}

function LmStudioHostCard() {
  const c = useProfileDocContent();
  return (
    <section
      id="lmstudio-host"
      className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
    >
      <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">{c.lmstudioHostHeading}</h3>
      {c.lmstudioHost}
    </section>
  );
}

function PromptRulesSummary({ rules }: { rules: LlmProfileDefinition["promptRules"] }) {
  const c = useProfileDocContent();
  const bits: string[] = [];
  if (rules.gemmaThinkToken) bits.push(c.promptRules.gemmaThinkToken);
  if (rules.stripThinkingFromAssistantHistory) bits.push(c.promptRules.stripThinkingFromHistory);
  if (bits.length === 0) return <span className="text-[var(--muted)]">{c.promptRules.none}</span>;
  return (
    <ul className="list-inside list-disc space-y-1 text-[var(--muted)]">
      {bits.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}

export function ProfileDocPage() {
  const location = useLocation();
  const c = PROFILE_DOC_CONTENT[useI18n().locale];
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let r2 = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [location.key, location.hash]);
  return (
    <div className="space-y-8">
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <BookOpen className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          {c.docTitle}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{c.intro}</p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{c.autoInferHeading}</h3>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{c.autoInfer}</p>
      </section>

      <ThinkingBlockStripSection />
      <LmStudioHostCard />

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{c.runtimeApplyHeading}</h3>
        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-[var(--muted)]">
          {c.runtimeApply}
        </ul>
        <details className="mt-3 border-t border-[var(--border)] pt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">{c.runtimeExampleSummary}</summary>
          <pre className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-snug text-[var(--foreground)]">
            {JSON.stringify(
              resolveBenchProfile({
                modelId: "Qwen/Qwen3-8B",
                taskMode: "coding",
                thinkingIntent: "on",
              }),
              null,
              2,
            )}
          </pre>
        </details>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{c.presetSectionHeading}</h3>
        <p className="mb-2 text-sm leading-relaxed text-[var(--muted)]">{c.presetIntro[0]}</p>
        <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">{c.presetIntro[1]}</p>
        <div className="space-y-3">
          {PRESET_ORDER.map((name) => (
            <PresetCard key={name} name={name} />
          ))}
        </div>
      </section>

      {LLM_PROFILE_DEFINITIONS.map((def) => (
        <section
          key={def.id}
          id={def.id}
          className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
        >
          <h3 className="mb-1 font-mono text-base font-semibold text-[var(--foreground)]">{def.id}</h3>
          <p className="mb-3 text-xs text-[var(--muted)]">
            version {def.version} · {c.familyMatchLabel}:{" "}
            <code className="break-all font-mono text-[11px]">{formatRegexList(def)}</code>
          </p>
          <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="text-xs font-medium text-[var(--muted)]">contextNativeMax</span>
              <p className="font-mono text-[var(--foreground)]">{def.contextNativeMax ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-[var(--muted)]">contextRecommendedStart</span>
              <p className="font-mono text-[var(--foreground)]">{def.contextRecommendedStart ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-[var(--muted)]">recommendedMaxTokens.default</span>
              <p className="font-mono text-[var(--foreground)]">{def.recommendedMaxTokens.default}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-[var(--muted)]">recommendedMaxTokens.complex</span>
              <p className="font-mono text-[var(--foreground)]">{def.recommendedMaxTokens.complex}</p>
            </div>
          </div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.promptRulesHeading}</h4>
          <div className="mb-4 text-sm">
            <PromptRulesSummary rules={def.promptRules} />
          </div>
          <RuntimeNotes family={def.id} />
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{c.samplingTableHeading}</h4>
          <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[36rem] border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="p-2 font-mono font-medium text-[var(--foreground)]">preset</th>
                  {SAMPLING_KEYS.map((k) => (
                    <th key={k} className="p-2 font-mono font-medium text-[var(--muted)]">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRESET_ORDER.map((preset) => {
                  const row = def.presets[preset];
                  return (
                    <tr key={preset} className="border-b border-[var(--border)] last:border-0">
                      <td className="p-2 font-mono text-[var(--foreground)]">
                        <PresetAnchor name={preset} />
                      </td>
                      {SAMPLING_KEYS.map((k) => (
                        <td key={k} className="p-2 font-mono text-[var(--muted)]">
                          {row[k] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section
        id="unknown"
        className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
      >
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{c.unknownFamilyHeading}</h3>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{c.unknownFamily}</p>
      </section>
    </div>
  );
}
