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
  judge: {
    scale: "0-3",
    criterion: [
      "Score the model's FINAL answer as a JSON card.",
      'It must be a single valid JSON object with keys: title (non-empty string), summary (non-empty string), sources (array of strings).',
      "3 = valid JSON with all three keys well-formed and a faithful summary;",
      "2 = valid JSON but a minor issue (e.g. empty sources or thin summary);",
      "1 = JSON present but wrong shape / missing keys;",
      "0 = no valid JSON object in the final answer.",
    ].join(" "),
  },
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
    // 하네스는 "도구 호출을 멈추면 종료"로 완료를 판정하고, JSON 유효성은 judge가 채점한다.
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
 * #105: 멀티문서 다이제스트 — 과업 처리량 + 맥락 유지.
 *
 * `list_documents` 로 문서 id 3개를 받고 `read_document(id)` 를 문서별로 호출해(argDispatch 로 id→본문),
 * 각 문서의 핵심 사실을 올바른 id에 귀속해 하나의 JSON 리포트를 낸다. 사실을 문서 간에 뒤섞으면
 * (맥락 유지 실패) judge 가 감점. 가장 긴 과업이라 완료 과업당 벽시계(task_ms)의 지배 항이 된다.
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
  user: "Digest all of the ingested source documents into a single JSON report. List them, read each, then answer.",
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
  judge: {
    scale: "0-3",
    criterion: [
      "Score the model's FINAL answer as a multi-document JSON report.",
      "It must be a single valid JSON object: {title: string, documents: array of {id, key_fact}, summary: string}.",
      "3 = valid JSON, all three documents present, each key_fact correctly attributed to the right id (doc_aes=128-bit block/Rijndael, doc_des=56-bit key/withdrawn, doc_rsa=public-key/factorization);",
      "2 = valid JSON but one document thin or missing;",
      "1 = JSON present but wrong shape OR facts swapped between documents (context-retention failure);",
      "0 = no valid JSON object in the final answer.",
    ].join(" "),
  },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "list_documents",
        responses: ['[{"id":"doc_aes"},{"id":"doc_des"},{"id":"doc_rsa"}]'],
        repeatLast: true,
      },
      {
        tool: "read_document",
        // argDispatch 사용 시 responses는 무시되지만 스키마상 필수 — 안내 문자열 placeholder.
        responses: ['{"error":"call list_documents first, then read_document with an id"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "id",
          cases: {
            doc_aes:
              "DOCUMENT doc_aes — AES (FIPS-197, 2001): symmetric block cipher, 128-bit block, key sizes 128/192/256, based on the Rijndael cipher.",
            doc_des:
              "DOCUMENT doc_des — DES (FIPS 46, 1977): symmetric cipher with a 56-bit key, withdrawn as a standard in 2005, superseded by AES.",
            doc_rsa:
              "DOCUMENT doc_rsa — RSA (1977, Rivest–Shamir–Adleman): public-key cryptosystem whose security rests on the difficulty of integer factorization.",
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
 * `wiki_read` 첫 호출은 `retryable:true` 에러를 돌려주고(시퀀스 mock), 두 번째 호출부터 정상 본문.
 * 취약한 모델은 정체하거나 에러 페이로드를 요약하지만, 규율 있는 모델은 재시도해 완주한다.
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
  judge: {
    scale: "0-3",
    criterion: [
      "Score the model's FINAL answer as a JSON card produced after a transient tool error.",
      "It must be a single valid JSON object: {title: string, summary: string, sources: array of strings, retried: boolean}.",
      "3 = valid card, retried=true, and a faithful AES summary;",
      "2 = correct content but the retried flag is missing or false;",
      "1 = wrong shape OR the summary describes the tool error instead of AES;",
      "0 = no valid JSON object / gave up.",
    ].join(" "),
  },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "read_document",
        responses: [
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
        // 1차 호출 = 일시 에러(retryable), 2차+ = 정상 본문. repeatLast 로 재시도 시 실제 내용을 준다.
        responses: [
          '{"error":"page_load_failed","retryable":true,"hint":"retry the same id once"}',
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
  judge: {
    scale: "0-3",
    criterion: [
      "Score the model's FINAL answer {answers: array of {id, fact}}.",
      "3 = valid JSON with both records present, the exact ids (rec_9f3a1c77-4b2e, rec_0d84e2ab-77f1) and correct facts;",
      "2 = both facts correct but an id slightly off;",
      "1 = one record only OR wrong shape;",
      "0 = no valid JSON object.",
    ].join(" "),
  },
  agentLoop: {
    maxTurns: 8,
    mockTools: [
      {
        tool: "catalog_search",
        responses: [
          '[{"id":"rec_9f3a1c77-4b2e","title":"Rijndael selection"},{"id":"rec_0d84e2ab-77f1","title":"DES retirement"}]',
        ],
        repeatLast: true,
      },
      {
        tool: "catalog_read",
        responses: ['{"error":"call catalog_search first"}'],
        repeatLast: true,
        argDispatch: {
          argKey: "id",
          cases: {
            "rec_9f3a1c77-4b2e":
              "RECORD rec_9f3a1c77-4b2e: In 2000 NIST selected the Rijndael cipher as the Advanced Encryption Standard (FIPS-197).",
            "rec_0d84e2ab-77f1":
              "RECORD rec_0d84e2ab-77f1: DES was withdrawn as a U.S. federal standard in 2005 after its 56-bit key became insecure.",
          },
          fallback: '{"error":"unknown_id — copy the id exactly from catalog_search results"}',
        },
      },
    ],
    completion: { type: "no_tool_calls" },
  },
};

registerScenarioDef(AGENT_LOOP_GROUNDING_V1);

/** 기본 제공 agent_loop id 목록(catalog set=agent 등). agent-loop-builtin.test.ts 가 레지스트리와의 드리프트를 가드. */
export const BUILTIN_AGENT_LOOP_IDS: readonly string[] = [
  AGENT_LOOP_MOCK_V1.id,
  AGENT_LOOP_BUDGET_V1.id,
  AGENT_LOOP_DOCS_V1.id,
  AGENT_LOOP_ERROR_V1.id,
  AGENT_LOOP_GROUNDING_V1.id,
];
