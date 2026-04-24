import {
  LLM_PROFILE_DEFINITIONS,
  resolveBenchProfile,
  type LlmProfileDefinition,
  type SamplingParams,
  type SamplingPresetName,
} from "@llm-bench/shared";
import { BookOpen } from "lucide-react";

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
            <strong className="text-[var(--foreground)]">tool</strong> 시나리오는 항상 <code className="font-mono text-xs">tool_call</code>{" "}
            프리셋을 씁니다. 그 외에는 thinking off → <code className="font-mono text-xs">nonthinking_general</code>, coding →{" "}
            <code className="font-mono text-xs">thinking_coding</code>, 그 외 → <code className="font-mono text-xs">thinking_general</code>
            입니다. <code className="font-mono text-xs">qwen3_coder_next</code>는 예외로 항상 <code className="font-mono text-xs">default</code>{" "}
            프리셋입니다.
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
            Qwen 3.5/3.6에서 thinking <strong className="text-[var(--foreground)]">끄기</strong>는 요청{" "}
            <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>로 전달됩니다. Qwen 3.6만{" "}
            <code className="font-mono text-xs">preserve_thinking</code> 옵션이 있으면 같은 객체에 병합됩니다.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">gpt-oss</strong> 패밀리는 OpenAI 호환 <code className="font-mono text-xs">reasoning_effort</code>가
            메타에 실리며, UI에서 단계(minimal~high)를 고릅니다.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">samplingOverrides</strong> JSON은 선택된 프리셋 수치 위에 얕게 덮어씁니다. 서버는{" "}
            <code className="font-mono text-xs">repetition_penalty</code>를 OpenAI 쪽 <code className="font-mono text-xs">frequency_penalty</code>로
            옮겨 실제 요청에 넣습니다.
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

      {LLM_PROFILE_DEFINITIONS.map((def) => (
        <section
          key={def.id}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm"
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
                      <td className="p-2 font-mono text-[var(--foreground)]">{preset}</td>
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

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">unknown 패밀리</h3>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          매칭되는 정의가 없을 때의 동작은 벤치 서버의 메타 빌드 로직과 같습니다. UI에서 명시적으로 unknown을 고른 경우도 동일하게
          내장 테이블 없이 기본값에 가깝게 동작합니다.
        </p>
      </section>
    </div>
  );
}
