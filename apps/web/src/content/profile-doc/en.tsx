import { FamilyAnchor, PresetAnchor } from "../../ProfileDocPage";
import type { ProfileDocContent } from "./types";

// en — ko와 키가 정확히 일치해야 함(ProfileDocContent 타입이 강제). 사람 텍스트만 번역, 마크업·식별자·앵커·숫자는 동일.
export const en: ProfileDocContent = {
  docTitle: <>Model profile documentation</>,
  intro: (
    <>
      The bench screen's profile selector and model-row hints show a condensed view of the definitions here. The single
      source of truth for the values and matching rules is{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">LLM_PROFILE_DEFINITIONS</code> in{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">@llm-bench/shared</code>.
    </>
  ),

  autoInferHeading: <>Automatic profile inference</>,
  autoInfer: (
    <>
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> applies the{" "}
      <code className="font-mono text-xs">match</code> regexes in definition-array order and picks the first matching
      family. If nothing matches, it is <code className="font-mono text-xs">unknown</code>, in which case only
      conservative default sampling is used, without the built-in preset table.
    </>
  ),

  thinkingBlockStripHeading: <>Thinking block detection &amp; stripping</>,
  thinkingBlockStrip: (
    <>
      <p className="mb-3 text-sm leading-relaxed text-[var(--muted)]">
        Single source: <code className="font-mono text-xs">stripThinkingBlocks</code> /{" "}
        <code className="font-mono text-xs">partitionThinkingBlocks</code> (
        <code className="font-mono text-xs">@llm-bench/shared</code>). Applied to scoring, JSON extraction, the scenario
        detail UI, and multi-turn history (
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code>).
      </p>
      <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              <th className="p-2 font-medium text-[var(--foreground)]">Inline pattern</th>
              <th className="p-2 font-medium text-[var(--muted)]">Representative models</th>
            </tr>
          </thead>
          <tbody className="text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;redacted_thinking&gt;…&lt;/redacted_thinking&gt;</td>
              <td className="p-2">Qwen 3.5/3.6</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">leading …&lt;/redacted_thinking&gt; (no opening tag)</td>
              <td className="p-2">GLM-4.7-Flash, Nemotron 30B</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|think|&gt;…&lt;|end_of_thought|&gt; etc.</td>
              <td className="p-2">Qwen think tokens</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n…&lt;channel|&gt;</td>
              <td className="p-2">Gemma 4 (official, incl. QAT)</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel|&gt;thought…&lt;channel|&gt;</td>
              <td className="p-2">LM Studio variant</td>
            </tr>
            <tr>
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n prefix (no closing tag)</td>
              <td className="p-2">Gemma 4 thinking OFF — 2nd peel</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        <code className="font-mono text-xs">reasoning_content</code> / Anthropic <code className="font-mono text-xs">thinking_delta</code> /
        MiniMax <code className="font-mono text-xs">reasoning_split</code> separate reasoning at the stream stage. The
        regexes above are fallbacks for <code className="font-mono text-xs">chat_completions</code> merged output and when
        the LM Studio parser is unset.
      </p>
    </>
  ),

  lmstudioHostHeading: <>LM Studio host setup</>,
  lmstudioHost: (
    <>
      <p className="mb-3 text-xs text-[var(--muted)]">
        These are actions on the <strong className="text-[var(--foreground)]">machine where LM Studio runs</strong> — not
        in the bench server code.
      </p>
      <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-[var(--muted)]">
        <li>
          <strong className="text-[var(--foreground)]">Engine protocol regression (tool corruption · reasoning leak)</strong> — In beta runtimes 0.4.14–0.4.18 with Developer → Runtime Settings'{" "}
          <code className="font-mono text-xs">Use LM Studio Engine Protocol</code> enabled, streaming{" "}
          <code className="font-mono text-xs">tool_calls</code> arguments get concatenated and corrupted into <code className="font-mono text-xs">{"{}{}"}</code> (bug-tracker #1922),
          or reasoning leaks into the body <code className="font-mono text-xs">content</code> instead of <code className="font-mono text-xs">reasoning_content</code> (fixed in 0.4.19).
          It is detected with a <span className="text-[var(--warning)]">⚠</span> badge in the bench result table and details.{" "}
          <strong className="text-[var(--foreground)]">Upgrade LM Studio to 0.4.19+</strong> or turn this option off and re-measure.
          It also helps to enable Developer's "When applicable, separate reasoning_content and content in API responses".
        </li>
        <li>
          <strong className="text-[var(--foreground)]">Thinking parsing (Gemma 4 · QAT)</strong> — The default Reasoning Parsing targets Qwen's{" "}
          <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>, so channel tags may leak into the body or the thinking UI may appear
          empty. Per model, set Inference → Reasoning Parsing:{" "}
          <code className="font-mono text-xs">startString=&lt;|channel&gt;thought</code>,{" "}
          <code className="font-mono text-xs">endString=&lt;channel|&gt;</code>.
        </li>
        <li>
          <strong className="text-[var(--foreground)]">Jinja template crash</strong> — In Anthropic{" "}
          <code className="font-mono text-xs">/v1/messages</code> + <code className="font-mono text-xs">tools</code> scenarios (
          <code className="font-mono text-xs">tool_weather</code>, <code className="font-mono text-xs">translate_nist_fips197_pdf_tools</code>
          ), <code className="font-mono text-xs">Error rendering prompt with jinja template</code> → empty response. Affected:{" "}
          <code className="font-mono text-xs">google/gemma-4-*</code>, <code className="font-mono text-xs">nvidia/nemotron-3-nano*</code>.
          OpenAI <code className="font-mono text-xs">chat_completions</code> is usually fine.
        </li>
        <li>
          <strong className="text-[var(--foreground)]">Host patch scripts</strong> — Run on the LM Studio host from the repo root:{" "}
          <code className="font-mono text-xs">scripts/fix-gemma4-lmstudio-template.sh</code>,{" "}
          <code className="font-mono text-xs">scripts/fix-nemotron-lmstudio-template.sh</code>.{" "}
          Check the diff with <code className="font-mono text-xs">--dry-run</code>, then apply → UNLOAD·RELOAD the model.
        </li>
        <li>
          Detailed docs: <code className="font-mono text-xs">docs/lmstudio-engine-protocol.md</code> (engine protocol regression),{" "}
          <code className="font-mono text-xs">docs/lmstudio-jinja-template-crashes.md</code> (Jinja crash) — repo root
        </li>
        <li>
          <code className="font-mono text-xs">stripThinkingBlocks</code>·<code className="font-mono text-xs">enable_thinking</code> are
          response post-processing and request meta. If host parsing/templates are wrong, things can break{" "}
          <strong className="text-[var(--foreground)]">before measurement</strong> — tool-scenario failures, TTFT distortion, etc. — so both are needed.
        </li>
      </ul>
    </>
  ),

  runtimeApplyHeading: <>Runtime application (bench requests)</>,
  runtimeApply: [
    <li key="taskmode">
      Each scenario has a <strong className="text-[var(--foreground)]">taskMode</strong> (general / coding / tool), which — together with the UI's{" "}
      <strong className="text-[var(--foreground)]">thinkingIntent</strong> (on/off) — goes into{" "}
      <code className="font-mono text-xs">resolveBenchProfile</code>.
    </li>,
    <li key="tool-heuristic">
      <strong className="text-[var(--foreground)]">tool</strong> scenarios always use the{" "}
      <PresetAnchor name="tool_call" /> preset. Otherwise: thinking off →{" "}
      <PresetAnchor name="nonthinking_general" />, coding → <PresetAnchor name="thinking_coding" />, everything else →{" "}
      <PresetAnchor name="thinking_general" />. <FamilyAnchor id="qwen3_coder_next" /> is an exception and always uses the{" "}
      <PresetAnchor name="default" /> preset.
    </li>,
    <li key="preset-force">
      If you enable <strong className="text-[var(--foreground)]">preset override</strong> in the UI (non-empty), that
      preset is used instead of the heuristic above.
    </li>,
    <li key="max-tokens">
      <strong className="text-[var(--foreground)]">max_tokens</strong>: if you enter a number in the UI, that value wins; if left empty,{" "}
      <code className="font-mono text-xs">recommendedMaxTokens.default</code> or{" "}
      <code className="font-mono text-xs">.complex</code> applies depending on scenario complexity.
    </li>,
    <li key="family-detail">
      <strong className="text-[var(--foreground)]">Family-specific behavior</strong> (<code className="font-mono text-xs">enable_thinking</code>,{" "}
      <code className="font-mono text-xs">reasoning_effort</code>, <code className="font-mono text-xs">reasoning_split</code>, etc.) — see each model card's "Runtime notes" below (
      <a className="text-[var(--accent-2)] underline" href="#gemma4">gemma4</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#qwen36">qwen36</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#nemotron3">nemotron3</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#glm47_flash">glm47_flash</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#gpt_oss">gpt_oss</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#minimax">minimax</a>). The LM Studio host has a{" "}
      <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">separate card</a>.
    </li>,
    <li key="sampling-overrides">
      The <strong className="text-[var(--foreground)]">samplingOverrides</strong> JSON shallow-overwrites on top of the selected preset values. The server puts{" "}
      <code className="font-mono text-xs">repetition_penalty</code> into the actual request as-is (without conversion) — it does not map it to OpenAI's{" "}
      <code className="font-mono text-xs">frequency_penalty</code>. The overridable keys are the same as{" "}
      <code className="font-mono text-xs">SamplingParams</code>, and <code className="font-mono text-xs">frequency_penalty</code> is
      ignored (stripped) by the server schema.
    </li>,
    <li key="profile-scope">
      This page covers only profiles (sampling and runtime options). For bench-runner behavior such as per-scenario vision <code className="font-mono text-xs">max_tokens</code> floors /{" "}
      <code className="font-mono text-xs">truncated_at_max_tokens</code> labels, see the "Vision bench scenarios" section of the repo README.
    </li>,
  ],
  runtimeExampleSummary: <>Example: general model + coding + thinking on</>,

  presetSectionHeading: <>Preset descriptions</>,
  presetIntro: [
    <>
      A preset name refers to “what intent this sampling bundle was built for.” Even with the same name,{" "}
      <strong className="text-[var(--foreground)]">values can differ by family</strong>, so for exact numbers see the
      “Sampling by preset” table on each family card.
    </>,
    <>
      The <strong className="text-[var(--foreground)]">Profile</strong> column in the model table is a snapshot based on the current UI settings +{" "}
      <code className="font-mono text-xs">taskMode: "general"</code>. When a scenario switches to{" "}
      <code className="font-mono text-xs">coding</code>·<code className="font-mono text-xs">tool</code> during a bench (unless a preset
      is forced), <PresetAnchor name="thinking_coding" />·<PresetAnchor name="tool_call" /> are actually used.
      Also, the family name in the column may differ from the{" "}
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> result, because a UI profile override (<code className="font-mono text-xs">profileId</code>) takes precedence.
    </>,
  ],
  presetCardLabels: {
    when: <>When it's selected</>,
    intent: <>What the preset is for</>,
    examples: <>Example scenarios</>,
    refs: <>Reference values (family cards)</>,
  },
  presetDescriptions: {
    default: {
      when: (
        <>
          Forced only in the <code className="font-mono text-xs">qwen3_coder_next</code> family, regardless of
          taskMode·thinking. In other families the heuristic never picks this name, and even if you pick{" "}
          <code className="font-mono text-xs">default</code> in the UI preset override it is ignored and the heuristic is reapplied.
        </>
      ),
      intent: (
        <>
          A per-family “recommended starting point.” Usually the same as <PresetAnchor name="thinking_general" />, or close
          to its diversity. The unknown family drops to a conservative fallback (<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>) instead of this name.
        </>
      ),
      examples: [
        "General use of qwen3_coder_next-based coder models",
        "When you want to temporarily bypass a specific heuristic and compare against family defaults",
      ],
    },
    thinking_general: {
      when: <>Auto-selected for thinking on + general scenarios (not coding/tool).</>,
      intent: (
        <>
          For reasoning and exploration. Many families keep top_p·temperature slightly higher for diversity (qwen36: 1.0 / 0.95).
        </>
      ),
      examples: [
        "Analysis · summarization · Q&A · multi-step reasoning",
        "Image description in vision scenarios",
        "Long document / long-context summarization",
      ],
    },
    thinking_coding: {
      when: <>Auto-selected for thinking on + coding scenarios.</>,
      intent: (
        <>
          Higher determinism. Lowers presence/temperature to prioritize consistent code generation (for qwen36: temperature 0.6,
          presence 0.0).
        </>
      ),
      examples: [
        "Writing functions/modules, modifying/refactoring existing code",
        "Debugging from stack traces · test failures",
        "Writing patches to address review comments",
      ],
    },
    nonthinking_general: {
      when: <>Auto-selected for thinking off (thinking blocked) + non-tool scenarios.</>,
      intent: (
        <>
          Short, direct responses. Some families are very conservative — <FamilyAnchor id="nemotron3" /> drops to{" "}
          <code className="font-mono text-xs">temperature 0.2 + top_k 1</code>.
        </>
      ),
      examples: [
        "Short classification · labeling",
        "Format conversion (e.g., short answer → one-line JSON)",
        "Latency-sensitive short-answer Q&A",
      ],
    },
    tool_call: {
      when: <>Forced for all families when taskMode = tool.</>,
      intent: <>Conservative sampling for stability of structured calls (function/JSON).</>,
      examples: [
        "Function-call (tool use) scenarios in general",
        "Generating structured responses with a fixed schema",
      ],
    },
  },

  runtimeNotesHeading: <>Runtime notes</>,
  runtimeNotes: {
    qwen35: [
      <li key="enable_thinking">
        When thinking is turned <strong className="text-[var(--foreground)]">off</strong>, the request carries{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>.
        It only takes effect when LM Studio/vLLM forwards <code className="font-mono text-xs">chat_template_kwargs</code>.
      </li>,
    ],
    qwen36: [
      <li key="enable_thinking">
        When thinking is turned <strong className="text-[var(--foreground)]">off</strong>, the request carries{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>.
        It only takes effect when LM Studio/vLLM forwards <code className="font-mono text-xs">chat_template_kwargs</code>.
      </li>,
      <li key="preserve_thinking">
        If <code className="font-mono text-xs">preserve_thinking</code> is enabled in the UI, it is merged into the same{" "}
        <code className="font-mono text-xs">chat_template_kwargs</code> object.
      </li>,
    ],
    nemotron3: [
      <li key="enable_thinking">
        When thinking is turned <strong className="text-[var(--foreground)]">off</strong>, the request carries{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>.
        It only takes effect when LM Studio/vLLM forwards <code className="font-mono text-xs">chat_template_kwargs</code>.
      </li>,
      <li key="nemotron_inline">
        Nano etc.: inline <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>. Super/30B: stream{" "}
        <code className="font-mono text-xs">reasoning</code> / <code className="font-mono text-xs">reasoning_content</code> separation is
        common, and cases where only the closing tag appears in the body are handled by the strip regex.
      </li>,
    ],
    gemma4: [
      <li key="enable_thinking">
        When thinking is turned <strong className="text-[var(--foreground)]">off</strong>, the request carries{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code>.
        It only takes effect when LM Studio/vLLM forwards <code className="font-mono text-xs">chat_template_kwargs</code>.
      </li>,
      <li key="gemma_think_token">
        When thinking is turned <strong className="text-[var(--foreground)]">on</strong>,{" "}
        <code className="font-mono text-xs">&lt;|think|&gt;</code> is prepended to the system prompt. Official channel output is{" "}
        <code className="font-mono text-xs">&lt;|channel&gt;thought\n</code> … <code className="font-mono text-xs">&lt;channel|&gt;</code>
        (same chat template incl. QAT). 12B/26B/31B may emit an empty thought prefix when thinking is OFF — the bench mitigates this with strip and{" "}
        <code className="font-mono text-xs">enable_thinking: false</code>.
      </li>,
      <li key="gemma_lmstudio">
        For LM Studio Reasoning Parsing · template crashes, see the{" "}
        <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">
          LM Studio host setup
        </a>
        {" "}card.
      </li>,
    ],
    glm47_flash: [
      <li key="glm47_close_only">
        The chat template inserts an opening <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code> into the generation prompt, so
        the stream may carry only the <strong className="text-[var(--foreground)]">closing tag</strong>.{" "}
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code> is false (no history strip).
      </li>,
    ],
    gpt_oss: [
      <li key="reasoning_effort">
        OpenAI-compatible <code className="font-mono text-xs">reasoning_effort</code> is carried in the meta. If you select a level (minimal–high) in the UI, that value takes precedence; if unspecified,{" "}
        <code className="font-mono text-xs">"medium"</code> applies.
      </li>,
    ],
    minimax: [
      <li key="reasoning_split">
        For the Interleaved format of the OpenAI-compatible API, the request includes <code className="font-mono text-xs">reasoning_split: true</code>.
      </li>,
      <li key="strip_thinking">
        The native format (<code className="font-mono text-xs">&lt;redacted_thinking&gt;</code> inside{" "}
        <code className="font-mono text-xs">content</code>) assumes <code className="font-mono text-xs">content</code> is left as-is in history — this project does not strip thinking blocks from the assistant history for minimax.
      </li>,
    ],
    qwen3_coder_next: [
      <li key="default_preset">
        Preset heuristic exception: regardless of taskMode·thinkingIntent, it always uses the <PresetAnchor name="default" />{" "}
        preset.
      </li>,
    ],
  },

  promptRulesHeading: <>promptRules</>,
  samplingTableHeading: <>Sampling by preset</>,
  familyMatchLabel: <>match</>,
  promptRules: {
    gemmaThinkToken: "Gemma: prepend <|think|> at the start of the system prompt when thinking is on",
    stripThinkingFromHistory: "Strip thinking blocks before inserting into assistant history",
    none: "None",
  },

  unknownFamilyHeading: <>unknown family</>,
  unknownFamily: (
    <>
      The behavior when no definition matches is the same as the bench server's meta-build logic. Explicitly picking
      unknown in the UI behaves the same way — close to defaults, without the built-in table. The preset{" "}
      <strong className="text-[var(--foreground)]">name</strong> is decided by the same heuristic (usually{" "}
      <PresetAnchor name="thinking_general" />, etc.), but since there is no definition, a conservative fallback
      (<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>) applies.
    </>
  ),
};
