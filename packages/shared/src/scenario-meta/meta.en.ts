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

const VISION_ROUTES_EN =
  "Vision-capable models only: OpenAI Chat Completions (image_url) / Anthropic Messages (image source). " +
  "loopback / private-network (RFC1918) origins are auto-inlined as base64; public origins use the URL.";

const VISION_JSON_EXTRACT_EN =
  "The server extracts the JSON object from the response, preferring a fenced ```json``` block → then the last balanced `{...}` → then the first balanced `{...}`";

const fmtCues = (cues: readonly string[]): string => cues.map((c) => `\`${c}\``).join(", ");

const JUDGE_OPS_EN =
  "(c) How to enable: set both env vars `LLM_JUDGE_ENABLED=1` and `ANTHROPIC_API_KEY`. " +
  `Default judge model \`${DEFAULT_LLM_JUDGE_MODEL}\` (overridable via \`LLM_JUDGE_MODEL\`). ` +
  `Call spec: temperature 0, timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s, ${LLM_JUDGE_MAX_RETRIES} retries.\n`;

const MEME_PREFILTER_EN =
  "(b) Server prefilter (all four must pass to proceed to the judge):\n" +
  "  ① contains Hangul\n" +
  `  ② server / datacenter cues (${fmtCues(MEME_PREFILTER_CUES.server)})\n` +
  `  ③ donkey / cart cues (${fmtCues(MEME_PREFILTER_CUES.donkey)})\n` +
  `  ④ contrast / expectation / reality cues (${fmtCues(MEME_PREFILTER_CUES.contrast)})\n`;

/** (e) Judge 실패 공통 문구 — wireframe은 `extra`로 `upstream_no_vision` 라벨 추가. */
const judgeFailEn = (extra = ""): string =>
  `(e) Judge failure (timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s / parse error / 5xx / missing API key): ` +
  `rubric 0 + a ${JUDGE_FAILURE_LABELS.map((l) => `\`${l}\``).join(" / ")} label in reason.` +
  `${extra} pass = score ≥ 0.67 (rubric ≥ 2).`;

const PASS_CUT_EN = "pass = score ≥ 0.67 (rubric ≥ 2).";

const ocrCriteriaEn = (
  row: string,
  gt: { net_income_2024: number; net_income_yoy_percent: number },
  yoyPrefix = "",
): string =>
  `Ground truth: the '${row}' row's 2024 Actual = ${gt.net_income_2024}, YoY = ${yoyPrefix}${gt.net_income_yoy_percent}%. ` +
  "Scoring: output JSON `{net_income_2024, net_income_yoy_percent}`. " +
  `Both keys passing (value within ${OCR_VALUE_REL_TOL * 100}% relative error / YoY within ${OCR_YOY_ABS_TOL}%p absolute error) → rubric 3, ` +
  `one key only → 2, both outside tolerance but parseable → 1, JSON parse failure / missing key / refusal → 0. ${PASS_CUT_EN}`;

const countCriteriaEn = (range: readonly [number, number]): string =>
  `Ground-truth range: ${range[0]}~${range[1]} cars (counted by hand). ` +
  "Scoring: output JSON `{red_cars: <integer>}`. " +
  `Within range → rubric 3, ±${COUNT_RED_CARS_TOL_NEAR} → 2, ±${COUNT_RED_CARS_TOL_FAR} → 1, ` +
  `otherwise / \`red_cars = 0\` / hallucination ≥ ${COUNT_RED_CARS_MAX_PLAUSIBLE} / missing JSON key / refusal → 0. ${PASS_CUT_EN}`;

const chartCriteriaEn = (gt: { product: string; quarter: string; value_percent: number }): string =>
  `Ground truth: product = "${gt.product}", quarter = "${gt.quarter}", value_percent = ${gt.value_percent}. ` +
  "Scoring: output JSON `{product, quarter, value_percent}`. " +
  "All three conditions passing → rubric 3, two → 2, one → 1, all failing / JSON parse failure / missing key → 0. " +
  `value_percent tolerance ±${CHART_VALUE_ABS_TOL}%p. ${PASS_CUT_EN}`;

const MEME_CRITERIA_EN =
  "One-line summary: no fixed ground-truth text (subjective scoring) · LLM-as-Judge required · with judge disabled, max rubric 1 (score 0.33, pass=false).\n\n" +
  "(a) Why a judge is needed: the response is free-form Korean prose, so deterministic scoring is impossible; interpreting the satirical intent is delegated to an external model.\n" +
  MEME_PREFILTER_EN +
  JUDGE_OPS_EN +
  "(d) Rubric when the judge is enabled:\n" +
  "  • 3 = both panels' text quoted + visual description (server rack vs donkey cart) + \"LLM cloud promise vs local PC reality\" satirical intent all correct.\n" +
  "  • 2 = OCR / visuals correct but the technical context (LLM/PC connection) is weak.\n" +
  "  • 1 = describes only, without explaining 'why it's funny'.\n" +
  "  • 0 = OCR failure / irrelevant explanation.\n" +
  judgeFailEn();

/** wireframe criteriaEn — A/B는 ③ 필수 단서 줄(표시용 케이스)만 다르다. */
const wireframeCriteriaEn = (displayCues: readonly string[]): string =>
  "One-line summary: no fixed ground-truth HTML (structure-match scoring) · LLM-as-Judge required · with judge disabled, max rubric 1 (score 0.33, pass=false).\n\n" +
  "(a) Why a judge is needed: the HTML text varies widely, so deterministic comparison is impossible; the judge visually compares layout and element reproduction.\n" +
  "(b) Server prefilter (all must pass case-insensitively to proceed to the judge):\n" +
  "  ① a ```html``` fence or a plain ``` code fence is present\n" +
  `  ② at least ${WIREFRAME_MIN_SEMANTIC_TAGS} of the semantic tags (${WIREFRAME_SEMANTIC_TAGS.map((t) => `${t}>`).join("·")})\n` +
  `  ③ contains all required cues ${fmtCues(displayCues)}\n` +
  JUDGE_OPS_EN +
  "(d) Rubric when the judge is enabled:\n" +
  "  • 3 = uses grid/flex, every labeled section in the correct vertical order, all labeled elements (buttons · nav · form fields) reproduced.\n" +
  "  • 2 = layout mostly correct but alignment off or 1–2 minor omissions.\n" +
  "  • 1 = collapses to a single column OR key buttons · nav missing.\n" +
  "  • 0 = refuses to generate code / irrelevant code.\n" +
  judgeFailEn(" Vision-unsupported models returning 400 get a separate `upstream_no_vision` label.");

const MEME_IMPLEMENTATION_EN =
  "scoreScenario only produces the prefilter + a provisional rubric 1 (internal `judge_pending` flag). " +
  `When the judge is enabled and the prefilter passes, bench-runner calls the judge model (default \`${DEFAULT_LLM_JUDGE_MODEL}\`) and overwrites with a 0–3 rubric. ` +
  "Judge failure is rubric 0. The `judge_pending` flag is stripped from SSE/DB just before emit.";

const WIREFRAME_IMPLEMENTATION_EN =
  "scoreScenario: fence extraction + substring matching (prefilter, case-insensitive) + provisional rubric 1 (`judge_pending` flag). " +
  `When the judge is enabled and the prefilter passes, bench-runner calls the judge model (default \`${DEFAULT_LLM_JUDGE_MODEL}\`) and overwrites with a 0–3 rubric. ` +
  "Judge failure is rubric 0.";


export const META_EN: Record<ScenarioId, ScenarioBenchMetaText> = {
  chat_hello: {
    purpose: "Checks response latency and connectivity for a short request.",
    criteria: "Does not evaluate response body quality. A whitespace-only empty response fails; anything else passes.",
    promptNotes: "A fixed short greeting/text request. No tools.",
    toolsSummary: "None.",
    routes: "If the provider supports it, measured once on each of OpenAI Chat Completions and Anthropic Messages with the same user text.",
    implementation: "Only stream completion and latency matter; the body just needs to be non-empty.",
  },
  chat_ping: {
    purpose: "Checks response latency and connectivity for an additional short request.",
    criteria: "Does not evaluate response body quality. A whitespace-only empty response fails; anything else passes.",
    promptNotes: "A short ping-style request that comes after hello.",
    toolsSummary: "None.",
    routes: "If the provider supports it, measured once on each of OpenAI Chat Completions and Anthropic Messages with the same user text.",
    implementation: "The second lightweight round-trip in the scenario order of the bench loop.",
  },
  code_sort_js: {
    purpose: "Checks whether the model follows the fenced code block and quicksort implementation when instructed to output code only.",
    criteria:
      "After removing thinking blocks, if a ```js … ``` fence exists the code inside it is scored, otherwise the whole body. " +
      "Passes if sortNums (or equivalent) and quicksort cues (partition · pivot · quicksort, etc.) are present and `.sort(` is absent.",
    promptNotes:
      "system: ```js``` fence · no prose · built-in sort forbidden. user: only the sortNums quicksort implementation task (format instructions live in system only).",
    toolsSummary: "None.",
    routes: "Plain-text completion style; measured separately per supported route.",
    implementation:
      "After removing thinking blocks, extracts the ```js``` fence first, falls back to the whole body if there is no fence, then checks the forbidden API and quicksort keywords.",
  },
  code_sort_py: {
    purpose: "Checks format and quicksort implementation when the model must output Python code only as a fenced block.",
    criteria:
      "After removing thinking blocks, if a ```python … ``` fence exists the code inside it is scored, otherwise the whole body. " +
      "Passes if def sort_nums and quicksort cues (partition · pivot · quicksort, etc.) are present and `sorted(` / `.sort(` are absent.",
    promptNotes:
      "system: ```python``` fence · no prose · built-in sort forbidden. user: only the def sort_nums quicksort implementation task (format instructions live in system only).",
    toolsSummary: "None.",
    routes: "Plain-text completion style; measured separately per supported route.",
    implementation:
      "After removing thinking blocks, extracts the ```python``` fence first, falls back to the whole body if there is no fence, then scores by the function name and the built-in-sort ban rules.",
  },
  chat_time_calendar: {
    purpose: "Checks whether the model correctly states yesterday's / today's / tomorrow's dates based on the reference time injected into the prompt.",
    criteria:
      `Passes if all three YYYY-MM-DD values — yesterday, today, and tomorrow on the calendar the bench runner fixes to \`${DEFAULT_CALENDAR_TIMEZONE}\` — appear in the output.`,
    promptNotes:
      `The bench runner injects directly into the prompt the date (YYYY-MM-DD) obtained by converting \`referenceAt\` — fixed at UTC T06:00 — to \`${DEFAULT_CALENDAR_TIMEZONE}\`. The model only needs to do ±1-day arithmetic, with no timezone conversion.`,
    toolsSummary: "None.",
    routes: "Plain chat message; measured on each route when both are supported.",
    implementation: "The server computes the three expected dates from the same reference time and decides by substring inclusion.",
  },
  tool_weather: {
    purpose: "Checks whether the model calls the provided get_weather tool for a weather question.",
    criteria:
      "Tool calls the server collects from the stream are serialized at the end of the output as `{\"tool_calls\":[{\"function\":{\"name\":\"get_weather\",…}}]}` JSON. " +
      "Passes if the call is confirmed via this serialization pattern (`\"name\":\"get_weather\"`) or by parsing the JSON `tool_calls` — merely mentioning the word `get_weather` as plain text in the body fails.",
    promptNotes: "A single-turn user message asking about a city's weather.",
    toolsSummary:
      "OpenAI format: `get_weather(city: string)`. Anthropic format: same name and input_schema. No actual HTTP weather API is called — only whether the call is made is checked.",
    routes: "chat / messages requests with the tool schema attached.",
    implementation:
      "Checks the completed output string with a `\"name\":\"get_weather\"` pattern regex and by parsing JSON `tool_calls[].function.name` at whole-string / per-line granularity. A plain-text word mention is not a pass signal.",
  },
  structured_action: {
    purpose: "Checks schema compliance when the model must output only one valid JSON object with no prose.",
    criteria: 'Passes if JSON of the form {"action":"<string>","confidence":<number 0-1>} parses and validates.',
    promptNotes:
      "system: JSON schema and format (no prose, no fence). user: the task of reviewing the quarterly report and then choosing submit/revise/hold.",
    toolsSummary: "None.",
    routes: "Attempts to parse the plain-text response as JSON.",
    implementation:
      `${VISION_JSON_EXTRACT_EN}, then runs \`JSON.parse\` and validates the schema (action string, confidence a number in 0-1). Same extraction path as the vision scenarios.`,
  },
  vision_table_ocr_a: {
    purpose: "Evaluates whether the model accurately extracts the 2024 Actual value and YoY change of the 'Net Income' row from a complex financial-table image (ChatGPT-generated image).",
    criteria: ocrCriteriaEn("Net Income", VISION_SCORING_GROUND_TRUTH.vision_table_ocr_a),
    promptNotes:
      "The image contains two separate rows, 'Net Income' and 'Net Income Attributable to Shareholders' — the prompt requires the exact 'Net Income' row (case-insensitive matching allowed).",
    toolsSummary: "None. One image is included in the user message as an image_url (or base64) part.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → normalize both keys to number (strip commas · $ · %) → tolerance check. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_table_ocr_b: {
    purpose: "Evaluates whether the model accurately extracts the 2024 Actual value and YoY change of the 'NET INCOME' row from a complex financial-table image (Gemini-generated image).",
    criteria: ocrCriteriaEn("NET INCOME", VISION_SCORING_GROUND_TRUTH.vision_table_ocr_b, "+"),
    promptNotes:
      "The B image is an AI-generated artifact where several rows (COGS, R&D, OPERATING INCOME, etc.) share the same numbers (410.55/+20.7%). v1 scoring looks only at the numbers, so it cannot distinguish *row-identification failure* from *correct identification*.",
    toolsSummary: "None. One image is included in the user message as an image_url (or base64) part.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → normalize both keys to number (strip commas · $ · %) → tolerance check. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_count_red_cars_a: {
    purpose: "Evaluates whether the model accurately counts the number of red cars in a dense aerial parking-lot photo (ChatGPT-generated image).",
    criteria: countCriteriaEn(VISION_SCORING_GROUND_TRUTH.vision_count_red_cars_a.range),
    promptNotes:
      "The hand-counted range is the ground truth. The generation prompt asked for 'roughly 15-20 cars', but both images actually have 30+ — if a model answers from memory of the prompt spec, it drops to 0 (an image-recognition vs. prior-knowledge discriminating signal).",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → convert red_cars to integer → stepwise range comparison. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_count_red_cars_b: {
    purpose: "Evaluates whether the model accurately counts the number of red cars in a dense aerial parking-lot photo (Gemini-generated image).",
    criteria: countCriteriaEn(VISION_SCORING_GROUND_TRUTH.vision_count_red_cars_b.range),
    promptNotes:
      "Gemini self-assessed its own image as 16 / 18-22, but this diverges greatly from the human count — demonstrating the importance of manual counting by the user.",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → convert red_cars to integer → stepwise range comparison. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_chart_peak_a: {
    purpose: "Evaluates whether the model extracts the product, quarter, and value of the overall peak in a multi-line chart (ChatGPT-generated image).",
    criteria: chartCriteriaEn(VISION_SCORING_GROUND_TRUTH.vision_chart_peak_a),
    promptNotes:
      "The A image literally has a 'Peak Comparison (Q2 2024): Product C: 45.8%, Product A: 45.2%' callout box, so a model can get full marks by OCR of the box text alone without any graph reasoning — pure chart interpretation is not separated from text recognition.",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → product/quarter are normalized (trim · uppercase · canonicalize \`Q2 2024\`/\`Q2'24\`/\`2024 Q2\`) then exact-matched, value_percent is unified to number via parseSignedPercent. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_chart_peak_b: {
    purpose: "Evaluates whether the model extracts the product, quarter, and value of the overall peak in a multi-line chart (Gemini-generated image).",
    criteria: chartCriteriaEn(VISION_SCORING_GROUND_TRUTH.vision_chart_peak_b),
    promptNotes:
      "Note: Product A's peak is Q3 2024 / 61.1% (watch for confusion during peak comparison). The ground truth 62.4 was confirmed by two independent reviews, Cursor and Gemini.",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation:
      `${VISION_JSON_EXTRACT_EN} → product/quarter are normalized (trim · uppercase · canonicalize \`Q2 2024\`/\`Q2'24\`/\`2024 Q2\`) then exact-matched, value_percent is unified to number via parseSignedPercent. Rubric 0–3 mapped to score 0–1.`,
  },
  vision_meme_explain_a: {
    purpose: "Evaluates whether the model accurately explains, in Korean, the visual contrast and satirical intent of a two-panel meme (ChatGPT-generated image).",
    criteria: MEME_CRITERIA_EN,
    promptNotes:
      "A is split top/bottom, B is split left/right. system: Korean · 3–5 sentences · panel specificity. user: only the satire / panel-contrast task.",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation: MEME_IMPLEMENTATION_EN,
  },
  vision_meme_explain_b: {
    purpose: "Evaluates whether the model accurately explains, in Korean, the visual contrast and satirical intent of a two-panel meme (Gemini-generated image).",
    criteria: MEME_CRITERIA_EN,
    promptNotes:
      "B is split side-by-side (left/right) and shares the same prompt as A (split top/bottom) — the prompt does not specify the split direction. system: Korean · 3–5 sentences · panel specificity. user: only the satire / panel-contrast task.",
    toolsSummary: "None.",
    routes: VISION_ROUTES_EN,
    implementation: MEME_IMPLEMENTATION_EN,
  },
  vision_wireframe_html_a: {
    purpose: "Evaluates whether the model reconstructs a hand-drawn wireframe image into semantic HTML5 + Tailwind (ChatGPT-generated image).",
    criteria: wireframeCriteriaEn(["Sign Up", "Learn More", "Feature"]),
    promptNotes:
      "A wireframe: Header (Logo + 5 Nav items), Hero (Sign Up + Learn More), Features Grid of 3, Testimonials, Footer of 4 columns. " +
      "system: semantic HTML5 · Tailwind · ```html``` fence. user: only the wireframe-reconstruction / label-preservation task.",
    toolsSummary: "None.",
    routes: `${VISION_ROUTES_EN} Default max_tokens 4096 (long HTML output).`,
    implementation: WIREFRAME_IMPLEMENTATION_EN,
  },
  vision_wireframe_html_b: {
    purpose: "Evaluates whether the model reconstructs a hand-drawn wireframe image into semantic HTML5 + Tailwind (Gemini-generated image).",
    criteria: wireframeCriteriaEn(["Get Started", "Learn More", "Feature title"]),
    promptNotes:
      "B wireframe: Header (Logo + 4 Nav items), Hero (Get Started + Hero Image/Video), Features Grid of 3, 2 Testimonials, Footer of 3 columns. " +
      "system: semantic HTML5 · Tailwind · ```html``` fence. user: only the wireframe-reconstruction / label-preservation task.",
    toolsSummary: "None.",
    routes: `${VISION_ROUTES_EN} Default max_tokens 4096 (long HTML output).`,
    implementation: WIREFRAME_IMPLEMENTATION_EN,
  },
  translate_nist_fips197_pdf_tools: {
    purpose: "Checks whether the model reads NIST FIPS 197 PDF text via a tool call and generates a Korean summary.",
    criteria:
      "Passes if the fetch_pdf_text tool is actually called, the final response (excluding thinking blocks) contains Hangul, and its length is under 1000 characters.",
    promptNotes:
      "system: for PDFs `fetch_pdf_text` is required · 1000-character Korean cap · no quoting. user: only the NIST FIPS 197 PDF URL + Korean-summary task.",
    toolsSummary:
      "`fetch_url`: UTF-8 text (non-PDF). `fetch_pdf_text`: plain text extracted from a PDF (truncated). The bench runner attaches a tool executor and performs the actual GET / PDF parsing.",
    routes: "chat / messages with tools included.",
    implementation:
      "Combines the tool-call log and the final assistant text to verify: a fetch_pdf_text call exists, Hangul is present, and the length cap is satisfied.",
  },
  stress_ping: {
    purpose: "Provider bench only: a minimal ping workload for measuring concurrent-user load.",
    criteria: "Passes if the response is non-empty. Used for TPS / latency comparison.",
    promptNotes: "Default max_tokens 32. Can vary per concurrent worker as `ping (client {k})`.",
    toolsSummary: "None.",
    routes: "Measured only on a single route (chat_completions preferred) in the provider bench.",
    implementation: "Workers fire repeatedly at each ramp-up stage of the provider bench. Not exposed in the model bench tab.",
  },
  stress_short_reply: {
    purpose: "Provider bench only: compares a one-sentence English response under concurrent-user load.",
    criteria: "Passes if the response is non-empty. A variant that draws out a bit more token-generation load.",
    promptNotes: "Default max_tokens 128. Varies per concurrent worker as `(client {k})`.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench.",
    implementation: "Fired repeatedly at each ramp-up stage of the provider bench. Not exposed in the model bench tab.",
  },
  stress_short_reply_ko: {
    purpose: "Provider bench only: one-sentence Korean response load — for comparing multilingual handling.",
    criteria: "Passes if the response is non-empty. The `script_match` label checks the proportion of actually-Korean responses.",
    promptNotes: "Both system and user are Korean. Default max_tokens 128. `(클라이언트 {k})` variant.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench.",
    implementation: "TPS may differ from the English workload due to CJK tokenization-efficiency differences. Not exposed in the model bench tab.",
  },
  stress_short_reply_ja: {
    purpose: "Provider bench only: one-sentence Japanese response load — for comparing multilingual handling.",
    criteria: "Passes if the response is non-empty. The `script_match` label checks the proportion of actually-Japanese (Hiragana/Katakana) responses.",
    promptNotes: "Both system and user are Japanese. Default max_tokens 128. `(クライアント {k})` variant.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench.",
    implementation: "The Hiragana / Katakana ratio identifies *unexpected responses*. No effect on scoring. Not exposed in the model bench tab.",
  },
  stress_long_context: {
    purpose: "Provider bench only: measures prefill / KV cache / memory-bandwidth limits with a long context (~2500 tok) (English).",
    criteria: "Passes if the response is non-empty. The primary metric is TTFT (p50/p95) — observe the blow-up point as concurrency increases.",
    promptNotes: "system: instruction to summarize in one sentence. user: ~2500-token English encyclopedic text + a summarize instruction at the end. Default max_tokens 32. `(client {k})` worker variant.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench (chat_completions preferred).",
    implementation:
      "Recommended temperature 0, timeout ≥ 120s. Engines with prefix caching (vLLM PagedAttention, etc.) can cache the shared prefix and amortize prefill — measuring with workerPromptSuffix off or on a caching-unsupported engine is recommended. Not exposed in the model bench tab.",
  },
  stress_long_context_ko: {
    purpose: "Provider bench only: measures prefill / KV cache / memory-bandwidth limits with a long context (~2500 tok) (Korean).",
    criteria: "Passes if the response is non-empty. `script_match` checks the Korean-response proportion. The primary metric is TTFT (p50/p95).",
    promptNotes: "Both system and user are Korean encyclopedic text (~2500 tok) + a summarize instruction at the end. Default max_tokens 32. `(클라이언트 {k})` worker variant.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench.",
    implementation:
      "Recommended temperature 0, timeout ≥ 120s. TTFT/TPS may differ from the English workload due to CJK tokenization-efficiency differences. Prefix-caching engines can amortize the shared prefix, potentially under-measuring load — workerPromptSuffix off or a caching-unsupported engine is recommended. Not exposed in the model bench tab.",
  },
  stress_long_context_ja: {
    purpose: "Provider bench only: measures prefill / KV cache / memory-bandwidth limits with a long context (~2500 tok) (Japanese).",
    criteria: "Passes if the response is non-empty. `script_match` checks the Japanese (Hiragana/Katakana) response proportion. The primary metric is TTFT (p50/p95).",
    promptNotes: "Both system and user are Japanese encyclopedic text (~2500 tok) + a summarize instruction at the end. Default max_tokens 32. `(クライアント {k})` worker variant.",
    toolsSummary: "None.",
    routes: "Single route in the provider bench.",
    implementation:
      "Recommended temperature 0, timeout ≥ 120s. TTFT/TPS may vary vs. English due to CJK tokenization. Prefix-caching engines can amortize the shared prefix — workerPromptSuffix off or a caching-unsupported engine is recommended. Not exposed in the model bench tab.",
  },
};

/**
 * 멀티턴 에이전트 시나리오(`agent_*`) 메타. `META`(Record<ScenarioId>)는 닫힌 유니온이라
 * 별도 맵으로 둔다 — id는 레지스트리(빌트인)에서 오며 ScenarioId 유니온에 없다.
 */
export const AGENT_META_EN: Record<string, ScenarioBenchMetaText> = {
  agent_loop_mock_v1: {
    purpose:
      "Multi-turn agent fundamentals: a research-then-answer loop that runs read_document → wiki_search → wiki_read " +
      "and then emits a final JSON card. Surfaces, across turns, the empty-turn stalls and mid-turn thinking leaks a single shot cannot catch.",
    criteria:
      "Completion = a turn that stops calling tools (no_tool_calls). The final card is scored by the #105 deterministic scorer as rubric 0-3 " +
      "(no LLM judge needed): schema + AES markers ≥2 + sources referencing the documents → 3. Stall / budget-exhausted → 0. " +
      "Metrics: completion rate · turns · valid-tool-call rate · mid-turn leak.",
    toolsSummary: "read_document / wiki_search / wiki_read (all mock). maxTurns 6.",
    routes: "Common to both chat_completions (OpenAI-compatible) and messages (Anthropic).",
  },
  agent_loop_budget_v1: {
    purpose:
      "Hard-budget variant: the same script as agent_loop_mock_v1 but with per-turn max_tokens tightened to 192, " +
      "reproducing whether a model that over-spills thinking into reasoning_content exhausts its budget and stalls on empty turns " +
      "(finish_reason=length).",
    criteria:
      "A restrained model finishes within budget (completed); an over-thinking model stalls + thinking_exhausted_budget. " +
      "192 is the empirically-determined budget that separates the two models. Deterministic scoring (0-3) **looks only at whether it finishes** — " +
      "finishing with a well-formed card schema → 3, incomplete schema → 1, stall / budget-exhausted / parse failure → 0. " +
      "It does not look at content markers or sources citations: mock_v1, which uses the same script, already measures those, so " +
      "measuring again here would count the same penalty 2 scenarios × 2 routes = 4 times, distorting the total.",
    toolsSummary: "read_document / wiki_search / wiki_read (all mock). maxTurns 6, max_tokens 192.",
    routes: "chat_completions / messages, common.",
  },
  agent_loop_docs_v1: {
    purpose:
      "Multi-document digest: receives 3 documents via list_documents and reads each via read_document(id) (argDispatch), " +
      "emitting a single JSON report that attributes each document's key facts to the correct id. Measures task throughput, context retention, and grounding.",
    criteria:
      "Deterministic scoring (0-3): if the three documents' facts are attributed to the correct id (no cross-contamination) and all 3 read_document reads happened → 3, " +
      "attribution 2/3 or fewer reads → 2, below that → 1. Never calling read_document caps rubric at 1 (no grounding). " +
      "Being the longest task, it dominates the wall-clock per completed task (task_ms). " +
      "※ This document corpus is fictional — if it were public canon, full marks could come from recall alone without tools, and grounding couldn't be measured.",
    toolsSummary: "list_documents / read_document(argDispatch: id→body) (all mock). maxTurns 8, max_tokens 512.",
    routes: "chat_completions / messages, common.",
  },
  agent_loop_error_v1: {
    purpose:
      "Error recovery: the first read_document call returns a retryable error, and the body comes back normally from the second call on. Checks whether the model " +
      "recovers via retry from a transient tool error — fragile models stall or summarize the error payload. " +
      "Why the error is placed on 'the first tool you must call to get an answer': to prevent a model that shortcuts the workflow from never even hitting the error, " +
      "leaving the scenario measuring nothing (the shortcut itself is not penalized).",
    criteria:
      "Deterministic scoring (0-3): retry is judged by **actual measurement** — tool_call_counts.read_document ≥2 is required for a real retry. " +
      "Valid card + markers ≥2 + measured retry + retried=true matching → 3; retried but flag missing, or flag set while actually only 1 call → 2 (false self-report); " +
      "summarizing the error payload · schema deficiency · not calling the tool → 1.",
    toolsSummary: "read_document (sequence mock: 1st error → 2nd body) / wiki_search / wiki_read. maxTurns 8, max_tokens 512.",
    routes: "chat_completions / messages, common.",
  },
  agent_loop_grounding_v1: {
    purpose:
      "Grounding (argument fidelity): catalog_search gives 2 UUID-style record ids and catalog_read(id) (argDispatch) returns a body only when the id " +
      "matches exactly. Whether the opaque id is copied exactly — truncating it or making it up yields a fallback error.",
    criteria:
      "The primary signal is tool_arg_fidelity (+ attempt rate). Deterministic scoring (0-3): exact id match for both records + each record's unique fact + " +
      "both catalog_read calls made → 3, ids correct but facts lacking → 2, id 1/2 or not called → 1, all ids hallucinated → 0. " +
      "The budget is generous (512) to decouple from budget pressure and measure only grounding. " +
      "※ The record corpus is fictional, and catalog_search's title is meaningless tokens so it does not leak the answer.",
    toolsSummary: "catalog_search / catalog_read(argDispatch: exact id match) (all mock). maxTurns 8, max_tokens 512.",
    routes: "chat_completions / messages, common.",
  },
  agent_loop_chain_v1: {
    purpose:
      "Distractor candidates + abstention: runs 2 lookups, following only the one candidate with status=\"active\" in each, and " +
      "must abstain on the lookup with no active (the 2nd). The key point is that **even if you pick the wrong candidate, resolve/fetch " +
      "returns success along with a plausible body** — unlike other scenarios, a fallback error does not immediately flag the wrong answer. " +
      "The first version (3-hop pure chaining) had only one choice per hop, so the task shrank to \"transcribing the previous tool output\", and " +
      "in practice all completing runs hit minimum turn count and full marks, which actually diluted discrimination. So, for the first time in the suite, " +
      "a **choice that can be wrong** was added.",
    criteria:
      "Deterministic scoring (0-3): a ladder on the number of correct items — 2/2 → 3, 1/2 → 2, 0/2 (schema valid) → 1, " +
      "stall / budget-exhausted / JSON parse failure → 0. Item 1 requires an exact match on the active record id + that record's unique marker in fact; " +
      "item 2 is correct only if abstained=true, and making up an answer from a superseded record is wrong. " +
      "The reason follows a select=<verdict> abstain=<verdict> spec, so wrong-answer types (hallucinated/wrong/abstained) are tallied directly. " +
      "The corpus is fictional, so recall is impossible.",
    toolsSummary:
      "search (sequence: 1st lookup 3 candidates · 2nd lookup 2 candidates) / resolve(argDispatch: ref — superseded also succeeds) / " +
      "fetch(argDispatch: record_id — even wrong records return a body) (all mock). maxTurns 8, max_tokens 512.",
    routes: "chat_completions / messages, common.",
  },
};
