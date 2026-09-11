import { describe, expect, it } from "vitest";
import {
  averageRunsToScoringRow,
  buildScoringRows,
  computeScoreboard,
  scoringRowsFromBenchDetails,
  type ScoringAggregate,
  type ScoringBenchDetailInput,
  type ScoringResultRow,
  type ScoringRow,
  type ScoringRunInput,
} from "./scoreboard";

// 두 경로(웹 buildScoringRows / 서버 scoringRowsFromBenchDetails)가 같은 데이터에서
// 바이트 단위로 동일한 ScoringRow[]를 내는지 잠근다 — server ≡ browser 회귀 게이트.
describe("scoreboard parity (server ≡ browser)", () => {
  const chatRuns: ScoringRunInput[] = [
    { ttft_ms: 100, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
    { ttft_ms: 200, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: false, score: 0 } },
  ];
  const visionRuns: ScoringRunInput[] = [
    {
      ttft_ms: 150,
      total_ms: 2000,
      output_text: "x".repeat(80),
      quality: { pass: false, score: 0.33, reason: "prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging" },
    },
  ];

  const rows: ScoringResultRow[] = [
    { rowKey: "k1", model_id: "A", scenario: "chat_hello", api: "chat_completions", ttft_ms: null },
    { rowKey: "k2", model_id: "A", scenario: "vision_meme_explain_a", api: "chat_completions", ttft_ms: null },
  ];
  const aggregate: ScoringAggregate = { k1: { runs: chatRuns }, k2: { runs: visionRuns } };

  const details: ScoringBenchDetailInput[] = [
    {
      meta: { model_id: "A" },
      scenarios: [
        { id: "chat_hello", api_route: "chat_completions", runs: chatRuns },
        { id: "vision_meme_explain_a", api_route: "chat_completions", runs: visionRuns },
      ],
    },
  ];

  it("buildScoringRows ≡ scoringRowsFromBenchDetails", () => {
    const web = buildScoringRows(rows, aggregate);
    const server = scoringRowsFromBenchDetails(details);
    expect(server).toEqual(web);
  });

  it("computeScoreboard is identical for both paths", () => {
    expect(computeScoreboard(scoringRowsFromBenchDetails(details))).toEqual(
      computeScoreboard(buildScoringRows(rows, aggregate)),
    );
  });

  it("averageRunsToScoringRow averages runs (chat) and flags judge-cap (vision)", () => {
    const chat = averageRunsToScoringRow("A", "chat_hello", "chat_completions", chatRuns);
    expect(chat.score).toBe(0.5); // (1+0)/2
    expect(chat.ttft_ms).toBe(150); // (100+200)/2
    expect(chat.judgeCapped).toBe(false);
    // decode: (10-1)/(1000-100)=10, (10-1)/(1000-200)=11.25 → avg 10.625
    expect(chat.tps).toBeCloseTo(10.625, 5);
    // 구 런: prompt tokens 없음
    expect(chat.prefill_tps).toBeNull();
    const withPrompt = averageRunsToScoringRow("A", "chat_hello", "chat_completions", [
      { ...chatRuns[0]!, usage_prompt_tokens: 50 },
    ]);
    // 50 tok / 0.1s = 500
    expect(withPrompt.prefill_tps).toBe(500);
    const vision = averageRunsToScoringRow("A", "vision_meme_explain_a", "chat_completions", visionRuns);
    expect(vision.judgeCapped).toBe(true);
  });

  it("filter drops non-matching scenarios", () => {
    const only = scoringRowsFromBenchDetails(details, (id) => id === "chat_hello");
    expect(only.map((r) => r.scenario)).toEqual(["chat_hello"]);
  });
});

// agent 카테고리: agent_* 런은 text 버킷을 떠나 agent 버킷으로 가고, total은 여전히 전체 풀링.
describe("scoreboard agent 카테고리", () => {
  const chatRuns: ScoringRunInput[] = [
    { ttft_ms: 100, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
  ];
  const agentRuns: ScoringRunInput[] = [
    { ttft_ms: 120, total_ms: 3000, output_text: "y".repeat(40), usage_output_tokens: 30, quality: { pass: true, score: 1 } },
  ];
  // judge OFF로 캡된 agent 런(등록 시나리오는 scenarios.ts가 "prefilter passed — judge pending" 0.33).
  const agentCappedRuns: ScoringRunInput[] = [
    { ttft_ms: 120, total_ms: 3000, output_text: "z".repeat(40), quality: { pass: false, score: 0.33, reason: "prefilter passed — judge pending" } },
  ];

  it("agent 런은 agent 버킷에 들어가고 text 버킷엔 안 들어간다; total은 둘 다 포함", () => {
    const details: ScoringBenchDetailInput[] = [
      {
        meta: { model_id: "A" },
        scenarios: [
          { id: "chat_hello", api_route: "chat_completions", runs: chatRuns },
          { id: "agent_loop_mock_v1", api_route: "chat_completions", runs: agentRuns },
        ],
      },
    ];
    const board = computeScoreboard(scoringRowsFromBenchDetails(details));
    const row = board.find((r) => r.model_id === "A")!;
    expect(row.quality.text.expected).toBe(1); // chat_hello만
    expect(row.quality.agent.expected).toBe(1); // agent_loop_mock_v1만
    expect(row.quality.total.expected).toBe(2); // 전체 풀링
    expect(row.speed.agent.tpsMedian).not.toBeNull();
    expect(row.textOnly).toBe(false); // agent 시도 → text-only 아님
  });

  it("judge OFF 캡된 agent 런은 judge_capped caveat를 세운다", () => {
    const details: ScoringBenchDetailInput[] = [
      {
        meta: { model_id: "B" },
        scenarios: [{ id: "agent_loop_mock_v1", api_route: "chat_completions", runs: agentCappedRuns }],
      },
    ];
    const board = computeScoreboard(scoringRowsFromBenchDetails(details));
    expect(board[0]!.quality.caveats).toContain("judge_capped");
    expect(board[0]!.quality.judgeCappedScenarios).toBe(1);
  });

  it("averageRunsToScoringRow: agent 시나리오도 judge-cap 판정", () => {
    const r = averageRunsToScoringRow("B", "agent_loop_mock_v1", "chat_completions", agentCappedRuns);
    expect(r.judgeCapped).toBe(true);
  });
});

// #105: vision 은 `rubricResult()` 가 reason 앞에 `rubric=N | ` 를 붙인다. 예전 `startsWith` 판정으로는
// **영영 매칭되지 않아** vision 에 judge_capped 경고가 한 번도 뜬 적이 없었다. 실제 포맷으로 고정한다.
describe("judge_capped — 실제 reason 포맷(vision 접두사)", () => {
  const visionCappedReal: ScoringRunInput[] = [
    {
      ttft_ms: 100,
      total_ms: 1000,
      output_text: "x".repeat(40),
      quality: {
        pass: false,
        score: 0.33,
        // rubricResult(1, "prefilter passed — …") 가 실제로 만드는 문자열
        reason: "rubric=1 | prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging",
      },
    },
  ];

  it("`rubric=1 | prefilter passed …` 도 judge_capped 로 잡힌다", () => {
    const r = averageRunsToScoringRow("V", "vision_meme_explain_a", "chat_completions", visionCappedReal);
    expect(r.judgeCapped).toBe(true);
  });

  it("실제 판정을 받은 vision 런은 캡으로 오인하지 않는다", () => {
    const judged: ScoringRunInput[] = [
      {
        ttft_ms: 100,
        total_ms: 1000,
        output_text: "x",
        quality: { pass: true, score: 1, reason: "rubric=3 | judge: faithful" },
      },
    ];
    expect(averageRunsToScoringRow("V", "vision_meme_explain_a", "chat_completions", judged).judgeCapped).toBe(false);
  });

  it("#105 결정론 채점 사유(agent_det)는 judge_capped 가 아니다", () => {
    const det: ScoringRunInput[] = [
      {
        ttft_ms: 100,
        total_ms: 1000,
        output_text: "x",
        quality: { pass: false, score: 0.33, reason: "rubric=1 | agent_det: attribution 1/3" },
      },
    ];
    expect(averageRunsToScoringRow("A", "agent_loop_docs_v1", "chat_completions", det).judgeCapped).toBe(false);
  });
});

describe("#173: 정본 라우트 선택 (경로 풀링 제거)", () => {
  function row(p: Partial<ScoringRow> & { model_id: string; api: string }): ScoringRow {
    return {
      scenario: "chat_hello",
      ttft_ms: 100,
      tps: 30,
      score: 1,
      judgeCapped: false,
      ...p,
    } as ScoringRow;
  }

  it("두 라우트를 다 측정했으면 chat_completions 만 랭킹에 쓴다", () => {
    // messages 쪽을 극단적으로 나쁘게 둬서, 풀링되면 반드시 값이 달라지게 한다.
    const board = computeScoreboard([
      row({ model_id: "A", api: "chat_completions", tps: 30, ttft_ms: 300, score: 1 }),
      row({ model_id: "A", api: "messages", tps: 5, ttft_ms: 19_000, score: 0 }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]!.api_route).toBe("chat_completions");
    expect(board[0]!.routes_measured).toEqual(["chat_completions", "messages"]);
    // chat 단독 값 — 풀링(평균)이었다면 각각 583·9650·50이 나온다.
    expect(board[0]!.speed.total.score).toBe(1000);
    expect(board[0]!.speed.total.ttftMs).toBe(300);
    expect(board[0]!.quality.total.value).toBe(100);
  });

  it("messages 만 측정한 모델은 그 라우트가 정본 — 랭킹에서 사라지지 않는다", () => {
    const board = computeScoreboard([
      row({ model_id: "B", api: "messages", tps: 15, ttft_ms: 2000, score: 0.5 }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]!.api_route).toBe("messages");
    expect(board[0]!.routes_measured).toEqual(["messages"]);
    expect(board[0]!.speed.total.score).toBe(500);
  });

  it("모델마다 독립적으로 정본을 고른다", () => {
    const board = computeScoreboard([
      row({ model_id: "A", api: "chat_completions", tps: 30 }),
      row({ model_id: "A", api: "messages", tps: 5 }),
      row({ model_id: "B", api: "messages", tps: 15 }),
    ]);
    const byId = new Map(board.map((b) => [b.model_id, b]));
    expect(byId.get("A")!.api_route).toBe("chat_completions");
    expect(byId.get("B")!.api_route).toBe("messages");
  });

  it("시나리오가 라우트 수만큼 이중 계상되지 않는다", () => {
    const board = computeScoreboard([
      row({ model_id: "A", scenario: "chat_hello", api: "chat_completions" }),
      row({ model_id: "A", scenario: "chat_hello", api: "messages" }),
      row({ model_id: "A", scenario: "chat_ping", api: "chat_completions" }),
      row({ model_id: "A", scenario: "chat_ping", api: "messages" }),
    ]);
    expect(board[0]!.speed.total.scoredRows).toBe(2);
  });
});
