import { FamilyAnchor, PresetAnchor } from "../../ProfileDocPage";
import type { ProfileDocContent } from "./types";

// ko — ProfileDocPage의 원본 한국어 산문. en/ja는 이 구조를 그대로 번역한다.
export const ko: ProfileDocContent = {
  docTitle: <>모델 프로파일 문서</>,
  intro: (
    <>
      벤치 화면의 프로파일 선택·모델 행 힌트는 여기 정의를 축약해 보여 줍니다. 수치·매칭 규칙의 단일 출처는{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">@llm-bench/shared</code>의{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">LLM_PROFILE_DEFINITIONS</code>입니다.
    </>
  ),

  autoInferHeading: <>자동 프로파일 추론</>,
  autoInfer: (
    <>
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code>는 정의 배열 순서대로{" "}
      <code className="font-mono text-xs">match</code> 정규식을 적용해 첫 일치 패밀리를 고릅니다. 아무것도 맞지 않으면{" "}
      <code className="font-mono text-xs">unknown</code>이며, 이때는 내장 프리셋 테이블 없이 보수적 기본 샘플링만 씁니다.
    </>
  ),

  thinkingBlockStripHeading: <>사고 블록 인식·제거</>,
  thinkingBlockStrip: (
    <>
      <p className="mb-3 text-sm leading-relaxed text-[var(--muted)]">
        단일 출처: <code className="font-mono text-xs">stripThinkingBlocks</code> /{" "}
        <code className="font-mono text-xs">partitionThinkingBlocks</code> (
        <code className="font-mono text-xs">@llm-bench/shared</code>). 채점·JSON 추출·시나리오 상세 UI·멀티턴 히스토리(
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code>)에 적용됩니다.
      </p>
      <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              <th className="p-2 font-medium text-[var(--foreground)]">인라인 패턴</th>
              <th className="p-2 font-medium text-[var(--muted)]">대표 모델</th>
            </tr>
          </thead>
          <tbody className="text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;redacted_thinking&gt;…&lt;/redacted_thinking&gt;</td>
              <td className="p-2">Qwen 3.5/3.6</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">시작부 …&lt;/redacted_thinking&gt; (여는 태그 없음)</td>
              <td className="p-2">GLM-4.7-Flash, Nemotron 30B</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|think|&gt;…&lt;|end_of_thought|&gt; 등</td>
              <td className="p-2">Qwen think 토큰</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n…&lt;channel|&gt;</td>
              <td className="p-2">Gemma 4 (공식, QAT 포함)</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel|&gt;thought…&lt;channel|&gt;</td>
              <td className="p-2">LM Studio 변형</td>
            </tr>
            <tr>
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n 접두 (닫는 태그 없음)</td>
              <td className="p-2">Gemma 4 사고 OFF — 2차 peel</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        <code className="font-mono text-xs">reasoning_content</code> / Anthropic <code className="font-mono text-xs">thinking_delta</code> /
        MiniMax <code className="font-mono text-xs">reasoning_split</code>는 스트림 단계에서 추론을 분리합니다. 위 regex는{" "}
        <code className="font-mono text-xs">chat_completions</code> 합본·LM Studio 파서 미설정 시 폴백입니다.
      </p>
    </>
  ),

  lmstudioHostHeading: <>LM Studio 호스트 설정</>,
  lmstudioHost: (
    <>
      <p className="mb-3 text-xs text-[var(--muted)]">
        벤치 서버 코드가 아닌, <strong className="text-[var(--foreground)]">LM Studio가 실행되는 머신</strong>에서의 조치입니다.
      </p>
      <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-[var(--muted)]">
        <li>
          <strong className="text-[var(--foreground)]">엔진 프로토콜 회귀 (도구 손상·추론 누수)</strong> — Developer → Runtime Settings의{" "}
          <code className="font-mono text-xs">Use LM Studio Engine Protocol</code>이 켜진 0.4.14~0.4.18 베타 런타임에서 스트리밍{" "}
          <code className="font-mono text-xs">tool_calls</code> 인자가 <code className="font-mono text-xs">{"{}{}"}</code>로 연결·손상되거나(bug-tracker #1922),
          추론이 <code className="font-mono text-xs">reasoning_content</code> 대신 본문 <code className="font-mono text-xs">content</code>로 새어 들어옵니다(0.4.19에서 수정).
          벤치 결과 표·상세에 <span className="text-[var(--warning)]">⚠</span> 배지로 감지됩니다.{" "}
          <strong className="text-[var(--foreground)]">LM Studio를 0.4.19+로 올리거나</strong> 이 옵션을 끄고 재측정하세요.
          Developer의 "When applicable, separate reasoning_content and content in API responses"도 켜 두면 좋습니다.
        </li>
        <li>
          <strong className="text-[var(--foreground)]">사고 파싱 (Gemma 4·QAT)</strong> — 기본 Reasoning Parsing이 Qwen용{" "}
          <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>이라 channel 태그가 본문에 유출되거나 사고 UI가 비어 보일
          수 있습니다. 모델별 Inference → Reasoning Parsing:{" "}
          <code className="font-mono text-xs">startString=&lt;|channel&gt;thought</code>,{" "}
          <code className="font-mono text-xs">endString=&lt;channel|&gt;</code>.
        </li>
        <li>
          <strong className="text-[var(--foreground)]">Jinja 템플릿 크래시</strong> — Anthropic{" "}
          <code className="font-mono text-xs">/v1/messages</code> + <code className="font-mono text-xs">tools</code> 시나리오(
          <code className="font-mono text-xs">tool_weather</code>, <code className="font-mono text-xs">translate_nist_fips197_pdf_tools</code>
          )에서 <code className="font-mono text-xs">Error rendering prompt with jinja template</code> → 빈 응답. 대상:{" "}
          <code className="font-mono text-xs">google/gemma-4-*</code>, <code className="font-mono text-xs">nvidia/nemotron-3-nano*</code>.
          OpenAI <code className="font-mono text-xs">chat_completions</code>는 대개 정상.
        </li>
        <li>
          <strong className="text-[var(--foreground)]">호스트 패치 스크립트</strong> — repo 루트에서 LM Studio 호스트에 실행:{" "}
          <code className="font-mono text-xs">scripts/fix-gemma4-lmstudio-template.sh</code>,{" "}
          <code className="font-mono text-xs">scripts/fix-nemotron-lmstudio-template.sh</code>.{" "}
          <code className="font-mono text-xs">--dry-run</code>으로 diff 확인 후 적용 → 모델 UNLOAD·RELOAD.
        </li>
        <li>
          상세 문서: <code className="font-mono text-xs">docs/lmstudio-engine-protocol.md</code>(엔진 프로토콜 회귀),{" "}
          <code className="font-mono text-xs">docs/lmstudio-jinja-template-crashes.md</code>(Jinja 크래시) — 저장소 루트
        </li>
        <li>
          <code className="font-mono text-xs">stripThinkingBlocks</code>·<code className="font-mono text-xs">enable_thinking</code>는
          응답 후처리·요청 메타입니다. 호스트 파싱/템플릿이 맞지 않으면 도구 시나리오 실패·TTFT 왜곡 등{" "}
          <strong className="text-[var(--foreground)]">측정 전</strong>에 깨질 수 있어 둘 다 필요합니다.
        </li>
      </ul>
    </>
  ),

  runtimeApplyHeading: <>런타임 적용(벤치 요청)</>,
  runtimeApply: [
    <li key="taskmode">
      시나리오마다 <strong className="text-[var(--foreground)]">taskMode</strong>(general / coding / tool)가 정해지고, UI의{" "}
      <strong className="text-[var(--foreground)]">thinkingIntent</strong>(on/off)와 함께{" "}
      <code className="font-mono text-xs">resolveBenchProfile</code>에 들어갑니다.
    </li>,
    <li key="tool-heuristic">
      <strong className="text-[var(--foreground)]">tool</strong> 시나리오는 항상{" "}
      <PresetAnchor name="tool_call" /> 프리셋을 씁니다. 그 외에는 thinking off →{" "}
      <PresetAnchor name="nonthinking_general" />, coding → <PresetAnchor name="thinking_coding" />, 그 외 →{" "}
      <PresetAnchor name="thinking_general" />입니다. <FamilyAnchor id="qwen3_coder_next" />는 예외로 항상{" "}
      <PresetAnchor name="default" /> 프리셋입니다.
    </li>,
    <li key="preset-force">
      UI에서 <strong className="text-[var(--foreground)]">preset 강제</strong>를 켜면(비어 있지 않으면) 위 휴리스틱 대신 해당
      프리셋이 쓰입니다.
    </li>,
    <li key="max-tokens">
      <strong className="text-[var(--foreground)]">max_tokens</strong>는 UI에서 숫자를 넣으면 그 값이 우선하고, 비우면 시나리오
      복잡도에 따라 <code className="font-mono text-xs">recommendedMaxTokens.default</code> 또는{" "}
      <code className="font-mono text-xs">.complex</code>가 적용됩니다.
    </li>,
    <li key="family-detail">
      <strong className="text-[var(--foreground)]">패밀리별 세부 동작</strong> (<code className="font-mono text-xs">enable_thinking</code>,{" "}
      <code className="font-mono text-xs">reasoning_effort</code>, <code className="font-mono text-xs">reasoning_split</code> 등)은 아래 각 모델 카드의 "런타임 노트"를 참고하세요 (
      <a className="text-[var(--accent-2)] underline" href="#gemma4">gemma4</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#qwen36">qwen36</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#nemotron3">nemotron3</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#glm47_flash">glm47_flash</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#gpt_oss">gpt_oss</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#minimax">minimax</a>). LM Studio 호스트는{" "}
      <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">별도 카드</a>.
    </li>,
    <li key="sampling-overrides">
      <strong className="text-[var(--foreground)]">samplingOverrides</strong> JSON은 선택된 프리셋 수치 위에 얕게 덮어씁니다. 서버는{" "}
      <code className="font-mono text-xs">repetition_penalty</code>를 (변환 없이) 그대로 실제 요청에 넣습니다 — OpenAI{" "}
      <code className="font-mono text-xs">frequency_penalty</code>로 옮기지 않습니다. override 가능한 키는{" "}
      <code className="font-mono text-xs">SamplingParams</code>와 동일하며, <code className="font-mono text-xs">frequency_penalty</code>는
      서버 스키마에서 무시(strip)됩니다.
    </li>,
    <li key="profile-scope">
      본 페이지는 프로파일(샘플링·런타임 옵션)에만 한정됩니다. 시나리오별 비전 <code className="font-mono text-xs">max_tokens</code> floor /{" "}
      <code className="font-mono text-xs">truncated_at_max_tokens</code> 라벨 등 벤치 러너 동작은 저장소 README의 "비전 벤치 시나리오" 절을 참고하세요.
    </li>,
  ],
  runtimeExampleSummary: <>예: 일반 모델 + coding + thinking on</>,

  presetSectionHeading: <>프리셋 설명</>,
  presetIntro: [
    <>
      프리셋 이름은 “어떤 의도로 만든 샘플링 묶음인가”를 가리킵니다. 같은 이름이라도{" "}
      <strong className="text-[var(--foreground)]">패밀리에 따라 값이 다를 수 있으니</strong>, 정확한 수치는 각 패밀리
      카드의 “프리셋별 샘플링” 표를 보세요.
    </>,
    <>
      모델 테이블의 <strong className="text-[var(--foreground)]">프로파일</strong> 열은 현재 UI 설정 +{" "}
      <code className="font-mono text-xs">taskMode: "general"</code> 기준 스냅샷입니다. 벤치 중 시나리오가{" "}
      <code className="font-mono text-xs">coding</code>·<code className="font-mono text-xs">tool</code>로 바뀌면(프리셋
      강제가 없는 한) 실제로는 <PresetAnchor name="thinking_coding" />·<PresetAnchor name="tool_call" />이 쓰입니다.
      또한 열의 패밀리 이름은 UI 프로파일 강제(<code className="font-mono text-xs">profileId</code>)가 우선이므로{" "}
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> 결과와 다를 수 있습니다.
    </>,
  ],
  presetCardLabels: {
    when: <>언제 선택되는가</>,
    intent: <>무엇을 위한 프리셋인가</>,
    examples: <>예시 시나리오</>,
    refs: <>참고할 수치(패밀리 카드)</>,
  },
  presetDescriptions: {
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
    },
    tool_call: {
      when: <>taskMode = tool일 때 모든 패밀리에서 강제됩니다.</>,
      intent: <>구조화된 호출(함수/JSON) 안정성을 위해 보수적 샘플링.</>,
      examples: [
        "함수 호출(tool use) 시나리오 전반",
        "스키마가 정해진 구조화 응답 생성",
      ],
    },
  },

  runtimeNotesHeading: <>런타임 노트</>,
  runtimeNotes: {
    qwen35: [
      <li key="enable_thinking">
        thinking <strong className="text-[var(--foreground)]">끄기</strong> 시 요청에{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>가 실립니다.
        LM Studio/vLLM이 <code className="font-mono text-xs">chat_template_kwargs</code>를 전달할 때만 효력이 있습니다.
      </li>,
    ],
    qwen36: [
      <li key="enable_thinking">
        thinking <strong className="text-[var(--foreground)]">끄기</strong> 시 요청에{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>가 실립니다.
        LM Studio/vLLM이 <code className="font-mono text-xs">chat_template_kwargs</code>를 전달할 때만 효력이 있습니다.
      </li>,
      <li key="preserve_thinking">
        UI에서 <code className="font-mono text-xs">preserve_thinking</code>가 켜져 있으면 같은{" "}
        <code className="font-mono text-xs">chat_template_kwargs</code> 객체에 병합됩니다.
      </li>,
    ],
    nemotron3: [
      <li key="enable_thinking">
        thinking <strong className="text-[var(--foreground)]">끄기</strong> 시 요청에{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>가 실립니다.
        LM Studio/vLLM이 <code className="font-mono text-xs">chat_template_kwargs</code>를 전달할 때만 효력이 있습니다.
      </li>,
      <li key="nemotron_inline">
        Nano 등: 인라인 <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>. Super/30B: 스트림{" "}
        <code className="font-mono text-xs">reasoning</code> / <code className="font-mono text-xs">reasoning_content</code> 분리가
        흔하며, 닫는 태그만 본문에 오는 경우도 strip regex로 처리합니다.
      </li>,
    ],
    gemma4: [
      <li key="enable_thinking">
        thinking <strong className="text-[var(--foreground)]">끄기</strong> 시 요청에{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>가 실립니다.
        LM Studio/vLLM이 <code className="font-mono text-xs">chat_template_kwargs</code>를 전달할 때만 효력이 있습니다.
      </li>,
      <li key="gemma_think_token">
        사고 <strong className="text-[var(--foreground)]">켜기</strong> 시 시스템 프롬프트 앞에{" "}
        <code className="font-mono text-xs">&lt;|think|&gt;</code>가 붙습니다. 공식 채널 출력은{" "}
        <code className="font-mono text-xs">&lt;|channel&gt;thought\n</code> … <code className="font-mono text-xs">&lt;channel|&gt;</code>
        (QAT 포함 동일 chat template). 12B/26B/31B는 사고 OFF 시 빈 thought 접두가 나올 수 있습니다 — 벤치는 strip·{" "}
        <code className="font-mono text-xs">enable_thinking: false</code>로 완화합니다.
      </li>,
      <li key="gemma_lmstudio">
        LM Studio Reasoning Parsing·템플릿 크래시는{" "}
        <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">
          LM Studio 호스트 설정
        </a>
        카드를 참고하세요.
      </li>,
    ],
    glm47_flash: [
      <li key="glm47_close_only">
        chat template이 generation prompt에 여는 <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>를 넣어
        스트림에는 <strong className="text-[var(--foreground)]">닫는 태그만</strong> 올 수 있습니다.{" "}
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code>는 false(히스토리 strip 안 함).
      </li>,
    ],
    gpt_oss: [
      <li key="reasoning_effort">
        OpenAI 호환 <code className="font-mono text-xs">reasoning_effort</code>가 메타에 실립니다. UI에서 단계(minimal~high)를 선택하면 그 값이 우선하며, 미지정 시{" "}
        <code className="font-mono text-xs">"medium"</code>이 적용됩니다.
      </li>,
    ],
    minimax: [
      <li key="reasoning_split">
        OpenAI 호환 API의 Interleaved 형식을 위해 요청에 <code className="font-mono text-xs">reasoning_split: true</code>가 포함됩니다.
      </li>,
      <li key="strip_thinking">
        네이티브 형식(<code className="font-mono text-xs">content</code> 안의{" "}
        <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>)은 히스토리에서 <code className="font-mono text-xs">content</code>를 그대로 두는 것이 전제 — 이 프로젝트는 minimax에 대해 assistant 히스토리의 thinking 블록을 제거하지 않습니다.
      </li>,
    ],
    qwen3_coder_next: [
      <li key="default_preset">
        preset heuristic 예외: taskMode·thinkingIntent와 무관하게 항상 <PresetAnchor name="default" />{" "}
        프리셋을 사용합니다.
      </li>,
    ],
  },

  promptRulesHeading: <>promptRules</>,
  samplingTableHeading: <>프리셋별 샘플링</>,
  familyMatchLabel: <>매치</>,
  promptRules: {
    gemmaThinkToken: "Gemma: 사고 켜짐 시 시스템 프롬프트 앞에 <|think|> 삽입",
    stripThinkingFromHistory: "어시스턴트 히스토리에 넣기 전에 사고 블록 제거",
    none: "없음",
  },

  unknownFamilyHeading: <>unknown 패밀리</>,
  unknownFamily: (
    <>
      매칭되는 정의가 없을 때의 동작은 벤치 서버의 메타 빌드 로직과 같습니다. UI에서 명시적으로 unknown을 고른 경우도 동일하게
      내장 테이블 없이 기본값에 가깝게 동작합니다. 프리셋 <strong className="text-[var(--foreground)]">이름</strong>은 동일
      휴리스틱(주로 <PresetAnchor name="thinking_general" /> 등)으로 정해지지만, 정의가 없어 보수적 폴백
      (<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>)이 적용됩니다.
    </>
  ),
};
