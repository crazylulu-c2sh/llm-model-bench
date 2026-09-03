import type { Page, Route } from "@playwright/test";

/**
 * e2e 기본 API 스텁 — "백엔드가 살아 있고 DB가 비어 있는" 상태를 모든 스펙에 깔아 준다.
 *
 * e2e webServer는 `vite preview`(정적 프리뷰)라 백엔드가 없다. 그런데 vite의 `server.proxy`가
 * preview에도 상속돼 스텁하지 않은 `/api/*`는 `VITE_API_URL`(기본 `http://127.0.0.1:20080`)로
 * **밖으로 나간다**. 그래서 지금까지:
 *  - CI에서는 ECONNREFUSED로 앱이 열화된 상태(예: `dynamicScenarioIds`가 빈 Set)로 테스트됐고,
 *  - 개발 기계에서는 20080의 진짜 백엔드가 실제 데이터로 응답해 **로컬과 CI가 다른 앱**을 봤다.
 *
 * 여기서 그 구멍을 막는다. 응답 본문은 전부 실서버에서 직접 캡처한 형태다(추측 금지) —
 * 목록류는 "빈 DB"에 해당하는 빈 배열이고, 행이 필요한 스펙은 자기 `page.route`로 덮어쓴다.
 *
 * `helpers/`는 playwright testMatch(`**\/*.spec.ts`)에 걸리지 않으므로 테스트로 수집되지 않는다.
 */

// ---------------------------------------------------------------- 시나리오 카탈로그

/**
 * 빌트인 agent_loop 6종과 각자의 `maxTurns`.
 * (원본: packages/shared/src/agent-loop-builtin.ts — budget은 mock을 스프레드해 6을 물려받는다.)
 */
const BUILTIN_AGENT_SCENARIOS: ReadonlyArray<{ id: string; maxTurns: number }> = [
  { id: "agent_loop_mock_v1", maxTurns: 6 },
  { id: "agent_loop_budget_v1", maxTurns: 6 },
  { id: "agent_loop_docs_v1", maxTurns: 8 },
  { id: "agent_loop_error_v1", maxTurns: 8 },
  { id: "agent_loop_grounding_v1", maxTurns: 8 },
  { id: "agent_loop_chain_v1", maxTurns: 8 },
];

/** 공개(텍스트 8 + 비전 10) + 스트레스 7. agent_loop이 아닌 나머지 25건. */
const NON_AGENT_SCENARIO_IDS: readonly string[] = [
  "chat_hello",
  "chat_ping",
  "chat_time_calendar",
  "tool_weather",
  "structured_action",
  "code_sort_js",
  "code_sort_py",
  "translate_nist_fips197_pdf_tools",
  "vision_table_ocr_a",
  "vision_table_ocr_b",
  "vision_count_red_cars_a",
  "vision_count_red_cars_b",
  "vision_chart_peak_a",
  "vision_chart_peak_b",
  "vision_meme_explain_a",
  "vision_meme_explain_b",
  "vision_wireframe_html_a",
  "vision_wireframe_html_b",
  "stress_ping",
  "stress_short_reply",
  "stress_short_reply_ko",
  "stress_short_reply_ja",
  "stress_long_context",
  "stress_long_context_ko",
  "stress_long_context_ja",
];

/**
 * `GET /api/scenarios?set=all`의 `scenarios[]` — 실서버와 같은 31건.
 *
 * 서버는 항목마다 category·prompt·meta까지 실어 보내지만 **웹은 `{id, source, isAgentLoop, maxTurns}`
 * 4개만 읽는다**(apps/web/src/App.tsx 343-355행: `source === "custom" || isAgentLoop`인 것만 골라
 * `dynamicScenarioIds`를 만든다). 그 파생값이 실제와 같아지는 게 이 스텁의 목적이라 4개만 채운다.
 */
export const DEFAULT_SCENARIO_ITEMS: ReadonlyArray<{
  id: string;
  source: string;
  isAgentLoop: boolean;
  maxTurns: number | null;
}> = [
  ...NON_AGENT_SCENARIO_IDS.map((id) => ({ id, source: "builtin", isAgentLoop: false, maxTurns: null })),
  ...BUILTIN_AGENT_SCENARIOS.map(({ id, maxTurns }) => ({
    id,
    source: "builtin",
    isAgentLoop: true,
    maxTurns,
  })),
];

// ---------------------------------------------------------------- 기본 응답 본문

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * `METHOD /pathname` → 응답. 표에 없는 조합은 `route.fallback()`으로 누수 catch-all에 넘긴다
 * (= 우리가 예상하지 못한 엔드포인트라는 뜻이고, 그게 가드가 잡아야 할 대상이다).
 *
 * 여기 없는 엔드포인트(`/api/detect`, `/api/bench/**`, `/api/runs/**` 등)는 **일부러** 비워 뒀다.
 * 사용자 조작으로만 불리는 것들이라, 그걸 건드리는 스펙이 자기 목업을 갖는 게 맞다.
 */
const DEFAULT_API_STUBS: Record<string, (route: Route) => Promise<void>> = {
  // apps/web/src/components/WslLoopbackHint.tsx — `wsl_windows_host`가 null이면 힌트를 안 그린다.
  "GET /api/health": (route) =>
    json(route, { ok: true, service: "llm-bench-server", wsl_windows_host: null }),

  // apps/web/src/lib/base-url-names.ts — 별칭 없는 DB. 별칭이 필요한 스펙은 직접 덮어쓴다.
  // (PUT은 표에 없다 → fallback → 누수로 잡힌다. 저장을 누르는 스펙은 스토어 목업을 직접 건다.)
  "GET /api/base-url-names": (route) => json(route, { items: [], sqlite_available: true }),

  // apps/web/src/App.tsx — 마운트 시 1회. 실서버와 같은 31건이라야 dynamicScenarioIds가 실제와 같다.
  "GET /api/scenarios": (route) => json(route, { scenarios: DEFAULT_SCENARIO_ITEMS }),

  // apps/web/src/StatsPage.tsx — 빈 DB. 항목 형태는 run_id/model_id/publisher/base_url/provider/
  // finished_at/created_at/status/scenario_count/categories/leaks (stats-nav·a11y 스펙이 채워 쓴다).
  "GET /api/stats/model-latest": (route) => json(route, { items: [], sqlite_available: true }),

  // apps/web/src/StressStatsPage.tsx — 빈 DB + 빈 필터 옵션.
  "GET /api/stress/runs": (route) =>
    json(route, {
      items: [],
      filter_options: { workload_ids: [], statuses: [], model_ids: [], base_urls: [] },
      has_more: false,
      sqlite_available: true,
    }),

  // apps/web/src/ProviderMonitorPage.tsx — lms CLI 미설치/비활성.
  "GET /api/monitor/lms/availability": (route) =>
    json(route, { enabled: false, remoteLoopback: false, binary: null }),

  // apps/web/src/ProviderMonitorPage.tsx · components/ProviderMemoryWidget.tsx.
  // 브라우저가 프리뷰 오리진(127.0.0.1:4174)에서 붙으므로 실서버도 `client_not_loopback`으로
  // system/gpu를 null로 내린다 — 그 상태를 그대로 흉내 낸다.
  "POST /api/monitor/snapshot": (route) => {
    // 폴링 요청이라 페이지 전환 중 바디가 비어 올 수 있다 — postDataJSON()은 그때 throw한다.
    // (`as typeof body`로 캐스팅하면 그 시점의 좁혀진 타입인 `null`이 잡혀 아래 접근이 never가 된다.)
    type SnapshotBody = { baseUrl?: string; provider?: string };
    let body: SnapshotBody | null = null;
    try {
      body = route.request().postDataJSON() as SnapshotBody;
    } catch {
      body = null;
    }
    return json(route, {
      ts: "2026-01-01T00:00:00.000Z",
      localhost: true,
      remoteLoopback: false,
      reason: "client_not_loopback",
      system: null,
      gpu: null,
      provider: {
        kind: body?.provider ?? "lm_studio",
        baseUrl: body?.baseUrl ?? "http://127.0.0.1:1234",
        source: "http",
        loaded: [],
        http: { ok: true, status: 200 },
      },
    });
  },
};

/**
 * 기본 스텁을 건다. **반드시 누수 catch-all보다 나중에** 불러야 한다(뒤에 건 route가 이긴다) —
 * 순서 계약은 helpers/fixtures.ts에 적혀 있다.
 */
export async function installDefaultApiStubs(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const stub = DEFAULT_API_STUBS[`${req.method()} ${new URL(req.url()).pathname}`];
    try {
      // 모르는 엔드포인트는 아래(먼저 등록된) catch-all로 — 거기서 503 + 누수 기록.
      await (stub ? stub(route) : route.fallback());
    } catch {
      // 단언이 끝나 페이지가 먼저 닫히면 fulfill/fallback이 실패한다(모니터 폴링 등) — 실패가 아니다.
    }
  });
}
