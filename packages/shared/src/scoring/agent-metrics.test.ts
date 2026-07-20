import { describe, expect, it } from "vitest";
import {
  agentMetricsFromBenchDetails,
  agentMetricsFromRows,
  type AgentBenchDetailInput,
  type AgentResultRow,
  type AgentRunInput,
} from "./agent-metrics";

function completed(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    agent_completion_reason: "completed",
    total_ms: 3000,
    turns_to_completion: 4,
    valid_tool_call_rate: 0.75,
    usage_output_tokens: 200,
    final_turn_output_tokens: 120,
    ...overrides,
  };
}

describe("agentMetricsFromBenchDetails", () => {
  it("완료율·정체율·예산소진율·사고예산율 = 사유별 / 전체 agent 런", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_mock_v1",
            api_route: "chat_completions",
            runs: [
              completed(),
              { agent_completion_reason: "stall", thinking_exhausted_budget: true, usage_output_tokens: 300 },
              { agent_completion_reason: "budget_exhausted", usage_output_tokens: 300 },
              { agent_completion_reason: "completed", total_ms: 1000, turns_to_completion: 3, usage_output_tokens: 150, final_turn_output_tokens: 100 },
            ],
          },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.n).toBe(4);
    expect(row.task_completion_rate).toBe(0.5); // 2/4
    expect(row.stall_rate).toBe(0.25);
    expect(row.budget_exhausted_rate).toBe(0.25);
    expect(row.thinking_budget_rate).toBe(0.25); // 1/4
  });

  it("task_ms_median·turns_median 은 완료 런만 대상", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_mock_v1",
            api_route: "chat_completions",
            runs: [
              completed({ total_ms: 1000, turns_to_completion: 2 }),
              completed({ total_ms: 3000, turns_to_completion: 6 }),
              // 정체 런의 total_ms 는 과업시간이 아니므로 중앙값에서 제외돼야 한다.
              { agent_completion_reason: "stall", total_ms: 99999, usage_output_tokens: 300 },
            ],
          },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.task_ms_median).toBe(2000); // (1000+3000)/2, 정체 99999 제외
    expect(row.turns_median).toBe(4); // (2+6)/2
  });

  it("output_efficiency = Σ최종턴토큰 / Σusage (완료+양쪽 존재+usage>0), 근사 폴백 없음", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_mock_v1",
            api_route: "chat_completions",
            runs: [
              completed({ final_turn_output_tokens: 100, usage_output_tokens: 400 }),
              completed({ final_turn_output_tokens: 100, usage_output_tokens: 100 }),
              // 완료지만 final_turn 토큰 부재 → 효율에서 제외(근사 안 함).
              completed({ final_turn_output_tokens: undefined, usage_output_tokens: 500 }),
            ],
          },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    // Σfinal=200, Σusage=500 → 0.4 (세 번째 런은 양쪽 조건 미충족이라 제외)
    expect(row.output_efficiency).toBeCloseTo(0.4, 6);
  });

  it("tool_arg_fidelity = Σhits/Σattempts; arg_attempt_rate 는 시도한 런 비율(포기 분리)", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_grounding_v1",
            api_route: "chat_completions",
            runs: [
              completed({ tool_arg_hits: 2, tool_arg_attempts: 2 }),
              completed({ tool_arg_hits: 1, tool_arg_attempts: 2 }),
              // 호출 자체를 포기(attempts=0) — fidelity 분모엔 안 들어가지만 시도율은 떨어뜨린다.
              completed({ tool_arg_hits: 0, tool_arg_attempts: 0 }),
            ],
          },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.tool_arg_fidelity).toBeCloseTo(3 / 4, 6); // (2+1+0)/(2+2+0)
    expect(row.arg_attempt_rate).toBeCloseTo(2 / 3, 6); // 3런 중 2런이 attempts>0
  });

  it("argDispatch 카운터 없는(레거시/미측정) 런만이면 fidelity·attempt_rate = null", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          { id: "agent_loop_mock_v1", api_route: "chat_completions", runs: [completed(), completed()] },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.tool_arg_fidelity).toBeNull();
    expect(row.arg_attempt_rate).toBeNull();
  });

  it("완료 런이 없으면 task_ms_median·turns_median·output_efficiency = null", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          { id: "agent_loop_budget_v1", api_route: "chat_completions", runs: [{ agent_completion_reason: "stall", total_ms: 500, usage_output_tokens: 300 }] },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.task_completion_rate).toBe(0);
    expect(row.task_ms_median).toBeNull();
    expect(row.turns_median).toBeNull();
    expect(row.output_efficiency).toBeNull();
  });

  it("agent 아닌 시나리오·completion_reason 없는 런은 제외", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          { id: "chat_hello", api_route: "chat_completions", runs: [completed()] }, // agent 아님
          { id: "agent_loop_mock_v1", api_route: "chat_completions", runs: [
            completed(),
            { agent_completion_reason: null, total_ms: 1, usage_output_tokens: 1 }, // malformed
          ] },
        ],
      },
    ];
    const rows = agentMetricsFromBenchDetails(details);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.n).toBe(1); // 완료 1건만(chat_hello·malformed 제외)
  });

  it("라우트 분리(chat vs messages)", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          { id: "agent_loop_mock_v1", api_route: "chat_completions", runs: [completed()] },
          { id: "agent_loop_mock_v1", api_route: "messages", runs: [completed()] },
        ],
      },
    ];
    const rows = agentMetricsFromBenchDetails(details);
    expect(rows.map((r) => r.api_route).sort()).toEqual(["chat_completions", "messages"]);
  });

  // TPS 역전 재현: A는 raw usage(토큰)가 커 tps는 높아 보이나 전부 정체(completion 0);
  // B는 완주(completion 1, 적정 usage). agent_metrics 가 speed 그룹과 반대 서사를 준다.
  it("역전 fixture: 과사고 A(정체 3, 고 usage) vs 절제 B(완료)", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "A_overthinker" },
        scenarios: [
          { id: "agent_loop_budget_v1", api_route: "chat_completions", runs: [
            { agent_completion_reason: "stall", thinking_exhausted_budget: true, total_ms: 800, usage_output_tokens: 360 },
            { agent_completion_reason: "stall", thinking_exhausted_budget: true, total_ms: 820, usage_output_tokens: 360 },
            { agent_completion_reason: "stall", thinking_exhausted_budget: true, total_ms: 790, usage_output_tokens: 360 },
          ] },
        ],
      },
      {
        meta: { model_id: "B_disciplined" },
        scenarios: [
          { id: "agent_loop_budget_v1", api_route: "chat_completions", runs: [
            completed({ total_ms: 2000, turns_to_completion: 4, usage_output_tokens: 180, final_turn_output_tokens: 120 }),
          ] },
        ],
      },
    ];
    const rows = agentMetricsFromBenchDetails(details);
    const a = rows.find((r) => r.model_id === "A_overthinker")!;
    const b = rows.find((r) => r.model_id === "B_disciplined")!;
    expect(a.task_completion_rate).toBe(0);
    expect(a.thinking_budget_rate).toBe(1);
    expect(a.task_ms_median).toBeNull(); // 완료 0건
    expect(a.output_efficiency).toBeNull();
    expect(b.task_completion_rate).toBe(1);
    expect(b.thinking_budget_rate).toBe(0);
    expect(b.output_efficiency).toBeCloseTo(120 / 180, 6);
  });
});

describe("server ≡ browser agent-metrics parity", () => {
  const runs: AgentRunInput[] = [completed(), { agent_completion_reason: "stall", usage_output_tokens: 300 }];
  const details: AgentBenchDetailInput[] = [
    { meta: { model_id: "A" }, scenarios: [{ id: "agent_loop_mock_v1", api_route: "chat_completions", runs }] },
  ];
  const rows: AgentResultRow[] = [
    { model_id: "A", api: "chat_completions", rowKey: "k1", scenario: "agent_loop_mock_v1" },
  ];
  const aggregate = { k1: { runs } };

  it("agentMetricsFromRows ≡ agentMetricsFromBenchDetails", () => {
    expect(agentMetricsFromRows(rows, aggregate)).toEqual(agentMetricsFromBenchDetails(details));
  });

  it("웹 경로도 agent 아닌 rows는 제외", () => {
    const mixed: AgentResultRow[] = [
      ...rows,
      { model_id: "A", api: "chat_completions", rowKey: "k2", scenario: "chat_hello" },
    ];
    const agg = { ...aggregate, k2: { runs: [completed()] } };
    expect(agentMetricsFromRows(mixed, agg)).toEqual(agentMetricsFromBenchDetails(details));
  });
});

// #108 후속: 라우트별 품질 + 워크플로 준수율(점수 미반영 진단 지표).
describe("quality_mean / workflow_adherence_mean", () => {
  it("quality_mean 은 rubric 정규화 점수(0~1)의 평균 — 라우트별 발산을 드러낸다", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_mock_v1",
            api_route: "chat_completions",
            runs: [completed({ quality: { score: 1 } }), { agent_completion_reason: "stall", quality: { score: 0 } }],
          },
          {
            id: "agent_loop_mock_v1",
            api_route: "messages",
            runs: [completed({ quality: { score: 1 } }), completed({ quality: { score: 1 } })],
          },
        ],
      },
    ];
    const rows = agentMetricsFromBenchDetails(details);
    const chat = rows.find((r) => r.api_route === "chat_completions")!;
    const msgs = rows.find((r) => r.api_route === "messages")!;
    expect(chat.quality_mean).toBeCloseTo(0.5, 6); // 정체가 chat 에만
    expect(msgs.quality_mean).toBe(1);
  });

  it("workflow_adherence_mean = 지시 도구 중 실제로 부른 비율의 평균", () => {
    const details: AgentBenchDetailInput[] = [
      {
        meta: { model_id: "M" },
        scenarios: [
          {
            id: "agent_loop_mock_v1", // 지시 도구 3종
            api_route: "chat_completions",
            runs: [
              completed({ tool_call_counts: { read_document: 1, wiki_search: 1, wiki_read: 1 } }), // 3/3
              completed({ tool_call_counts: { read_document: 1 } }), // 1/3 — 단축
            ],
          },
        ],
      },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.workflow_adherence_mean).toBeCloseTo((1 + 1 / 3) / 2, 6);
    // 단축은 **점수에 반영되지 않는다** — 완료율은 그대로 1.
    expect(row.task_completion_rate).toBe(1);
  });

  it("레거시(필드 부재) 런만이면 둘 다 null", () => {
    const details: AgentBenchDetailInput[] = [
      { meta: { model_id: "M" }, scenarios: [{ id: "agent_loop_mock_v1", api_route: "chat_completions", runs: [completed()] }] },
    ];
    const [row] = agentMetricsFromBenchDetails(details);
    expect(row.quality_mean).toBeNull();
    expect(row.workflow_adherence_mean).toBeNull();
  });
});
