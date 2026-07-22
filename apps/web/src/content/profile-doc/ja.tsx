import { FamilyAnchor, PresetAnchor } from "../../ProfileDocPage";
import type { ProfileDocContent } from "./types";

// ja — ko와 키가 정확히 일치해야 함(ProfileDocContent 타입이 강제). 사람 텍스트만 번역, 마크업·식별자·앵커·숫자는 동일.
export const ja: ProfileDocContent = {
  docTitle: <>モデルプロファイルドキュメント</>,
  intro: (
    <>
      ベンチ画面のプロファイル選択・モデル行のヒントは、ここでの定義を要約して表示します。数値・マッチ規則の単一の出典は{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">@llm-bench/shared</code> の{" "}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">LLM_PROFILE_DEFINITIONS</code> です。
    </>
  ),

  autoInferHeading: <>自動プロファイル推論</>,
  autoInfer: (
    <>
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> は定義配列の順に{" "}
      <code className="font-mono text-xs">match</code> 正規表現を適用し、最初に一致したファミリーを選びます。何も一致しなければ{" "}
      <code className="font-mono text-xs">unknown</code> となり、その場合は組み込みプリセットテーブルを使わず、保守的なデフォルトサンプリングのみを使います。
    </>
  ),

  thinkingBlockStripHeading: <>思考ブロックの検出・除去</>,
  thinkingBlockStrip: (
    <>
      <p className="mb-3 text-sm leading-relaxed text-[var(--muted)]">
        単一の出典: <code className="font-mono text-xs">stripThinkingBlocks</code> /{" "}
        <code className="font-mono text-xs">partitionThinkingBlocks</code> (
        <code className="font-mono text-xs">@llm-bench/shared</code>)。採点・JSON 抽出・シナリオ詳細 UI・マルチターン履歴(
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code>)に適用されます。
      </p>
      <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              <th className="p-2 font-medium text-[var(--foreground)]">インラインパターン</th>
              <th className="p-2 font-medium text-[var(--muted)]">代表的なモデル</th>
            </tr>
          </thead>
          <tbody className="text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;redacted_thinking&gt;…&lt;/redacted_thinking&gt;</td>
              <td className="p-2">Qwen 3.5/3.6</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">先頭 …&lt;/redacted_thinking&gt;(開きタグなし)</td>
              <td className="p-2">GLM-4.7-Flash, Nemotron 30B</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|think|&gt;…&lt;|end_of_thought|&gt; など</td>
              <td className="p-2">Qwen think トークン</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n…&lt;channel|&gt;</td>
              <td className="p-2">Gemma 4(公式、QAT を含む)</td>
            </tr>
            <tr className="border-b border-[var(--border)]">
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel|&gt;thought…&lt;channel|&gt;</td>
              <td className="p-2">LM Studio 変種</td>
            </tr>
            <tr>
              <td className="p-2 font-mono text-[var(--foreground)]">&lt;|channel&gt;thought\n プレフィックス(閉じタグなし)</td>
              <td className="p-2">Gemma 4 思考 OFF — 2 回目の peel</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        <code className="font-mono text-xs">reasoning_content</code> / Anthropic <code className="font-mono text-xs">thinking_delta</code> /
        MiniMax <code className="font-mono text-xs">reasoning_split</code> はストリーム段階で推論を分離します。上記の regex は{" "}
        <code className="font-mono text-xs">chat_completions</code> のマージされた出力・LM Studio パーサー未設定時のフォールバックです。
      </p>
    </>
  ),

  lmstudioHostHeading: <>LM Studio ホスト設定</>,
  lmstudioHost: (
    <>
      <p className="mb-3 text-xs text-[var(--muted)]">
        ベンチサーバーのコードではなく、<strong className="text-[var(--foreground)]">LM Studio が動作するマシン</strong>での対応です。
      </p>
      <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-[var(--muted)]">
        <li>
          <strong className="text-[var(--foreground)]">エンジンプロトコル回帰(ツール破損・推論リーク)</strong> — Developer → Runtime Settings の{" "}
          <code className="font-mono text-xs">Use LM Studio Engine Protocol</code> が有効な 0.4.14–0.4.18 のベータランタイムでは、ストリーミングの{" "}
          <code className="font-mono text-xs">tool_calls</code> 引数が <code className="font-mono text-xs">{"{}{}"}</code> に連結・破損したり(bug-tracker #1922)、
          推論が <code className="font-mono text-xs">reasoning_content</code> ではなく本文の <code className="font-mono text-xs">content</code> に漏れ込んだりします(0.4.19 で修正)。
          ベンチ結果の表・詳細に <span className="text-[var(--warning)]">⚠</span> バッジとして検出されます。{" "}
          <strong className="text-[var(--foreground)]">LM Studio を 0.4.19+ に更新する</strong>か、このオプションをオフにして再計測してください。
          Developer の "When applicable, separate reasoning_content and content in API responses" も有効にしておくと良いです。
        </li>
        <li>
          <strong className="text-[var(--foreground)]">思考パース(Gemma 4・QAT)</strong> — デフォルトの Reasoning Parsing は Qwen 向けの{" "}
          <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code> のため、channel タグが本文に漏れたり思考 UI が空に見えることが
          あります。モデルごとに Inference → Reasoning Parsing:{" "}
          <code className="font-mono text-xs">startString=&lt;|channel&gt;thought</code>,{" "}
          <code className="font-mono text-xs">endString=&lt;channel|&gt;</code>。
        </li>
        <li>
          <strong className="text-[var(--foreground)]">Jinja テンプレートのクラッシュ</strong> — Anthropic{" "}
          <code className="font-mono text-xs">/v1/messages</code> + <code className="font-mono text-xs">tools</code> のシナリオ(
          <code className="font-mono text-xs">tool_weather</code>, <code className="font-mono text-xs">translate_nist_fips197_pdf_tools</code>
          )で <code className="font-mono text-xs">Error rendering prompt with jinja template</code> → 空応答。対象:{" "}
          <code className="font-mono text-xs">google/gemma-4-*</code>, <code className="font-mono text-xs">nvidia/nemotron-3-nano*</code>。
          OpenAI <code className="font-mono text-xs">chat_completions</code> は概ね正常です。
        </li>
        <li>
          <strong className="text-[var(--foreground)]">ホストパッチスクリプト</strong> — repo ルートから LM Studio ホストで実行:{" "}
          <code className="font-mono text-xs">scripts/fix-gemma4-lmstudio-template.sh</code>,{" "}
          <code className="font-mono text-xs">scripts/fix-nemotron-lmstudio-template.sh</code>。{" "}
          <code className="font-mono text-xs">--dry-run</code> で diff を確認してから適用 → モデルを UNLOAD·RELOAD。
        </li>
        <li>
          詳細ドキュメント: <code className="font-mono text-xs">docs/lmstudio-engine-protocol.md</code>(エンジンプロトコル回帰)、{" "}
          <code className="font-mono text-xs">docs/lmstudio-jinja-template-crashes.md</code>(Jinja クラッシュ)— リポジトリルート
        </li>
        <li>
          <code className="font-mono text-xs">stripThinkingBlocks</code>·<code className="font-mono text-xs">enable_thinking</code> は
          応答の後処理・リクエストメタです。ホストのパース/テンプレートが合っていないと、ツールシナリオの失敗・TTFT の歪みなど{" "}
          <strong className="text-[var(--foreground)]">計測前</strong>に壊れることがあるため、両方が必要です。
        </li>
      </ul>
    </>
  ),

  runtimeApplyHeading: <>ランタイム適用(ベンチリクエスト)</>,
  runtimeApply: [
    <li key="taskmode">
      シナリオごとに <strong className="text-[var(--foreground)]">taskMode</strong>(general / coding / tool)が決まり、UI の{" "}
      <strong className="text-[var(--foreground)]">thinkingIntent</strong>(on/off)とともに{" "}
      <code className="font-mono text-xs">resolveBenchProfile</code> に渡されます。
    </li>,
    <li key="tool-heuristic">
      <strong className="text-[var(--foreground)]">tool</strong> シナリオは常に{" "}
      <PresetAnchor name="tool_call" /> プリセットを使います。それ以外は thinking off →{" "}
      <PresetAnchor name="nonthinking_general" />, coding → <PresetAnchor name="thinking_coding" />, その他 →{" "}
      <PresetAnchor name="thinking_general" /> です。<FamilyAnchor id="qwen3_coder_next" /> は例外で常に{" "}
      <PresetAnchor name="default" /> プリセットです。
    </li>,
    <li key="preset-force">
      UI で <strong className="text-[var(--foreground)]">preset の強制</strong>を有効にすると(空でなければ)、上のヒューリスティックの代わりにそのプリセットが使われます。
    </li>,
    <li key="max-tokens">
      <strong className="text-[var(--foreground)]">max_tokens</strong> は UI に数値を入れるとその値が優先され、空にするとシナリオの複雑さに応じて{" "}
      <code className="font-mono text-xs">recommendedMaxTokens.default</code> または{" "}
      <code className="font-mono text-xs">.complex</code> が適用されます。
    </li>,
    <li key="family-detail">
      <strong className="text-[var(--foreground)]">ファミリーごとの詳細な挙動</strong>(<code className="font-mono text-xs">enable_thinking</code>,{" "}
      <code className="font-mono text-xs">reasoning_effort</code>, <code className="font-mono text-xs">reasoning_split</code> など)は、下の各モデルカードの「ランタイムノート」を参照してください(
      <a className="text-[var(--accent-2)] underline" href="#gemma4">gemma4</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#qwen36">qwen36</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#nemotron3">nemotron3</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#glm47_flash">glm47_flash</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#gpt_oss">gpt_oss</a>,{" "}
      <a className="text-[var(--accent-2)] underline" href="#minimax">minimax</a>)。LM Studio ホストは{" "}
      <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">別カード</a>。
    </li>,
    <li key="sampling-overrides">
      <strong className="text-[var(--foreground)]">samplingOverrides</strong> JSON は選択されたプリセット値の上に浅く上書きします。サーバーは{" "}
      <code className="font-mono text-xs">repetition_penalty</code> を(変換せず)そのまま実際のリクエストに入れます — OpenAI の{" "}
      <code className="font-mono text-xs">frequency_penalty</code> には移しません。オーバーライド可能なキーは{" "}
      <code className="font-mono text-xs">SamplingParams</code> と同じで、<code className="font-mono text-xs">frequency_penalty</code> は
      サーバースキーマで無視(strip)されます。
    </li>,
    <li key="profile-scope">
      本ページはプロファイル(サンプリング・ランタイムオプション)に限定されます。シナリオごとのビジョン <code className="font-mono text-xs">max_tokens</code> floor /{" "}
      <code className="font-mono text-xs">truncated_at_max_tokens</code> ラベルなどのベンチランナーの挙動は、リポジトリ README の「ビジョンベンチシナリオ」節を参照してください。
    </li>,
  ],
  runtimeExampleSummary: <>例: 一般モデル + coding + thinking on</>,

  presetSectionHeading: <>プリセットの説明</>,
  presetIntro: [
    <>
      プリセット名は「どんな意図で作られたサンプリングの束か」を指します。同じ名前でも{" "}
      <strong className="text-[var(--foreground)]">ファミリーによって値が異なることがある</strong>ため、正確な数値は各ファミリー
      カードの「プリセット別サンプリング」表を見てください。
    </>,
    <>
      モデルテーブルの <strong className="text-[var(--foreground)]">プロファイル</strong> 列は、現在の UI 設定 +{" "}
      <code className="font-mono text-xs">taskMode: "general"</code> を基準としたスナップショットです。ベンチ中にシナリオが{" "}
      <code className="font-mono text-xs">coding</code>·<code className="font-mono text-xs">tool</code> に変わると(プリセット
      強制がない限り)、実際には <PresetAnchor name="thinking_coding" />·<PresetAnchor name="tool_call" /> が使われます。
      また、列のファミリー名は UI のプロファイル強制(<code className="font-mono text-xs">profileId</code>)が優先されるため、{" "}
      <code className="font-mono text-xs">inferLlmProfileFamily(modelId)</code> の結果と異なることがあります。
    </>,
  ],
  presetCardLabels: {
    when: <>いつ選択されるか</>,
    intent: <>何のためのプリセットか</>,
    examples: <>例となるシナリオ</>,
    refs: <>参照する数値(ファミリーカード)</>,
  },
  presetDescriptions: {
    default: {
      when: (
        <>
          <code className="font-mono text-xs">qwen3_coder_next</code> ファミリーでのみ、taskMode·thinking に
          関係なく強制されます。他のファミリーではヒューリスティックがこの名前を選ばず、UI のプリセット強制で{" "}
          <code className="font-mono text-xs">default</code> を選んでも無視され、ヒューリスティックが再適用されます。
        </>
      ),
      intent: (
        <>
          ファミリーごとの「推奨開始値」。通常 <PresetAnchor name="thinking_general" /> と同じか、それに準じる
          多様性を持ちます。unknown ファミリーはこの名前の代わりに保守的なフォールバック(<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>)に落ちます。
        </>
      ),
      examples: [
        "qwen3_coder_next ベースのコーダーモデルの一般利用",
        "特定のヒューリスティックを一時的に回避し、ファミリーのデフォルト値で比較したいとき",
      ],
    },
    thinking_general: {
      when: <>thinking on + 一般シナリオ(coding/tool 以外)で自動選択されます。</>,
      intent: (
        <>
          推論・探索向け。多様性のために top_p·temperature をやや高めに設定するファミリーが多いです(qwen36: 1.0 / 0.95)。
        </>
      ),
      examples: [
        "分析・要約・Q&A・マルチステップ推論",
        "ビジョンシナリオの画像説明",
        "長い文書 / ロングコンテキストの要約",
      ],
    },
    thinking_coding: {
      when: <>thinking on + coding シナリオで自動選択されます。</>,
      intent: (
        <>
          決定性↑。presence/temperature を下げて一貫したコード生成を優先します(qwen36 では temperature 0.6,
          presence 0.0)。
        </>
      ),
      examples: [
        "関数/モジュールの作成、既存コードの修正・リファクタリング",
        "スタックトレース・テスト失敗のデバッグ",
        "レビューコメント反映のためのパッチ作成",
      ],
    },
    nonthinking_general: {
      when: <>thinking off(思考の遮断) + tool 以外のシナリオで自動選択されます。</>,
      intent: (
        <>
          短く直接的な応答。一部のファミリーは非常に保守的です — <FamilyAnchor id="nemotron3" /> は{" "}
          <code className="font-mono text-xs">temperature 0.2 + top_k 1</code> まで下げます。
        </>
      ),
      examples: [
        "短い分類・ラベリング",
        "形式変換(例: 短答 → JSON 1 行)",
        "latency に敏感な短答 Q&A",
      ],
    },
    tool_call: {
      when: <>taskMode = tool のとき、すべてのファミリーで強制されます。</>,
      intent: <>構造化された呼び出し(関数/JSON)の安定性のための保守的なサンプリング。</>,
      examples: [
        "関数呼び出し(tool use)シナリオ全般",
        "スキーマが定まった構造化応答の生成",
      ],
    },
  },

  runtimeNotesHeading: <>ランタイムノート</>,
  runtimeNotes: {
    qwen35: [
      <li key="enable_thinking">
        thinking を <strong className="text-[var(--foreground)]">オフ</strong> にするとリクエストに{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code> が載ります。
        LM Studio/vLLM が <code className="font-mono text-xs">chat_template_kwargs</code> を渡すときのみ効力があります。
      </li>,
    ],
    qwen36: [
      <li key="enable_thinking">
        thinking を <strong className="text-[var(--foreground)]">オフ</strong> にするとリクエストに{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code> が載ります。
        LM Studio/vLLM が <code className="font-mono text-xs">chat_template_kwargs</code> を渡すときのみ効力があります。
      </li>,
      <li key="preserve_thinking">
        UI で <code className="font-mono text-xs">preserve_thinking</code> が有効になっていると、同じ{" "}
        <code className="font-mono text-xs">chat_template_kwargs</code> オブジェクトにマージされます。
      </li>,
    ],
    nemotron3: [
      <li key="enable_thinking">
        thinking を <strong className="text-[var(--foreground)]">オフ</strong> にするとリクエストに{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code> が載ります。
        LM Studio/vLLM が <code className="font-mono text-xs">chat_template_kwargs</code> を渡すときのみ効力があります。
      </li>,
      <li key="nemotron_inline">
        Nano など: インライン <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>。Super/30B: ストリームの{" "}
        <code className="font-mono text-xs">reasoning</code> / <code className="font-mono text-xs">reasoning_content</code> 分離が
        よくあり、閉じタグだけが本文に来る場合も strip regex で処理します。
      </li>,
    ],
    gemma4: [
      <li key="enable_thinking">
        thinking を <strong className="text-[var(--foreground)]">オフ</strong> にするとリクエストに{" "}
        <code className="font-mono text-xs">extra_body.chat_template_kwargs.enable_thinking: false</code> が載ります。
        LM Studio/vLLM が <code className="font-mono text-xs">chat_template_kwargs</code> を渡すときのみ効力があります。
      </li>,
      <li key="gemma_think_token">
        思考を <strong className="text-[var(--foreground)]">オン</strong> にするとシステムプロンプトの前に{" "}
        <code className="font-mono text-xs">&lt;|think|&gt;</code> が付きます。公式のチャネル出力は{" "}
        <code className="font-mono text-xs">&lt;|channel&gt;thought\n</code> … <code className="font-mono text-xs">&lt;channel|&gt;</code>
        (QAT を含め同一の chat template)。12B/26B/31B は思考 OFF 時に空の thought プレフィックスが出ることがあります — ベンチは strip·{" "}
        <code className="font-mono text-xs">enable_thinking: false</code> で緩和します。
      </li>,
      <li key="gemma_lmstudio">
        LM Studio の Reasoning Parsing・テンプレートクラッシュは、{" "}
        <a className="text-[var(--accent-2)] underline" href="#lmstudio-host">
          LM Studio ホスト設定
        </a>
        カードを参照してください。
      </li>,
    ],
    glm47_flash: [
      <li key="glm47_close_only">
        chat template が generation prompt に開きの <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code> を入れるため、
        ストリームには <strong className="text-[var(--foreground)]">閉じタグだけ</strong> が来ることがあります。{" "}
        <code className="font-mono text-xs">stripThinkingFromAssistantHistory</code> は false(履歴の strip はしない)。
      </li>,
    ],
    gpt_oss: [
      <li key="reasoning_effort">
        OpenAI 互換の <code className="font-mono text-xs">reasoning_effort</code> がメタに載ります。UI で段階(minimal–high)を選ぶとその値が優先され、未指定時は{" "}
        <code className="font-mono text-xs">"medium"</code> が適用されます。
      </li>,
    ],
    minimax: [
      <li key="reasoning_split">
        OpenAI 互換 API の Interleaved 形式のために、リクエストに <code className="font-mono text-xs">reasoning_split: true</code> が含まれます。
      </li>,
      <li key="strip_thinking">
        ネイティブ形式(<code className="font-mono text-xs">content</code> 内の{" "}
        <code className="font-mono text-xs">&lt;redacted_thinking&gt;</code>)は履歴で <code className="font-mono text-xs">content</code> をそのまま残すことが前提 — 本プロジェクトは minimax に対して assistant 履歴の thinking ブロックを除去しません。
      </li>,
    ],
    qwen3_coder_next: [
      <li key="default_preset">
        preset heuristic の例外: taskMode·thinkingIntent に関係なく、常に <PresetAnchor name="default" />{" "}
        プリセットを使います。
      </li>,
    ],
  },

  promptRulesHeading: <>promptRules</>,
  samplingTableHeading: <>プリセット別サンプリング</>,
  familyMatchLabel: <>マッチ</>,
  promptRules: {
    gemmaThinkToken: "Gemma: 思考オン時にシステムプロンプトの前に <|think|> を挿入",
    stripThinkingFromHistory: "アシスタント履歴に入れる前に思考ブロックを除去",
    none: "なし",
  },

  unknownFamilyHeading: <>unknown ファミリー</>,
  unknownFamily: (
    <>
      マッチする定義がないときの動作は、ベンチサーバーのメタ構築ロジックと同じです。UI で明示的に unknown を選んだ場合も同様に、
      組み込みテーブルなしでデフォルトに近い動作をします。プリセットの <strong className="text-[var(--foreground)]">名前</strong> は同じ
      ヒューリスティック(主に <PresetAnchor name="thinking_general" /> など)で決まりますが、定義がないため保守的なフォールバック
      (<code className="font-mono text-xs">temperature: 0.2, top_p: 1.0</code>)が適用されます。
    </>
  ),
};
