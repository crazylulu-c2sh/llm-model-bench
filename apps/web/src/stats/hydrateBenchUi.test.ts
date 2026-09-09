import { describe, expect, it } from "vitest";
import type { BenchRunDetailResponse } from "../api-types";
import { mergeBenchDetailsToState } from "./hydrateBenchUi";

function detail(overrides: Partial<BenchRunDetailResponse["scenarios"][number]["runs"][number]> = {}): BenchRunDetailResponse {
  return {
    meta: {
      run_id: "run_1",
      base_url: "http://127.0.0.1:1234",
      provider: "lm_studio",
      model_id: "qwen/qwen3.8-27b",
      created_at: "2026-09-01T00:00:00.000Z",
    },
    scenarios: [
      {
        id: "chat_ping",
        api_route: "chat_completions",
        prompt_system_preview: null,
        prompt_preview: null,
        runs: [
          {
            ttft_ms: 10,
            total_ms: 100,
            output_text: "hi",
            stream_completed: true,
            usage_output_tokens: 7,
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe("mergeBenchDetailsToState — #182/#183 field relay", () => {
  it("relays usage_reasoning_tokens and reasoning_control_ignored from run into detailAggregate", () => {
    const { detailAggregate } = mergeBenchDetailsToState([
      detail({ usage_reasoning_tokens: 30, reasoning_control_ignored: true }),
    ]);
    const agg = Object.values(detailAggregate)[0];
    expect(agg?.runs[0]?.usage_reasoning_tokens).toBe(30);
    expect(agg?.runs[0]?.reasoning_control_ignored).toBe(true);
  });

  it("relays reasoning_control_ignored into the ResultRow used by the table", () => {
    const { rows } = mergeBenchDetailsToState([detail({ reasoning_control_ignored: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reasoning_control_ignored).toBe(true);
  });

  it("leaves reasoning_control_ignored undefined when the run doesn't carry it", () => {
    const { rows } = mergeBenchDetailsToState([detail()]);
    expect(rows[0]?.reasoning_control_ignored).toBeUndefined();
  });
});
