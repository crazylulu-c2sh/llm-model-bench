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
 * 예산 값 256 은 출발점 — 두 모델을 가르는 값은 E2E 스윕(200~320)으로 확정한다.
 */
export const AGENT_LOOP_BUDGET_V1: ScenarioDef = {
  ...AGENT_LOOP_MOCK_V1,
  id: "agent_loop_budget_v1",
  sampling: { temperature: 0, max_tokens: 256 },
};

registerScenarioDef(AGENT_LOOP_BUDGET_V1);

/** 기본 제공 agent_loop id 목록(catalog set=agent 등). */
export const BUILTIN_AGENT_LOOP_IDS: readonly string[] = [
  AGENT_LOOP_MOCK_V1.id,
  AGENT_LOOP_BUDGET_V1.id,
];
