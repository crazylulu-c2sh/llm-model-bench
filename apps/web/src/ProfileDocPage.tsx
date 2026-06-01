import {
  LLM_PROFILE_DEFINITIONS,
  resolveBenchProfile,
  type LlmProfileDefinition,
  type LlmProfileFamily,
  type SamplingParams,
  type SamplingPresetName,
} from "@llm-bench/shared";
import { BookOpen } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

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

function formatRegexList(def: LlmProfileDefinition): string {
  return def.match.map((re) => re.source).join(" · ");
}

function runtimeNotesForFamily(id: LlmProfileFamily): ReactNode[] {
  const notes: ReactNode[] = [];
  if (id === "qwen35" || id === "qwen36" || id === "nemotron3") {
    notes.push(
      <li key="enable_thinking">
        thinking <strong className="text-[var(--foreground)]">끄기</strong> 시 요청에{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>가 실립니다.
      </li>,
    );
  }
  if (id === "qwen36") {
    notes.push(
      <li key="preserve_thinking">
        UI에서 <code className="font-mono text-xs">preserve_thinking</code>가 켜져 있으면 같은{" "}
        <code className="font-mono text-xs">chat_template_kwargs</code> 객체에 병합됩니다.
      </li>,
    );
  }
  if (id === "gpt_oss") {
    notes.push(
      <li key="reasoning_effort">
        OpenAI 호환 <code className="font-mono text-xs">reasoning_effort</code>가 메타에 실립니다. UI에서 단계(minimal~high)를 선택하면 그 값이 우선하며, 미지정 시{" "}
        <code className="font-mono text-xs">"medium"</code>이 적용됩니다.
      </li>,
    );
  }
  if (id === "minimax") {
    notes.push(
      <li key="reasoning_split">
        OpenAI 호환 API의 Interleaved 형식을 위해 요청에 <code className="font-mono text-xs">reasoning_split: true</code>가 포함됩니다.
      </li>,
      <li key="strip_thinking">
        네이티브 형식(<code className="font-mono text-xs">content</code> 안의{" "}
        <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>)은 히스토리에서 <code className="font-mono text-xs">content</code>를 그대로 두는 것이 전제 — 이 프로젝트는 minimax에 대해 assistant 히스토리의 thinking 블록을 제거하지 않습니다.
      </li>,
    );
  }
  if (id === "qwen3_coder_next") {
    notes.push(
      <li key="default_preset">
        preset heuristic 예외: taskMode·thinkingIntent와 무관하게 항상 <PresetAnchor name="default" />{" "}
        프리셋을 사용합니다.
      </li>,
    );
  }
  return notes;
}

function RuntimeNotes({ family }: { family: LlmProfileFamily }) {
  const notes = runtimeNotesForFamily(family);
  if (notes.length === 0) return null;
  return (
    <>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">런타임 노트</h4>
      <ul className="mb-4 list-inside list-disc space-y-1 text-sm leading-relaxed text-[var(--muted)]">
        {notes}
      </ul>
    </>
  );
}

function PresetAnchor({ name }: { name: SamplingPresetName }) {
  return (
    <a href={`#preset-${name}`} className="font-mono text-xs text-[var(--accent)] hover:underline">
      {name}
    </a>
  );
}

function FamilyAnchor({ id }: { id: LlmProfileFamily }) {
  return (
    <a href={`#${id}`} className="font-mono text-xs text-[var(--accent)] hover:underline">
      {id}
    </a>
  );
}

type PresetDescription = {
  when: ReactNode;
  intent: ReactNode;
  examples: string[];
  refs: LlmProfileFamily[];
};

const PRESET_DESCRIPTIONS: Record<SamplingPresetName, PresetDescription> = {
  default: {
    when: (
      <>
        <code className="font-mono text-xs">qwen3_coder_next</code> 패밀리에서만 taskMode·thinking과
        무관하게 강제됩니다. 다른 패밀리에서는 휴리스틱이 이 이름을 고르지 않으며, UI 프리셋 강제에서{" "}
        <code className="font-mono text-xs">default</code>를 골라도 무시되고 휴리스틱이 다시 적용됩니다.
      </>
    ),
    intent: (
      <>
        패밀리별 “권장 시작값”. 보통 <PresetAnchor name="thinking_general" />과 같거나 그에 준하는
        다양성을 가집니다. unknown 패밀리는 이 이름 대신 보수적 폴백(<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>)으로 떨어집니다.
      </>
    ),
    examples: [
      "qwen3_coder_next 기반 코더 모델 일반 사용",
      "특정 휴리스틱을 잠시 우회하고 패밀리 기본값으로 비교하고 싶을 때",
    ],
    refs: ["qwen3_coder_next", "qwen36"],
  },
  thinking_general: {
    when: <>thinking on + 일반 시나리오(coding/tool이 아닌 경우)에 자동 선택됩니다.</>,
    intent: (
      <>
        추론·탐색용. 다양성을 위해 top_p·temperature를 약간 높게 두는 패밀리가 많습니다(qwen36: 1.0 / 0.95).
      </>
    ),
    examples: [
      "분석·요약·Q&A·멀티스텝 추론",
      "비전 시나리오의 이미지 설명",
      "긴 문서/롱 컨텍스트 요약",
    ],
    refs: ["qwen36", "nemotron3"],
  },
  thinking_coding: {
    when: <>thinking on + coding 시나리오에 자동 선택됩니다.</>,
    intent: (
      <>
        결정성↑. presence/temperature를 낮춰 일관된 코드 생성을 우선합니다(qwen36 기준 temperature 0.6,
        presence 0.0).
      </>
    ),
    examples: [
      "함수/모듈 작성, 기존 코드 수정·리팩토링",
      "스택 트레이스·테스트 실패 디버깅 풀이",
      "리뷰 코멘트 반영용 패치 작성",
    ],
    refs: ["qwen36", "qwen35"],
  },
  nonthinking_general: {
    when: <>thinking off(사고 차단) + tool이 아닌 시나리오일 때 자동 선택됩니다.</>,
    intent: (
      <>
        짧고 직접적인 응답. 일부 패밀리는 매우 보수적입니다 — <FamilyAnchor id="nemotron3" />는{" "}
        <code className="font-mono text-xs">temperature 0.2 + top_k 1</code>까지 떨어뜨립니다.
      </>
    ),
    examples: [
      "짧은 분류·라벨링",
      "형식 변환(예: 단답 → JSON 한 줄)",
      "latency 민감한 단답 Q&A",
    ],
    refs: ["nemotron3", "qwen36"],
  },
  tool_call: {
    when: <>taskMode = tool일 때 모든 패밀리에서 강제됩니다.</>,
    intent: <>구조화된 호출(함수/JSON) 안정성을 위해 보수적 샘플링.</>,
    examples: [
      "함수 호출(tool use) 시나리오 전반",
      "스키마가 정해진 구조화 응답 생성",
    ],
    refs: ["qwen36", "nemotron3"],
  },
};

function PresetCard({ name }: { name: SamplingPresetName }) {
  const desc = PRESET_DESCRIPTIONS[name];
  return (
    <section
      id={`preset-${name}`}
      className="scroll-mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
    >
      <h4 className="mb-2 font-mono text-sm font-semibold text-[var(--foreground)]">{name}</h4>
      <dl className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">언제 선택되는가</dt>
          <dd className="mt-1">{desc.when}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">무엇을 위한 프리셋인가</dt>
          <dd className="mt-1">{desc.intent}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">예시 시나리오</dt>
          <dd className="mt-1">
            <ul className="list-inside list-disc space-y-0.5">
              {desc.examples.map((ex) => (
                <li key={ex}>{ex}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">참고할 수치(패밀리 카드)</dt>
          <dd className="mt-1 flex flex-wrap gap-x-2">
            {desc.refs.map((id, idx) => (
              <span key={id}>
                <FamilyAnchor id={id} />
                {idx < desc.refs.length - 1 ? <span className="text-[var(--muted)]"> · </span> : null}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function PromptRulesSummary({ rules }: { rules: LlmProfileDefinition["promptRules"] }) {
  const bits: string[] = [];
  if (rules.gemmaThinkToken) bits.push("Gemma: 사고 켜짐 시 시스템 프롬프트 앞에 <|think|> 삽입");
  if (rules.stripThinkingFromAssistantHistory)
    bits.push("어시스턴트 히스토리에 넣기 전에 사고 블록 제거");
  if (bits.length === 0) return <span className="text-[var(--muted)]">없음</span>;
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
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          모델 프로파일 문서
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          벤치 화면의 프로파일 선택·모델 행 힌트는 여기 정의를 축약해 보여 줍니다. 수치·매칭 규칙의 단일 출처는{" "}
          <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">@llm-bench/shared</code>의{" "}
          <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">LLM_PROFILE_DEFINITIONS</code>입니다.
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">자동 프로파일 추론</h3>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code>는 정의 배열 순서대로{" "}
          <code className="font-mono text-xs">match</code> 정규식을 적용해 첫 일치 패밀리를 고릅니다. 아무것도 맞지 않으면{" "}
          <code className="font-mono text-xs">unknown</code>이며, 이때는 내장 프리셋 테이블 없이 보수적 기본 샘플링만 씁니다.
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">런타임 적용(벤치 요청)</h3>
        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-[var(--muted)]">
          <li>
            시나리오마다 <strong className="text-[var(--foreground)]">taskMode</strong>(general / coding / tool)가 정해지고, UI의{" "}
            <strong className="text-[var(--foreground)]">thinkingIntent</strong>(on/off)와 함께{" "}
            <code className="font-mono text-xs">resolveBenchProfile</code>에 들어갑니다.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">tool</strong> 시나리오는 항상{" "}
            <PresetAnchor name="tool_call" /> 프리셋을 씁니다. 그 외에는 thinking off →{" "}
            <PresetAnchor name="nonthinking_general" />, coding → <PresetAnchor name="thinking_coding" />, 그 외 →{" "}
            <PresetAnchor name="thinking_general" />입니다. <FamilyAnchor id="qwen3_coder_next" />는 예외로 항상{" "}
            <PresetAnchor name="default" /> 프리셋입니다.
          </li>
          <li>
            UI에서 <strong className="text-[var(--foreground)]">preset 강제</strong>를 켜면(비어 있지 않으면) 위 휴리스틱 대신 해당
            프리셋이 쓰입니다.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">max_tokens</strong>는 UI에서 숫자를 넣으면 그 값이 우선하고, 비우면 시나리오
            복잡도에 따라 <code className="font-mono text-xs">recommendedMaxTokens.default</code> 또는{" "}
            <code className="font-mono text-xs">.complex</code>가 적용됩니다.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">패밀리별 세부 동작</strong> (<code className="font-mono text-xs">enable_thinking</code>,{" "}
            <code className="font-mono text-xs">reasoning_effort</code>, <code className="font-mono text-xs">reasoning_split</code> 등)은 아래 각 모델 카드의 "런타임 노트"를 참고하세요 (
            <a className="text-[var(--accent)] hover:underline" href="#qwen36">qwen36</a>,{" "}
            <a className="text-[var(--accent)] hover:underline" href="#nemotron3">nemotron3</a>,{" "}
            <a className="text-[var(--accent)] hover:underline" href="#gpt_oss">gpt_oss</a>,{" "}
            <a className="text-[var(--accent)] hover:underline" href="#minimax">minimax</a>).
          </li>
          <li>
            <strong className="text-[var(--foreground)]">samplingOverrides</strong> JSON은 선택된 프리셋 수치 위에 얕게 덮어씁니다. 서버는{" "}
            <code className="font-mono text-xs">repetition_penalty</code>를 (변환 없이) 그대로 실제 요청에 넣습니다 — OpenAI{" "}
            <code className="font-mono text-xs">frequency_penalty</code>로 옮기지 않습니다. override 가능한 키는{" "}
            <code className="font-mono text-xs">SamplingParams</code>와 동일하며, <code className="font-mono text-xs">frequency_penalty</code>는
            서버 스키마에서 무시(strip)됩니다.
          </li>
          <li>
            본 페이지는 프로파일(샘플링·런타임 옵션)에만 한정됩니다. 시나리오별 비전 <code className="font-mono text-xs">max_tokens</code> floor /{" "}
            <code className="font-mono text-xs">truncated_at_max_tokens</code> 라벨 등 벤치 러너 동작은 저장소 README의 "비전 벤치 시나리오" 절을 참고하세요.
          </li>
        </ul>
        <details className="mt-3 border-t border-[var(--border)] pt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">예: 일반 모델 + coding + thinking on</summary>
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
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">프리셋 설명</h3>
        <p className="mb-2 text-sm leading-relaxed text-[var(--muted)]">
          프리셋 이름은 “어떤 의도로 만든 샘플링 묶음인가”를 가리킵니다. 같은 이름이라도{" "}
          <strong className="text-[var(--foreground)]">패밀리에 따라 값이 다를 수 있으니</strong>, 정확한 수치는 각 패밀리
          카드의 “프리셋별 샘플링” 표를 보세요.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
          모델 테이블의 <strong className="text-[var(--foreground)]">프로파일</strong> 열은 현재 UI 설정 +{" "}
          <code className="font-mono text-xs">taskMode: "general"</code> 기준 스냅샷입니다. 벤치 중 시나리오가{" "}
          <code className="font-mono text-xs">coding</code>·<code className="font-mono text-xs">tool</code>로 바뀌면(프리셋
          강제가 없는 한) 실제로는 <PresetAnchor name="thinking_coding" />·<PresetAnchor name="tool_call" />이 쓰입니다.
          또한 열의 패밀리 이름은 UI 프로파일 강제(<code className="font-mono text-xs">profileId</code>)가 우선이므로{" "}
          <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> 결과와 다를 수 있습니다.
        </p>
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
            version {def.version} · 매치: <code className="break-all font-mono text-[11px]">{formatRegexList(def)}</code>
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
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">promptRules</h4>
          <div className="mb-4 text-sm">
            <PromptRulesSummary rules={def.promptRules} />
          </div>
          <RuntimeNotes family={def.id} />
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">프리셋별 샘플링</h4>
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
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">unknown 패밀리</h3>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          매칭되는 정의가 없을 때의 동작은 벤치 서버의 메타 빌드 로직과 같습니다. UI에서 명시적으로 unknown을 고른 경우도 동일하게
          내장 테이블 없이 기본값에 가깝게 동작합니다. 프리셋 <strong className="text-[var(--foreground)]">이름</strong>은 동일
          휴리스틱(주로 <PresetAnchor name="thinking_general" /> 등)으로 정해지지만, 정의가 없어 보수적 폴백
          (<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>)이 적용됩니다.
        </p>
      </section>
    </div>
  );
}
