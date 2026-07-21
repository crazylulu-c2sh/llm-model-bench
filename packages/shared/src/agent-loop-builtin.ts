import { registerScenarioDef, type ScenarioDef } from "./scenario-registry";

/**
 * #79: 기본 제공 멀티턴 agent_loop 시나리오.
 *
 * "research-then-answer" 스크립트: read_document → wiki_search → wiki_read 를 거쳐
 * 최종적으로 JSON 카드({title, summary, sources[]})를 낸다. mock 도구가 캔드 결과를 돌려주며,
 * 완료는 `json_valid`(최종 출력이 유효 JSON)로 판정한다.
 *
 * 이 시나리오는 단일-샷 function-calling이 못 잡는 결함(빈-턴 정체·중간 턴 사고 누수)을
 * 턴을 가로질러 드러내기 위한 것이다(이슈 #79의 it-qat vs q4_k_m 발산).
 */
export const AGENT_LOOP_MOCK_V1: ScenarioDef = {
  id: "agent_loop_mock_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Use the provided tools to research, then produce a FINAL answer.",
    "Workflow: call read_document, then wiki_search, then wiki_read, then stop calling tools and output the final answer.",
    'The FINAL answer MUST be a single JSON object: {"title": string, "summary": string, "sources": string[]}.',
    "Do not include any text, markdown, or commentary outside that JSON object in your final answer.",
    "After you have finished calling the tools, emit the final JSON object directly in the next turn — do not ask a clarifying question, promise to answer later, or end a turn without either a tool call or the final JSON object.",
  ].join(" "),
  user: "Summarize the ingested source document into a JSON card. Research with the tools first.",
  tools: [
    {
      name: "read_document",
      description: "Read the ingested source document that must be summarized.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "wiki_search",
      description: "Search the internal wiki for related pages.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "search query" } },
        required: ["query"],
      },
    },
    {
      name: "wiki_read",
      description: "Read a wiki page by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "wiki page id" } },
        required: ["id"],
      },
    },
  ],
  sampling: { temperature: 0, max_tokens: 640 },
  agentLoop: {
    maxTurns: 6,
    mockTools: [
      {
        tool: "read_document",
        responses: [
          "SOURCE DOCUMENT: The Advanced Encryption Standard (AES), specified in NIST FIPS-197 (2001), is a symmetric block cipher. Block size is 128 bits; supported key sizes are 128, 192, and 256 bits. It is based on the Rijndael cipher by Daemen and Rijmen.",
        ],
        repeatLast: true,
      },
      {
        tool: "wiki_search",
        responses: ['[{"id":"aes","title":"Advanced Encryption Standard"},{"id":"rijndael","title":"Rijndael"}]'],
        repeatLast: true,
      },
      {
        tool: "wiki_read",
        responses: [
          "WIKI(aes): Advanced Encryption Standard — the Rijndael cipher selected by NIST as FIPS-197. Widely used; supersedes DES.",
        ],
        repeatLast: true,
      },
    ],
    // 하네스는 "도구 호출을 멈추면 종료"로 완료를 판정하고, 최종 출력 품질은
    // #105 의 결정론 채점기(apps/server/src/scoring/agent-score.ts)가 rubric 0~3 으로 채점한다.
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_MOCK_V1);

/**
 * #101: 하드 예산(tight per-turn max_tokens) 변종.
 *
 * `AGENT_LOOP_MOCK_V1` 과 동일한 research-then-answer 스크립트지만 per-turn `max_tokens` 를 256 으로
 * 조인다. 절제된 모델은 도구 호출/최종 JSON 카드(~120 토큰)를 예산 안에 낼 수 있지만, 사고를
 * `reasoning_content` 로 과도하게 흘리는 모델(예: google/gemma-4-26b-a4b-qat)은 그 사고가 예산을
 * 소진해 `finish_reason=length` + 빈 `content` 로 끝난다 → 하네스가 빈 턴을 `stall` 로 판정
 * (프로덕션 `empty_turn_loop:no_signal` 의 1턴 budget-exhausted 시그니처. 프로덕션의 3-strike 가드와
 * 동일하진 않고, 예산 소진으로 인한 빈-턴을 재현·회귀가드하는 용도).
 *
 * 예산 값 192 는 E2E 스윕으로 확정한 "가르는 예산"이다(측정: LM Studio / M4 Pro):
 *   - `google/gemma-4-26b-a4b-qat`(과사고)  → stall · thinking_exhausted_budget=true · reasoning_chars 1359 · usage 358
 *   - `gemma-4-26b-a4b-it@q4_k_m`(절제)     → completed · 4턴 · usage 182
 * 256 에서는 둘 다 completed 였다(이 AES 스크립트는 턴당 출력이 작아 256 이 헐거움). 더 낮추면
 * 절제 모델의 최종 JSON 카드(~120 토큰)까지 잘려 오탐이 된다.
 */
export const AGENT_LOOP_BUDGET_V1: ScenarioDef = {
  ...AGENT_LOOP_MOCK_V1,
  id: "agent_loop_budget_v1",
  sampling: { temperature: 0, max_tokens: 192 },
};

registerScenarioDef(AGENT_LOOP_BUDGET_V1);

/**
 * #105: 멀티문서 다이제스트 — 과업 처리량 + 맥락 유지 + **그라운딩**.
 *
 * `list_documents` 로 문서 id 3개를 받고 `read_document(id)` 를 문서별로 호출해(argDispatch 로 id→본문),
 * 각 문서의 핵심 사실을 올바른 id에 귀속해 하나의 JSON 리포트를 낸다. 사실을 문서 간에 뒤섞으면
 * (맥락 유지 실패) 감점. 가장 긴 과업이라 완료 과업당 벽시계(task_ms)의 지배 항이 된다.
 *
 * ⚠ **이 문서들의 내용은 전부 가공(fictional)이다 — 실제 암호 알고리즘이 아니다.**
 * 초판은 AES/DES/RSA 같은 공개 canon 을 썼는데, 실측 결과 모델이 **도구를 쓰지 않고 파라메트릭
 * 회상만으로** 만점을 냈다(= 그라운딩을 전혀 측정하지 못함). 가상 개체로 바꾸면 도구 출력이
 * 유일한 정보원이 되어 회상 경로가 원천 차단된다. (canon 을 "틀리게" 적는 위조 대신 가상 개체를
 * 쓰는 이유: 공개 레포에 허위 암호학 정보를 남기지 않기 위해서다.)
 */
export const AGENT_LOOP_DOCS_V1: ScenarioDef = {
  id: "agent_loop_docs_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Digest MULTIPLE source documents into one JSON report.",
    "Workflow: call list_documents to get the document ids, then call read_document once per id (pass the id exactly as returned), then stop calling tools and output the final answer.",
    'The FINAL answer MUST be a single JSON object: {"title": string, "documents": [{"id": string, "key_fact": string}], "summary": string}.',
    "Each documents[] entry must pair a document id with the key fact from THAT document — do not mix facts between documents.",
    "Do not include any text, markdown, or commentary outside that JSON object in your final answer.",
  ].join(" "),
  user:
    "Digest all of the ingested source documents into a single JSON report. List them, read each, then answer. " +
    "The documents describe internal specifications you have not seen before — rely only on what the tools return. " +
    "Do not answer from prior knowledge or fill in any key_fact from memory; read every document before answering.",
  tools: [
    {
      name: "list_documents",
      description: "List the ids of the source documents to digest.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "read_document",
      description: "Read one source document by its id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "document id from list_documents" } },
        required: ["id"],
      },
    },
  ],
  sampling: { temperature: 0, max_tokens: 512 },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "list_documents",
        responses: ['[{"id":"doc_kestrel"},{"id":"doc_marlin"},{"id":"doc_quartz"}]'],
        repeatLast: true,
      },
      {
        tool: "read_document",
        // argDispatch 사용 시 responses는 무시되지만 스키마상 필수 — 안내 문자열 placeholder.
        responses: ['{"error":"call list_documents first, then read_document with an id"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "id",
          // ⚠ 전부 가공 데이터. 각 문서의 1차 마커(고유명사)는 다른 문서 본문에 절대 등장하지 않게
          // 문안을 골랐다 — 교차오염 판정의 근거이며 agent-score-drift 테스트가 배타성을 고정한다.
          cases: {
            doc_kestrel:
              "DOCUMENT doc_kestrel — Kestrel-3 (internal spec KS-3, 2019): stream cipher with a 192-bit nonce, key sizes 128 and 256, built on the Halcyon permutation.",
            doc_marlin:
              "DOCUMENT doc_marlin — Marlin (internal spec ML-1, 2014): block cipher with a 384-bit block, deprecated in 2021 after the Vela distinguisher.",
            doc_quartz:
              "DOCUMENT doc_quartz — Quartz (2011, Duval-Renard): lattice-based key exchange whose security rests on the shortest-vector problem.",
          },
          fallback: '{"error":"unknown_document_id — use an id returned by list_documents"}',
        },
      },
    ],
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_DOCS_V1);

/**
 * #105: 에러 복구 — 일시적 도구 오류에서 재시도로 회복하는지.
 *
 * `read_document` 첫 호출이 `retryable:true` 에러를 돌려주고(시퀀스 mock), 두 번째 호출부터 정상 본문.
 * 취약한 모델은 정체하거나 에러 페이로드를 요약하지만, 규율 있는 모델은 재시도해 완주한다.
 *
 * ⚠ **에러는 반드시 "불가피한 첫 도구"에 둔다.** 초판은 에러를 워크플로 3번째인 `wiki_read` 에
 * 뒀는데, 워크플로를 단축해 `read_document` 만 부르고 답한 모델(실측: gemma-4-12b-it@q4_k_xl,
 * turns=2)은 **에러를 만난 적조차 없어** 이 시나리오가 아무것도 측정하지 못했다. 단축 자체는
 * 감점하지 않되(효율로 인정), 문제를 건너뛸 수는 없게 만든 것이다.
 * 재시도 여부는 `tool_call_counts.read_document >= 2` 로 **실측**한다(자기신고 `retried` 반증).
 */
export const AGENT_LOOP_ERROR_V1: ScenarioDef = {
  id: "agent_loop_error_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Research with the tools, then produce a FINAL answer.",
    "Workflow: call read_document, then wiki_search, then wiki_read, then stop calling tools and output the final answer.",
    'If a tool returns a JSON object with "retryable": true, retry that SAME call exactly once before continuing; do not give up or answer from the error payload.',
    'The FINAL answer MUST be a single JSON object: {"title": string, "summary": string, "sources": string[], "retried": boolean}.',
    'Set "retried" to true if you had to retry a tool call after a retryable error. Do not include any text outside that JSON object. A transient tool error is not a reason to stop or to ask the user what to do — recover by retrying, then complete the task and emit the final JSON object in this turn.',
  ].join(" "),
  user: "Summarize the ingested source document into a JSON card. Research with the tools; recover from any transient tool errors.",
  tools: [
    {
      name: "read_document",
      description: "Read the ingested source document that must be summarized.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "wiki_search",
      description: "Search the internal wiki for related pages.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "search query" } },
        required: ["query"],
      },
    },
    {
      name: "wiki_read",
      description: "Read a wiki page by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "wiki page id" } },
        required: ["id"],
      },
    },
  ],
  sampling: { temperature: 0, max_tokens: 512 },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "read_document",
        // 1차 호출 = 일시 에러(retryable), 2차+ = 정상 본문. repeatLast 로 재시도 시 실제 내용을 준다.
        // 답을 얻으려면 반드시 부르는 도구라 **어떤 모델도 에러를 피할 수 없다**.
        responses: [
          '{"error":"document_load_failed","retryable":true,"hint":"retry the same call once"}',
          "SOURCE DOCUMENT: The Advanced Encryption Standard (AES), specified in NIST FIPS-197 (2001), is a symmetric block cipher. Block size is 128 bits; supported key sizes are 128, 192, and 256 bits. It is based on the Rijndael cipher.",
        ],
        repeatLast: true,
      },
      {
        tool: "wiki_search",
        responses: ['[{"id":"aes","title":"Advanced Encryption Standard"}]'],
        repeatLast: true,
      },
      {
        tool: "wiki_read",
        responses: [
          "WIKI(aes): Advanced Encryption Standard — the Rijndael cipher selected by NIST as FIPS-197; supersedes DES.",
        ],
        repeatLast: true,
      },
    ],
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_ERROR_V1);

/**
 * #105: 그라운딩(인자 충실도) — 불투명 id를 정확히 복사해 도구를 호출하는지.
 *
 * `catalog_search` 가 UUID형 record id 2개를 돌려주고, `catalog_read(id)` 는 그 id와 정확히 일치할 때만
 * (argDispatch) 본문을 준다. id를 잘라 쓰거나 지어내면 fallback 에러 → 인자 충실도(tool_arg_fidelity)로
 * 드러난다. 예산은 넉넉(512)해 예산 압박과 분리, 인자 충실도만 측정한다.
 *
 * ⚠ **레코드 내용은 전부 가공(fictional)이다.** 초판은 실제 사실(Rijndael 선정·DES 철회)을 썼고,
 * 더 나쁘게는 `catalog_search` 의 **title 이 답을 그대로 누설**했다("Rijndael selection") — 즉
 * `catalog_read` 를 부르지 않고도 정답을 낼 수 있었다. 지금은 ① title 을 무의미 토큰으로 바꾸고
 * ② 본문을 가상 사실로 교체해, 레코드를 실제로 읽지 않으면 fact 를 채울 방법이 없게 했다.
 */
export const AGENT_LOOP_GROUNDING_V1: ScenarioDef = {
  id: "agent_loop_grounding_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Answer using a catalog you must search first.",
    "Workflow: call catalog_search to get record ids, then call catalog_read once for EACH record id, copying the id EXACTLY as returned (the ids are opaque and must match character-for-character), then stop calling tools and output the final answer.",
    'The FINAL answer MUST be a single JSON object: {"answers": [{"id": string, "fact": string}]}.',
    "Do not invent, abbreviate, or truncate ids. Do not include any text outside that JSON object. If catalog_read returns an error, re-copy the id verbatim from the catalog_search results and read it again — never guess or fill in a fact from memory.",
  ].join(" "),
  user: "Look up every record from the catalog and report each id with its fact.",
  tools: [
    {
      name: "catalog_search",
      description: "Search the catalog; returns record ids and titles.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "search query" } },
        required: [],
      },
    },
    {
      name: "catalog_read",
      description: "Read one catalog record by its exact id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "exact record id from catalog_search" } },
        required: ["id"],
      },
    },
  ],
  sampling: { temperature: 0, max_tokens: 512 },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "catalog_search",
        // title 은 의도적으로 무의미하다 — 예전 title 은 답을 누설해 catalog_read 없이도 정답이 나왔다.
        responses: [
          '[{"id":"rec_9f3a1c77-4b2e","title":"record A"},{"id":"rec_0d84e2ab-77f1","title":"record B"}]',
        ],
        repeatLast: true,
      },
      {
        tool: "catalog_read",
        responses: ['{"error":"call catalog_search first"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "id",
          // ⚠ 전부 가공 데이터. 레코드를 실제로 읽지 않으면 알 수 없는 고유명사만 담았다.
          cases: {
            "rec_9f3a1c77-4b2e":
              "RECORD rec_9f3a1c77-4b2e: The Halcyon permutation was adopted for Kestrel-3 in 2019 after the Aster review.",
            "rec_0d84e2ab-77f1":
              "RECORD rec_0d84e2ab-77f1: Marlin was deprecated in 2021 following the Vela distinguisher.",
          },
          fallback: '{"error":"unknown_id — copy the id exactly from catalog_search results"}',
        },
      },
    ],
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_GROUNDING_V1);

/**
 * #110 후속: **방해 후보 + 기권** — "틀릴 수 있는 선택지"를 처음으로 도입한다.
 *
 * 초판(3홉 순수 체이닝)은 상위권 천장을 깨지 못했다. 실측 사후분석 결과:
 *  - chain 완주 15런이 **전부 turns=4**(이론상 최소치)·calls{search:1,resolve:1,fetch:1}.
 *    각 홉의 선택지가 1개(분기 계수 1)라 과업이 "직전 도구 출력의 문자열을 옮겨 적기"로 축소됐다.
 *  - 품질 0.17 짜리 모델이 도구 응답 봉투째 복사해 만점을 받았다.
 *  - 항목-총점 상관 0.543 으로 6종 중 최저이면서 만점률 최고 → **신호를 희석**하고 있었다.
 *
 * 더 근본적으로, 10모델 × 6시나리오 × 2라우트 = **120셀에서 내용 오류가 0건**이었다. 정답이 유일하고
 * 틀린 인자는 fallback 에러로 즉시 걸러지니 **틀릴 수가 없는 구조**였고, 스위트는 "정확성"이 아니라
 * "생존(답을 낼 수 있는가)"만 재고 있었다.
 *
 * 그래서 두 가지를 넣는다:
 *  1. **방해 후보** — search 가 후보 3개를 주고 그중 `status:"active"` 하나만 정답이다.
 *     **잘못된 후보를 골라도 resolve/fetch 가 성공을 돌려준다**(그럴듯한 본문까지). 즉 처음으로
 *     "그럴듯하지만 틀린 답"이 가능해진다 — fallback 에러라는 안전망이 없다.
 *  2. **기권** — 2차 조회는 후보가 전부 superseded 다. 정답이 없으면 기권해야 하고,
 *     아무거나 골라 답하면 환각으로 감점된다.
 *
 * ⚠ 내용은 전부 가공(fictional)이며 docs/grounding 및 이전 chain 마커와 겹치지 않는다(배타성 drift 테스트).
 */
export const AGENT_LOOP_CHAIN_V1: ScenarioDef = {
  id: "agent_loop_chain_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Run TWO lookups, then produce a FINAL answer.",
    "For each lookup: call search to list candidates, pick the ONE candidate whose status is \"active\" (ignore \"superseded\" ones), call resolve with that EXACT ref to get a record id, then call fetch with that EXACT record id to get the fact.",
    "If a lookup returns NO candidate with status \"active\", you MUST abstain for that lookup instead of guessing — resolve and fetch will happily return data for superseded refs, so check the status yourself.",
    'The FINAL answer MUST be a single JSON object: {"results": [item, item]} where each item is either {"ref": string, "record_id": string, "fact": string} or {"abstained": true}.',
    "results must have exactly two entries, in lookup order. Do not include any text outside that JSON object.",
  ].join(" "),
  user:
    "Run the two catalog lookups in order and report the results array. " +
    "These are internal records you have not seen before — rely only on what the tools return, and honour the status field.",
  tools: [
    {
      name: "search",
      description: "List catalog candidates for the next lookup; each has a ref and a status.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", description: "topic to search" } },
        required: [],
      },
    },
    {
      name: "resolve",
      description: "Resolve a ref code to a record id. Works for any known ref, including superseded ones.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string", description: "exact ref code from search" } },
        required: ["ref"],
      },
    },
    {
      name: "fetch",
      description: "Fetch a record by its exact record id.",
      parameters: {
        type: "object",
        properties: { record_id: { type: "string", description: "exact record id from resolve" } },
        required: ["record_id"],
      },
    },
  ],
  sampling: { temperature: 0, max_tokens: 512 },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        // 시퀀스 mock: 1차 조회는 active 가 하나 있고, 2차는 전부 superseded(기권해야).
        // repeatLast 로 3회차 이후에도 2차 응답이 유지된다 — 기권 케이스를 다시 확인해도 결과가 같다.
        tool: "search",
        responses: [
          '[{"ref":"REF-A1","status":"superseded"},{"ref":"REF-B2","status":"active"},{"ref":"REF-C3","status":"superseded"}]',
          '[{"ref":"REF-D4","status":"superseded"},{"ref":"REF-E5","status":"superseded"}]',
        ],
        repeatLast: true,
      },
      {
        // ⚠ 함정: **모든 ref 가 성공한다.** 잘못된 후보를 골라도 에러가 안 나므로,
        // 모델이 status 를 스스로 확인하지 않으면 그럴듯하게 틀린 답을 낸다.
        tool: "resolve",
        responses: ['{"error":"call search first to obtain a ref"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "ref",
          cases: {
            "REF-A1": '{"record_id":"rec_wr_10a"}',
            "REF-B2": '{"record_id":"rec_ok_22b"}',
            "REF-C3": '{"record_id":"rec_wr_30c"}',
            "REF-D4": '{"record_id":"rec_wr_40d"}',
            "REF-E5": '{"record_id":"rec_wr_50e"}',
          },
          fallback: '{"error":"unknown_ref — pass a ref exactly as returned by search"}',
        },
      },
      {
        // ⚠ 오답 레코드도 자연스러운 본문을 준다 — 읽어봐도 "틀렸다"는 신호가 없다.
        tool: "fetch",
        responses: ['{"error":"call resolve first to obtain a record id"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "record_id",
          cases: {
            rec_ok_22b:
              "RECORD rec_ok_22b (active): The Thornbury schedule sets the Larkspur window to 12 cycles.",
            rec_wr_10a:
              "RECORD rec_wr_10a (superseded): An earlier revision set the window to 5 cycles.",
            rec_wr_30c:
              "RECORD rec_wr_30c (superseded): A withdrawn draft set the window to 9 cycles.",
            rec_wr_40d:
              "RECORD rec_wr_40d (superseded): A retired note set the interval to 21 cycles.",
            rec_wr_50e:
              "RECORD rec_wr_50e (superseded): A replaced memo set the interval to 33 cycles.",
          },
          fallback: '{"error":"unknown_record_id — pass the record id exactly as returned by resolve"}',
        },
      },
    ],
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_CHAIN_V1);

/** 기본 제공 agent_loop id 목록(catalog set=agent 등). agent-loop-builtin.test.ts 가 레지스트리와의 드리프트를 가드. */
export const BUILTIN_AGENT_LOOP_IDS: readonly string[] = [
  AGENT_LOOP_MOCK_V1.id,
  AGENT_LOOP_BUDGET_V1.id,
  AGENT_LOOP_DOCS_V1.id,
  AGENT_LOOP_ERROR_V1.id,
  AGENT_LOOP_GROUNDING_V1.id,
  AGENT_LOOP_CHAIN_V1.id,
];
