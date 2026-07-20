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
    "The documents describe internal specifications you have not seen before — rely only on what the tools return.",
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
    'Set "retried" to true if you had to retry a tool call after a retryable error. Do not include any text outside that JSON object.',
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
    "Do not invent, abbreviate, or truncate ids. Do not include any text outside that JSON object.",
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
 * #109 후속: 3홉 **순수 체이닝** — 상위권 천장 해소용.
 *
 * 실측에서 `gemma-4-26b-a4b-it@q4_k_m` 과 `gemma-4-12b-it@q4_k_xl` 이 **공동 1위(100)** 로 붙었다.
 * 워크플로 준수율은 1.00 vs 0.60 으로 달랐지만 그건 진단 지표이지 점수가 아니다(#109 결정:
 * 단축은 효율로 인정하고 감점하지 않는다). 그래서 **감점 대신 과업 자체를 체인으로** 만든다.
 *
 *   search(topic)    → ref            (hop1 산출)
 *   resolve(ref)     → record_id      (hop2 — ref 를 정확히 넘겨야 함)
 *   fetch(record_id) → 유일한 사실      (hop3 — record_id 를 정확히 넘겨야 함)
 *
 * 최종 답 `{ref, record_id, fact}` 이 **세 홉의 산출물을 각각 요구**하므로, 어느 홉을 건너뛰면
 * 감점당하는 게 아니라 **그 필드를 채울 방법이 없다**.
 *
 * ⚠ 내용은 전부 가공(fictional)이며, `docs`/`grounding` 의 마커와 **겹치지 않는 새 고유명사**를 쓴다
 * (교차오염 판정이 서로 간섭하지 않도록 — 배타성 drift 테스트가 고정).
 */
export const AGENT_LOOP_CHAIN_V1: ScenarioDef = {
  id: "agent_loop_chain_v1",
  source: "builtin",
  system: [
    "You are an autonomous agent. Follow a three-step lookup chain, then produce a FINAL answer.",
    "Workflow: call search to get a ref code, then call resolve with that EXACT ref to get a record id, then call fetch with that EXACT record id to get the fact.",
    "Each step's output is the next step's input — copy the values character-for-character; do not invent them.",
    'The FINAL answer MUST be a single JSON object: {"ref": string, "record_id": string, "fact": string}.',
    "Do not include any text, markdown, or commentary outside that JSON object in your final answer.",
  ].join(" "),
  user:
    "Look up the ratification detail through the catalog chain and report the ref, the record id, and the fact. " +
    "These are internal records you have not seen before — rely only on what the tools return.",
  tools: [
    {
      name: "search",
      description: "Search the internal catalog; returns a ref code.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", description: "topic to search" } },
        required: [],
      },
    },
    {
      name: "resolve",
      description: "Resolve a ref code to a record id.",
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
        tool: "search",
        // hop1 은 ref 만 준다 — record_id 나 fact 를 흘리면 체인을 건너뛸 수 있다(grounding 초판의 title 누설 교훈).
        responses: ['{"ref":"REF-7K2Q"}'],
        repeatLast: true,
      },
      {
        tool: "resolve",
        responses: ['{"error":"call search first to obtain a ref"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "ref",
          cases: { "REF-7K2Q": '{"record_id":"rec_ch_41d8"}' },
          fallback: '{"error":"unknown_ref — pass the ref exactly as returned by search"}',
        },
      },
      {
        tool: "fetch",
        responses: ['{"error":"call resolve first to obtain a record id"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "record_id",
          // ⚠ 가공 데이터. 마커(ridgeway·ambleside)는 docs/grounding corpus 에 등장하지 않는다.
          cases: {
            rec_ch_41d8:
              "RECORD rec_ch_41d8: The Ridgeway protocol was ratified at the Ambleside review; its checkpoint interval is 48 blocks.",
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
