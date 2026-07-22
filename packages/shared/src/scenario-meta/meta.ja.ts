import type { ScenarioId } from "../scenarios-preview";
import type { ScenarioBenchMetaText } from "./types";
import {
  CHART_VALUE_ABS_TOL,
  COUNT_RED_CARS_MAX_PLAUSIBLE,
  COUNT_RED_CARS_TOL_FAR,
  COUNT_RED_CARS_TOL_NEAR,
  DEFAULT_CALENDAR_TIMEZONE,
  DEFAULT_LLM_JUDGE_MODEL,
  JUDGE_FAILURE_LABELS,
  LLM_JUDGE_MAX_RETRIES,
  LLM_JUDGE_TIMEOUT_MS,
  MEME_PREFILTER_CUES,
  OCR_VALUE_REL_TOL,
  OCR_YOY_ABS_TOL,
  VISION_SCORING_GROUND_TRUTH,
  WIREFRAME_MIN_SEMANTIC_TAGS,
  WIREFRAME_SEMANTIC_TAGS,
} from "../scenario-scoring-constants";

const VISION_ROUTES_JA =
  "ビジョン対応モデルのみ: OpenAI Chat Completions(image_url) / Anthropic Messages(image source)。 " +
  "loopback・プライベートネットワーク(RFC1918)の origin は自動的に base64 インライン化、公開 origin は URL。";

const VISION_JSON_EXTRACT_JA =
  "サーバーは応答から fenced ```json``` ブロックを優先 → 最後の balanced `{...}` → 最初の balanced `{...}` の順に JSON オブジェクトを抽出";

const fmtCues = (cues: readonly string[]): string => cues.map((c) => `\`${c}\``).join(", ");

const JUDGE_OPS_JA =
  "(c) 有効化の方法: 環境変数 `LLM_JUDGE_ENABLED=1` と `ANTHROPIC_API_KEY` を両方設定。 " +
  `既定の judge モデル \`${DEFAULT_LLM_JUDGE_MODEL}\` (\`LLM_JUDGE_MODEL\` で差し替え可能)。 ` +
  `呼び出し仕様: temperature 0、timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s、リトライ ${LLM_JUDGE_MAX_RETRIES}回。\n`;

const MEME_PREFILTER_JA =
  "(b) サーバー prefilter (4 種すべて通過して初めて judge へ進む):\n" +
  "  ① ハングルを含む\n" +
  `  ② サーバー・データセンターの手がかり (${fmtCues(MEME_PREFILTER_CUES.server)})\n` +
  `  ③ ロバ・荷車の手がかり (${fmtCues(MEME_PREFILTER_CUES.donkey)})\n` +
  `  ④ 対比・期待・現実の手がかり (${fmtCues(MEME_PREFILTER_CUES.contrast)})\n`;

/** (e) Judge 실패 공통 문구 — wireframe은 `extra`로 `upstream_no_vision` 라벨 추가. */
const judgeFailJa = (extra = ""): string =>
  `(e) Judge 失敗(timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s / parse error / 5xx / API キーなし): ` +
  `rubric 0 + reason に ${JUDGE_FAILURE_LABELS.map((l) => `\`${l}\``).join(" / ")} ラベル。` +
  `${extra} pass は score ≥ 0.67 (rubric ≥ 2)。`;

const PASS_CUT_JA = "pass は score ≥ 0.67 (rubric ≥ 2)。";

const ocrCriteriaJa = (
  row: string,
  gt: { net_income_2024: number; net_income_yoy_percent: number },
  yoyPrefix = "",
): string =>
  `正解: '${row}' 行の 2024 Actual = ${gt.net_income_2024}、YoY = ${yoyPrefix}${gt.net_income_yoy_percent}%。 ` +
  "採点: JSON `{net_income_2024, net_income_yoy_percent}` を出力。 " +
  `両キーとも通過(値 ${OCR_VALUE_REL_TOL * 100}% 相対誤差 / YoY ${OCR_YOY_ABS_TOL}%p 絶対誤差)なら rubric 3、 ` +
  `片方のみ通過なら 2、両方とも誤差外だがパース成功なら 1、JSON パース失敗 / キー欠落 / 拒否応答なら 0。 ${PASS_CUT_JA}`;

const countCriteriaJa = (range: readonly [number, number]): string =>
  `正解範囲: ${range[0]}~${range[1]}台 (人が直接カウント)。 ` +
  "採点: JSON `{red_cars: <integer>}` を出力。 " +
  `範囲内なら rubric 3、±${COUNT_RED_CARS_TOL_NEAR}台なら 2、±${COUNT_RED_CARS_TOL_FAR}台なら 1、 ` +
  `それ以外 / \`red_cars = 0\` / ${COUNT_RED_CARS_MAX_PLAUSIBLE} 以上の幻覚 / JSON キー欠落 / 拒否応答なら 0。 ${PASS_CUT_JA}`;

const chartCriteriaJa = (gt: { product: string; quarter: string; value_percent: number }): string =>
  `正解: product = "${gt.product}"、quarter = "${gt.quarter}"、value_percent = ${gt.value_percent}。 ` +
  "採点: JSON `{product, quarter, value_percent}` を出力。 " +
  "3 条件すべて通過なら rubric 3、2 つなら 2、1 つなら 1、すべて失敗 / JSON パース失敗 / キー欠落なら 0。 " +
  `value_percent は ±${CHART_VALUE_ABS_TOL}%p 許容。 ${PASS_CUT_JA}`;

const MEME_CRITERIA_JA =
  "一行要約: 正解テキストの固定なし(主観採点) · LLM-as-Judge 必須 · judge 無効時は最大 rubric 1 (score 0.33、pass=false)。\n\n" +
  "(a) なぜ judge が必要か: 韓国語の自由記述応答のため決定論的採点が不可能で、風刺意図の解釈は外部モデルに委ねる。\n" +
  MEME_PREFILTER_JA +
  JUDGE_OPS_JA +
  "(d) Judge 有効時の rubric:\n" +
  "  • 3 = 両パネルのテキスト引用 + 視覚描写(サーバーラック vs ロバの荷車) + \"LLM のクラウド約束 vs ローカル PC の現実\" の風刺意図をすべて正確に説明。\n" +
  "  • 2 = OCR・視覚は正確だが技術的文脈(LLM/PC の結びつき)が弱い。\n" +
  "  • 1 = 描写のみで「なぜ面白いか」を未説明。\n" +
  "  • 0 = OCR 失敗 / 無関係な説明。\n" +
  judgeFailJa();

/** wireframe criteriaJa — A/B는 ③ 필수 단서 줄(표시용 케이스)만 다르다. */
const wireframeCriteriaJa = (displayCues: readonly string[]): string =>
  "一行要約: 正解 HTML の固定なし(構造一致で採点) · LLM-as-Judge 必須 · judge 無効時は最大 rubric 1 (score 0.33、pass=false)。\n\n" +
  "(a) なぜ judge が必要か: HTML テキストが多様で決定論的な比較が不可能なため、レイアウト・要素の再現は judge が視覚的に比較する。\n" +
  "(b) サーバー prefilter (すべて case-insensitive で通過して初めて judge へ進む):\n" +
  "  ① ```html``` フェンスまたは一般的な ``` コードフェンスが存在\n" +
  `  ② セマンティックタグ(${WIREFRAME_SEMANTIC_TAGS.map((t) => `${t}>`).join("·")})のうち ${WIREFRAME_MIN_SEMANTIC_TAGS} 個以上\n` +
  `  ③ 必須の手がかり ${fmtCues(displayCues)} をすべて含む\n` +
  JUDGE_OPS_JA +
  "(d) Judge 有効時の rubric:\n" +
  "  • 3 = grid/flex を使用、すべてのラベル付きセクションが正しい垂直順序、ラベル付き要素(ボタン・ナビ・フォームフィールド)をすべて再現。\n" +
  "  • 2 = レイアウトはおおむね正しいが整列のずれ、または 1~2 個の軽微な欠落。\n" +
  "  • 1 = 単一カラムに崩れる OR 主要なボタン・ナビが欠落。\n" +
  "  • 0 = コード生成の拒否 / 無関係なコード。\n" +
  judgeFailJa(" ビジョン非対応モデルの 400 は `upstream_no_vision` として別ラベル。");

const MEME_IMPLEMENTATION_JA =
  "scoreScenario は prefilter + 暫定 rubric 1 のみを算出(内部 `judge_pending` フラグ)。 " +
  `bench-runner は judge 有効 + prefilter 通過時に judge モデル(既定 \`${DEFAULT_LLM_JUDGE_MODEL}\`)を呼び出し 0~3 の rubric で上書きする。 ` +
  "judge 失敗は rubric 0。emit 直前に `judge_pending` フラグを SSE/DB から除去。";

const WIREFRAME_IMPLEMENTATION_JA =
  "scoreScenario: フェンス抽出 + substring マッチング(prefilter、case-insensitive) + 暫定 rubric 1(`judge_pending` フラグ)。 " +
  `bench-runner は judge 有効 + prefilter 通過時に judge モデル(既定 \`${DEFAULT_LLM_JUDGE_MODEL}\`)を呼び出し 0~3 の rubric で上書きする。 ` +
  "judge 失敗は rubric 0。";


export const META_JA: Record<ScenarioId, ScenarioBenchMetaText> = {
  chat_hello: {
    purpose: "短いリクエストに対する応答レイテンシ・接続を確認します。",
    criteria: "応答本文の品質評価は行いません。空白のみの空応答なら不合格、それ以外は合格です。",
    promptNotes: "固定された短い挨拶/テキストのリクエストです。ツールなし。",
    toolsSummary: "なし。",
    routes: "プロバイダーが対応していれば OpenAI Chat Completions と Anthropic Messages それぞれで同一のユーザーテキストにより 1 回ずつ測定されます。",
    implementation: "ストリームの完了可否とレイテンシのみが関心事で、本文は空でなければ十分です。",
  },
  chat_ping: {
    purpose: "追加の短いリクエストに対する応答レイテンシ・接続を確認します。",
    criteria: "応答本文の品質評価は行いません。空白のみの空応答なら不合格、それ以外は合格です。",
    promptNotes: "hello の次に来る短い ping スタイルのリクエストです。",
    toolsSummary: "なし。",
    routes: "プロバイダーが対応していれば OpenAI Chat Completions と Anthropic Messages それぞれで同一のユーザーテキストにより 1 回ずつ測定されます。",
    implementation: "ベンチループでシナリオ順としては 2 番目の軽量な往復です。",
  },
  code_sort_js: {
    purpose: "コードのみを出力するよう指示したとき、フェンスコードブロックとクイックソート実装に従うかを見ます。",
    criteria:
      "思考ブロック除去後、```js … ``` フェンスがあればその中のコードを、なければ本文全体を採点します。 " +
      "sortNums(または同等)、クイックソートの手がかり(partition・pivot・quicksort など)があり `.sort(` がなければ合格です。",
    promptNotes:
      "system: ```js``` フェンス・no prose・組み込み sort 禁止。user: sortNums のクイックソート実装課題のみ(形式指示は system のみ)。",
    toolsSummary: "なし。",
    routes: "通常テキストの completion スタイル。対応ルートごとに個別に測定されます。",
    implementation:
      "思考ブロック除去後、```js``` フェンスを優先抽出し、フェンスがなければ本文全体にフォールバックしたうえで、禁止 API・クイックソートのキーワードを検査します。",
  },
  code_sort_py: {
    purpose: "Python コードのみをフェンスブロックで出力させるとき、形式・クイックソート実装を見ます。",
    criteria:
      "思考ブロック除去後、```python … ``` フェンスがあればその中のコードを、なければ本文全体を採点します。 " +
      "def sort_nums、クイックソートの手がかり(partition・pivot・quicksort など)があり `sorted(`・`.sort(` がなければ合格です。",
    promptNotes:
      "system: ```python``` フェンス・no prose・組み込み sort 禁止。user: def sort_nums のクイックソート実装課題のみ(形式指示は system のみ)。",
    toolsSummary: "なし。",
    routes: "通常テキストの completion スタイル。対応ルートごとに個別に測定されます。",
    implementation:
      "思考ブロック除去後、```python``` フェンスを優先抽出し、フェンスがなければ本文全体にフォールバックしたうえで、関数名・組み込みソート禁止のルールで採点します。",
  },
  chat_time_calendar: {
    purpose: "プロンプトに注入された基準時刻をもとに、昨日・今日・明日の日付を正しく答えられるかを見ます。",
    criteria:
      `ベンチランナーが \`${DEFAULT_CALENDAR_TIMEZONE}\` に固定したカレンダー基準の昨日・今日・明日の YYYY-MM-DD 3 値がすべて出力に含まれれば合格です。`,
    promptNotes:
      `ベンチランナーが UTC T06:00 に固定した \`referenceAt\` を \`${DEFAULT_CALENDAR_TIMEZONE}\` に変換した日付(YYYY-MM-DD)をプロンプトへ直接注入します。モデルはタイムゾーン変換なしで ±1 日の計算のみを行えば十分です。`,
    toolsSummary: "なし。",
    routes: "通常のチャットメッセージ。両ルート対応時はそれぞれ測定。",
    implementation: "サーバーが同一の基準時刻で期待日付 3 つを計算し、部分文字列の包含有無で判定します。",
  },
  tool_weather: {
    purpose: "天気の質問に対して、提供された get_weather ツールを呼び出すかを見ます。",
    criteria:
      "サーバーがストリームから収集したツール呼び出しは、出力末尾に `{\"tool_calls\":[{\"function\":{\"name\":\"get_weather\",…}}]}` の JSON としてシリアライズされます。 " +
      "このシリアライズパターン(`\"name\":\"get_weather\"`)または JSON `tool_calls` のパースで呼び出しが確認できれば合格 — 本文中で単語 `get_weather` を平文で言及しただけの場合は不合格です。",
    promptNotes: "都市の天気を尋ねる単一ターンのユーザーメッセージです。",
    toolsSummary:
      "OpenAI 形式: `get_weather(city: string)`。Anthropic 形式: 同一の名前・input_schema。実際の HTTP 天気 API は呼び出さず、呼び出しの有無のみを検査します。",
    routes: "ツールスキーマが付いた chat / messages リクエスト。",
    implementation:
      "完了した出力文字列に対し、`\"name\":\"get_weather\"` パターンの正規表現と、全体/行単位の JSON `tool_calls[].function.name` パースで検査します。平文の単語言及は合格シグナルではありません。",
  },
  structured_action: {
    purpose: "prose なしで有効な JSON オブジェクト 1 つのみを出力させるとき、スキーマ遵守を見ます。",
    criteria: '{"action":"文字列","confidence":0~1 の数値} 形式の JSON がパース・検証できれば合格です。',
    promptNotes:
      "system: JSON スキーマ・形式(prose・フェンス禁止)。user: 四半期レポートを検討して submit/revise/hold を選ぶ課題。",
    toolsSummary: "なし。",
    routes: "通常テキストの応答を JSON としてパース試行。",
    implementation:
      `${VISION_JSON_EXTRACT_JA}し、\`JSON.parse\` 後にスキーマ(action は文字列、confidence は 0~1 の数値)を検証します。ビジョンシナリオと同一の抽出経路です。`,
  },
  vision_table_ocr_a: {
    purpose: "複雑な財務表の画像から 'Net Income' 行の 2024 Actual 値と YoY 変化率を正確に抽出できるかを評価します (ChatGPT 生成画像)。",
    criteria: ocrCriteriaJa("Net Income", VISION_SCORING_GROUND_TRUTH.vision_table_ocr_a),
    promptNotes:
      "画像には 'Net Income' と 'Net Income Attributable to Shareholders' の 2 行が別々に存在します — プロンプトは正確な 'Net Income' 行を要求します(case-insensitive マッチング許容)。",
    toolsSummary: "なし。画像 1 枚が user メッセージに image_url(または base64)パートとして含まれます。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → 両キーを number に正規化(カンマ・$・% を strip) → 誤差検査。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_table_ocr_b: {
    purpose: "複雑な財務表の画像から 'NET INCOME' 行の 2024 Actual 値と YoY 変化率を正確に抽出できるかを評価します (Gemini 生成画像)。",
    criteria: ocrCriteriaJa("NET INCOME", VISION_SCORING_GROUND_TRUTH.vision_table_ocr_b, "+"),
    promptNotes:
      "B 画像は AI 生成アーティファクトで、COGS・R&D・OPERATING INCOME など複数の行が同一の数値(410.55/+20.7%)を共有します。v1 採点は数値のみを見るため、*行の識別失敗* と *正確な識別* を区別できません。",
    toolsSummary: "なし。画像 1 枚が user メッセージに image_url(または base64)パートとして含まれます。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → 両キーを number に正規化(カンマ・$・% を strip) → 誤差検査。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_count_red_cars_a: {
    purpose: "密集した空撮の駐車場写真から赤い車両の数を正確にカウントできるかを評価します (ChatGPT 生成画像)。",
    criteria: countCriteriaJa(VISION_SCORING_GROUND_TRUTH.vision_count_red_cars_a.range),
    promptNotes:
      "人が直接カウントした範囲が ground truth です。生成モデルのプロンプトは「おおよそ 15~20 台」を要求しましたが、実際には両画像とも 30 台以上 — モデルがプロンプト仕様を記憶して答えると 0 点に落ちます(画像認識 vs 事前知識の弁別シグナル)。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → red_cars を整数変換 → 範囲段階で比較。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_count_red_cars_b: {
    purpose: "密集した空撮の駐車場写真から赤い車両の数を正確にカウントできるかを評価します (Gemini 生成画像)。",
    criteria: countCriteriaJa(VISION_SCORING_GROUND_TRUTH.vision_count_red_cars_b.range),
    promptNotes:
      "Gemini は自身の画像を 16/18~22 と自己評価しましたが、人間のカウントと大きく食い違いました — ユーザーによる手動カウントの重要性を実証しています。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → red_cars を整数変換 → 範囲段階で比較。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_chart_peak_a: {
    purpose: "複数ラインのチャートから全体の最高点の製品・四半期・値を抽出できるかを評価します (ChatGPT 生成画像)。",
    criteria: chartCriteriaJa(VISION_SCORING_GROUND_TRUTH.vision_chart_peak_a),
    promptNotes:
      "A 画像には 'Peak Comparison (Q2 2024): Product C: 45.8%, Product A: 45.2%' というコールアウトボックスが直接記載されており、モデルはグラフの推論なしにボックステキストの OCR だけで満点が可能 — 純粋なチャート解釈とテキスト認識が区別されません。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → product/quarter は正規化(trim・大文字化・\`Q2 2024\`/\`Q2'24\`/\`2024 Q2\` を canonicalize)後に exact マッチング、value_percent は parseSignedPercent で number に統一。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_chart_peak_b: {
    purpose: "複数ラインのチャートから全体の最高点の製品・四半期・値を抽出できるかを評価します (Gemini 生成画像)。",
    criteria: chartCriteriaJa(VISION_SCORING_GROUND_TRUTH.vision_chart_peak_b),
    promptNotes:
      "参考: Product A の最高は Q3 2024 / 61.1%(ピーク比較時の混同に注意)。正解 62.4 は Cursor・Gemini の 2 つの独立レビューがいずれも確定。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation:
      `${VISION_JSON_EXTRACT_JA} → product/quarter は正規化(trim・大文字化・\`Q2 2024\`/\`Q2'24\`/\`2024 Q2\` を canonicalize)後に exact マッチング、value_percent は parseSignedPercent で number に統一。rubric 0~3 を score 0~1 にマッピング。`,
  },
  vision_meme_explain_a: {
    purpose: "2 パネルのミームの視覚的対比と風刺意図を韓国語で正確に説明できるかを評価します (ChatGPT 生成画像)。",
    criteria: MEME_CRITERIA_JA,
    promptNotes:
      "A は上下分割、B は左右分割。system: 韓国語・3~5 文・パネルの具体性。user: 風刺・パネル対比のタスクのみ。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation: MEME_IMPLEMENTATION_JA,
  },
  vision_meme_explain_b: {
    purpose: "2 パネルのミームの視覚的対比と風刺意図を韓国語で正確に説明できるかを評価します (Gemini 生成画像)。",
    criteria: MEME_CRITERIA_JA,
    promptNotes:
      "B は横分割(左右)で、A(上下分割)と同じプロンプトを共有します — プロンプトは分割方向を明示しません。system: 韓国語・3~5 文・パネルの具体性。user: 風刺・パネル対比のタスクのみ。",
    toolsSummary: "なし。",
    routes: VISION_ROUTES_JA,
    implementation: MEME_IMPLEMENTATION_JA,
  },
  vision_wireframe_html_a: {
    purpose: "手描きのワイヤーフレーム画像をセマンティック HTML5 + Tailwind で再構成できるかを評価します (ChatGPT 生成画像)。",
    criteria: wireframeCriteriaJa(["Sign Up", "Learn More", "Feature"]),
    promptNotes:
      "A ワイヤーフレーム: Header(Logo+Nav 5 個)、Hero(Sign Up+Learn More)、Features Grid 3 個、Testimonials、Footer 4 列。 " +
      "system: semantic HTML5・Tailwind・```html``` フェンス。user: ワイヤーフレームの再構成・ラベル維持の課題のみ。",
    toolsSummary: "なし。",
    routes: `${VISION_ROUTES_JA} 既定の max_tokens 4096(長い HTML 出力)。`,
    implementation: WIREFRAME_IMPLEMENTATION_JA,
  },
  vision_wireframe_html_b: {
    purpose: "手描きのワイヤーフレーム画像をセマンティック HTML5 + Tailwind で再構成できるかを評価します (Gemini 生成画像)。",
    criteria: wireframeCriteriaJa(["Get Started", "Learn More", "Feature title"]),
    promptNotes:
      "B ワイヤーフレーム: Header(Logo+Nav 4 個)、Hero(Get Started + Hero Image/Video)、Features Grid 3 個、Testimonials 2 個、Footer 3 列。 " +
      "system: semantic HTML5・Tailwind・```html``` フェンス。user: ワイヤーフレームの再構成・ラベル維持の課題のみ。",
    toolsSummary: "なし。",
    routes: `${VISION_ROUTES_JA} 既定の max_tokens 4096(長い HTML 出力)。`,
    implementation: WIREFRAME_IMPLEMENTATION_JA,
  },
  translate_nist_fips197_pdf_tools: {
    purpose: "ツール呼び出しで NIST FIPS 197 の PDF テキストを読み、韓国語の要約を生成するかを見ます。",
    criteria:
      "fetch_pdf_text ツールが実際に呼び出され、思考ブロックを除いた最終応答にハングルが含まれ、その長さが 1000 文字未満であれば合格です。",
    promptNotes:
      "system: PDF は `fetch_pdf_text` 必須・韓国語 1000 文字上限・引用禁止。user: NIST FIPS 197 の PDF URL + 韓国語要約のタスクのみ。",
    toolsSummary:
      "`fetch_url`: UTF-8 テキスト(非 PDF)。`fetch_pdf_text`: PDF から抽出した平文(切り詰めあり)。ベンチランナーがツール実行器を接続し、実際の GET/PDF パースを実行します。",
    routes: "ツールを含む chat / messages。",
    implementation:
      "ツール呼び出しログと最終アシスタントテキストを合わせて、fetch_pdf_text の呼び出し存在・ハングルの包含・長さ上限の充足を確認します。",
  },
  stress_ping: {
    purpose: "プロバイダーベンチ専用: 同時ユーザー負荷測定用の最小 ping ワークロード。",
    criteria: "応答が空でなければ合格。TPS・レイテンシの比較に使用します。",
    promptNotes: "既定の max_tokens 32。同時ワーカーごとに `ping (client {k})` の変形が可能。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチでは単一ルート(chat_completions 優先)でのみ測定。",
    implementation: "プロバイダーベンチの ramp-up ステージごとにワーカーがリクエストを繰り返し送信。モデルベンチのタブには表示されません。",
  },
  stress_short_reply: {
    purpose: "プロバイダーベンチ専用: 英語 1 文の応答を同時ユーザー負荷で比較。",
    criteria: "応答が空でなければ合格。トークン生成負荷をもう少し引き出す変形。",
    promptNotes: "既定の max_tokens 128。同時ワーカーごとに `(client {k})` の変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート。",
    implementation: "プロバイダーベンチの ramp-up ステージごとにリクエストを繰り返し送信。モデルベンチのタブには非表示。",
  },
  stress_short_reply_ko: {
    purpose: "プロバイダーベンチ専用: 韓国語 1 文の応答負荷 — 多言語処理の比較用。",
    criteria: "応答が空でなければ合格。`script_match` ラベルで実際の韓国語応答の比率を確認。",
    promptNotes: "system/user ともに韓国語。既定の max_tokens 128。`(클라이언트 {k})` の変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート。",
    implementation: "CJK トークン化の効率差により、英語ワークロードに比べ TPS が変わり得る。モデルベンチのタブには非表示。",
  },
  stress_short_reply_ja: {
    purpose: "プロバイダーベンチ専用: 日本語 1 文の応答負荷 — 多言語処理の比較用。",
    criteria: "応答が空でなければ合格。`script_match` ラベルで実際の日本語(ひらがな/カタカナ)応答の比率を確認。",
    promptNotes: "system/user ともに日本語。既定の max_tokens 128。`(クライアント {k})` の変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート。",
    implementation: "ひらがな・カタカナの比率で *想定外の応答* を識別。採点には影響なし。モデルベンチのタブには非表示。",
  },
  stress_long_context: {
    purpose: "プロバイダーベンチ専用: 長いコンテキスト(~2500 tok)で prefill・KV キャッシュ・メモリ帯域幅の限界を測定(英語)。",
    criteria: "応答が空でなければ合格。第 1 指標は TTFT(p50/p95) — 同時実行の増加に伴う急増ポイントを観察。",
    promptNotes: "system: 一文要約の指示。user: 約 2500 トークンの英語百科テキスト + 末尾に要約指示。既定の max_tokens 32。`(client {k})` のワーカー変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート(chat_completions 優先)。",
    implementation:
      "推奨 temperature 0、timeout ≥ 120s。Prefix caching を持つエンジン(vLLM PagedAttention など)は共通 prefix をキャッシュして prefill を amortize できる — workerPromptSuffix off または caching 非対応エンジンでの測定を推奨。モデルベンチのタブには非表示。",
  },
  stress_long_context_ko: {
    purpose: "プロバイダーベンチ専用: 長いコンテキスト(~2500 tok)で prefill・KV キャッシュ・メモリ帯域幅の限界を測定(韓国語)。",
    criteria: "応答が空でなければ合格。`script_match` で韓国語応答の比率を確認。第 1 指標は TTFT(p50/p95)。",
    promptNotes: "system/user ともに韓国語の百科テキスト(~2500 tok) + 末尾に要約指示。既定の max_tokens 32。`(클라이언트 {k})` のワーカー変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート。",
    implementation:
      "推奨 temperature 0、timeout ≥ 120s。CJK トークン化の効率差により、英語ワークロードに比べ TTFT/TPS が変わり得る。Prefix caching エンジンは共通 prefix を amortize できるため負荷を過小に測定する可能性 — workerPromptSuffix off または caching 非対応エンジンを推奨。モデルベンチのタブには非表示。",
  },
  stress_long_context_ja: {
    purpose: "プロバイダーベンチ専用: 長いコンテキスト(~2500 tok)で prefill・KV キャッシュ・メモリ帯域幅の限界を測定(日本語)。",
    criteria: "応答が空でなければ合格。`script_match` で日本語(ひらがな/カタカナ)応答の比率を確認。第 1 指標は TTFT(p50/p95)。",
    promptNotes: "system/user ともに日本語の百科テキスト(~2500 tok) + 末尾に要約指示。既定の max_tokens 32。`(クライアント {k})` のワーカー変形。",
    toolsSummary: "なし。",
    routes: "プロバイダーベンチの単一ルート。",
    implementation:
      "推奨 temperature 0、timeout ≥ 120s。CJK トークン化により英語に比べ TTFT/TPS が変動し得る。Prefix caching エンジンは共通 prefix を amortize 可能 — workerPromptSuffix off または caching 非対応エンジンを推奨。モデルベンチのタブには非表示。",
  },
};

/**
 * 멀티턴 에이전트 시나리오(`agent_*`) 메타. `META`(Record<ScenarioId>)는 닫힌 유니온이라
 * 별도 맵으로 둔다 — id는 레지스트리(빌트인)에서 오며 ScenarioId 유니온에 없다.
 */
export const AGENT_META_JA: Record<string, ScenarioBenchMetaText> = {
  agent_loop_mock_v1: {
    purpose:
      "マルチターンエージェントの基本: read_document → wiki_search → wiki_read の後に最終 JSON カードを出力する " +
      "research-then-answer ループ。単発では捉えられない空ターンのストール・中間ターンの思考リークをターンをまたいで露呈させる。",
    criteria:
      "完了判定 = ツール呼び出しを止めたターン(no_tool_calls)。最終カードは #105 の決定論的採点器が rubric 0-3 で " +
      "採点する(LLM judge 不要): スキーマ + AES マーカー ≥2 + sources が文書を参照すれば 3。ストール/バジェット枯渇は 0。 " +
      "指標: 完了率・turns・有効ツール呼び出し率・中間ターンのリーク。",
    toolsSummary: "read_document / wiki_search / wiki_read (すべて mock)。maxTurns 6。",
    routes: "chat_completions(OpenAI 互換) / messages(Anthropic) 共通。",
  },
  agent_loop_budget_v1: {
    purpose:
      "ハードバジェットの変種: agent_loop_mock_v1 と同一スクリプトだが per-turn max_tokens を 192 に絞り、 " +
      "思考を reasoning_content に過剰に流すモデルが予算を使い切って空ターン(finish_reason=length)で " +
      "ストールするかを再現する。",
    criteria:
      "節度あるモデルは予算内で完走(completed)、過剰思考モデルは stall + thinking_exhausted_budget。 " +
      "192 は実測で確定した 2 つのモデルを分ける予算。決定論的採点(0-3)は **完走可否のみを見る** — " +
      "カードのスキーマを満たして完走すれば 3、スキーマ未完なら 1、ストール・バジェット枯渇・パース失敗なら 0。 " +
      "内容マーカー・sources 引用は見ない: 同じスクリプトを使う mock_v1 が既に測っているため、 " +
      "ここで再び測ると同じ減点がシナリオ 2 個 × ルート 2 個 = 4 回計上され、総合スコアが歪む。",
    toolsSummary: "read_document / wiki_search / wiki_read (すべて mock)。maxTurns 6、max_tokens 192。",
    routes: "chat_completions / messages 共通。",
  },
  agent_loop_docs_v1: {
    purpose:
      "マルチ文書ダイジェスト: list_documents で文書 3 個を受け取り read_document(id)(argDispatch)でそれぞれ読み、 " +
      "各文書の核心的事実を正しい id に帰属させた 1 つの JSON レポートを出力する。タスクのスループット・コンテキスト維持・グラウンディングを測定。",
    criteria:
      "決定論的採点(0-3): 3 文書の事実が正しい id に帰属(交差汚染なし)し、read_document を 3 件すべて読めば 3、 " +
      "帰属 2/3 または読みが不足なら 2、それ以下は 1。read_document を一切呼ばなければ rubric 1 でキャップ(グラウンディングなし)。 " +
      "最も長いタスクのため、完了タスクあたりのウォールクロック(task_ms)の支配項。 " +
      "※ この文書 corpus は架空(fictional)である — 公開 canon なら、ツールなしで想起だけで満点が出てしまいグラウンディングを測れない。",
    toolsSummary: "list_documents / read_document(argDispatch: id→本文) (すべて mock)。maxTurns 8、max_tokens 512。",
    routes: "chat_completions / messages 共通。",
  },
  agent_loop_error_v1: {
    purpose:
      "エラー復旧: read_document の初回呼び出しが retryable エラーを返し、2 回目以降は正常な本文。一時的なツールエラーから " +
      "リトライで回復できるかを見る — 脆弱なモデルはストールするか、エラーペイロードを要約する。 " +
      "エラーを『答えを得るには必ず呼ぶ最初のツール』に置いた理由: ワークフローをショートカットしたモデルがエラーに遭遇すらできず " +
      "シナリオが何も測定できなくなる事態を防ぐためだ(ショートカットそのものは減点しない)。",
    criteria:
      "決定論的採点(0-3): リトライを **実測** で判定する — tool_call_counts.read_document ≥2 でなければ本物のリトライではない。 " +
      "有効なカード + マーカー ≥2 + 実測リトライ + retried=true の一致なら 3;リトライしたがフラグ欠落、または " +
      "フラグだけ立てて実際は 1 回なら 2(自己申告の虚偽);エラーペイロードの要約・スキーマ欠損・ツール未呼び出しは 1。",
    toolsSummary: "read_document(シーケンス mock: 1 回目エラー→2 回目本文) / wiki_search / wiki_read。maxTurns 8、max_tokens 512。",
    routes: "chat_completions / messages 共通。",
  },
  agent_loop_grounding_v1: {
    purpose:
      "グラウンディング(引数の忠実度): catalog_search が UUID 型の record id を 2 個与え、catalog_read(id)(argDispatch)は id が " +
      "正確に一致したときのみ本文を返す。不透明な id を正確にコピーできるか — 切り詰めたり捏造したりすると fallback エラー。",
    criteria:
      "第 1 シグナルは tool_arg_fidelity(+ 試行率)。決定論的採点(0-3): 2 つの record の id 完全一致 + 各レコード固有の事実 + " +
      "catalog_read を 2 件とも呼び出せば 3、id は正しいが事実が不足なら 2、id 1/2 または未呼び出しなら 1、id がすべて幻覚なら 0。 " +
      "予算に余裕(512)があり予算圧迫と分離、グラウンディングのみを測定。 " +
      "※ レコード corpus は架空で、catalog_search の title も答えを漏らさないよう無意味なトークンである。",
    toolsSummary: "catalog_search / catalog_read(argDispatch: 正確な id 一致) (すべて mock)。maxTurns 8、max_tokens 512。",
    routes: "chat_completions / messages 共通。",
  },
  agent_loop_chain_v1: {
    purpose:
      "妨害候補 + 棄権: 検索を 2 回回し、それぞれ候補のうち status=\"active\" のものだけを追い、 " +
      "active がない検索(2 回目)は棄権しなければならない。核心は **誤った候補を選んでも resolve/fetch が " +
      "もっともらしい本文とともに成功を返す** こと — 他のシナリオのように fallback エラーが誤答を " +
      "即座に知らせてはくれない。初版(3 ホップの純粋なチェイニング)はホップごとに選択肢が 1 個だけで、タスクが " +
      "\"直前のツール出力を書き写すだけ\" に縮小し、実測では完走したランがすべて最小ターン数・満点となり " +
      "かえって弁別力を薄めた。そこでスイート初の **間違え得る選択肢** を入れた。",
    criteria:
      "決定論的採点(0-3): 正解した項目数のはしご — 2/2 なら 3、1/2 なら 2、0/2(スキーマは有効)なら 1、 " +
      "ストール・バジェット枯渇・JSON パース失敗は 0。項目 1 は active レコードの id 完全一致 + fact にそのレコード固有のマーカー、 " +
      "項目 2 は abstained=true でなければ正解にならず、superseded レコードで答えを捏造すると誤答だ。 " +
      "理由は select=<判定> abstain=<判定> の形式なので、誤答の種類(hallucinated/wrong/abstained)がそのまま集計される。 " +
      "corpus は架空(fictional)のため想起は不可能。",
    toolsSummary:
      "search(シーケンス: 1 回目候補 3 個・2 回目候補 2 個) / resolve(argDispatch: ref — superseded も成功) / " +
      "fetch(argDispatch: record_id — 誤答レコードも本文を返す) (すべて mock)。maxTurns 8、max_tokens 512。",
    routes: "chat_completions / messages 共通。",
  },
};
