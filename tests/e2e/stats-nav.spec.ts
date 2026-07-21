import { test, expect, type Route } from "@playwright/test";

/**
 * 회귀: 모델 통계(/stats)에서 모델을 선택하면 무거운 차트/스코어보드/결과표 서브트리가 마운트된다.
 * react-router 7의 BrowserRouter는 기본적으로 위치 변경을 React.startTransition으로 감싸므로,
 * 이 서브트리가 마운트된 뒤에는 라우트 스왑(저우선 트랜지션)이 커밋되지 못해 "주소만 바뀌고 내용은 그대로"
 * 증상이 났다. main.tsx의 `useTransitions={false}`가 내비게이션을 동기 레인으로 돌려 항상 커밋되게 한다.
 * 이 테스트는 선택 → 다른 탭 클릭 시 실제로 목적지 내용이 렌더되는지를 검증한다.
 *
 * e2e webServer는 백엔드 없이 정적 프리뷰만 띄우므로 stats API는 page.route로 목업한다.
 */

const BASE_URL = "http://localhost:1234/v1";
const MODEL_COUNT = 6;
const SCENARIO_COUNT = 12;

const MODELS = Array.from({ length: MODEL_COUNT }, (_, i) => ({
  run_id: `run_${i}`,
  model_id: `bench-model-${i}`,
  base_url: BASE_URL,
  provider: "lm_studio",
  finished_at: "2026-07-09T10:00:00.000Z",
  created_at: "2026-07-09T09:00:00.000Z",
  status: "completed",
  scenario_count: SCENARIO_COUNT,
}));

function runDetail(runId: string, modelId: string) {
  const scenarios = Array.from({ length: SCENARIO_COUNT }, (_, s) => ({
    id: `scenario_${String(s + 1).padStart(2, "0")}`,
    api_route: s % 2 === 0 ? "chat_completions" : "messages",
    prompt_system_preview: "system prompt preview",
    prompt_preview: "user prompt preview",
    runs: [
      {
        ttft_ms: 120 + s * 15,
        total_ms: 1000 + s * 120,
        output_text: "x".repeat(200 + s * 20),
        stream_completed: true,
        usage_output_tokens: 200 + s * 20,
        quality: { pass: true, score: 1 },
      },
    ],
  }));
  return {
    meta: {
      run_id: runId,
      base_url: BASE_URL,
      provider: "lm_studio",
      model_id: modelId,
      created_at: "2026-07-09T09:00:00.000Z",
    },
    scenarios,
  };
}

test("stats: 모델 선택 후 다른 탭으로 실제 전환된다 (nav 트랜지션 미고갈)", async ({ page, baseURL }) => {
  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({ json: { items: MODELS, sqlite_available: true } }),
  );
  await page.route("**/api/runs/**", (route: Route) => {
    const runId = decodeURIComponent(route.request().url().split("/api/runs/")[1]?.split("?")[0] ?? "");
    const model = MODELS.find((m) => m.run_id === runId);
    return route.fulfill({ json: runDetail(runId, model?.model_id ?? "bench-model-x") });
  });

  await page.goto("/stats");
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav.getByRole("link", { name: "모델 통계" })).toHaveAttribute("aria-current", "page");

  // 표시된 선택 가능 모델 전체 선택 → 상세 로드 → 무거운 서브트리 마운트
  await page.getByRole("button", { name: "표시된 선택 가능 항목 전체 선택" }).click();
  await expect(page.getByRole("heading", { name: "스코어보드" })).toBeVisible();

  // 다른 탭 클릭: URL만이 아니라 실제 내용이 스왑되어야 한다.
  await nav.getByRole("link", { name: "모델 벤치" }).click();
  await expect(page).toHaveURL(new URL("/", baseURL!).href);
  await expect(page.getByRole("heading", { name: "모델 선택" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "스코어보드" })).toHaveCount(0);
});

/**
 * 회귀: 모델을 "증분"으로 선택하면(1개 렌더 → 2번째 추가) 결과표(ResultsTable)의 `data`가
 * 매 렌더 새 배열 참조가 되어 TanStack이 무한 재렌더 → 탭이 먹통이 되던 버그를 가드한다.
 * (일괄 선택은 이 발산을 안 타므로 못 잡는다 — 반드시 하나씩 추가해야 한다.)
 */
test("stats: 모델을 하나씩 추가해도 먹통이 되지 않는다", async ({ page }) => {
  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({ json: { items: MODELS, sqlite_available: true } }),
  );
  await page.route("**/api/runs/**", (route: Route) => {
    const runId = decodeURIComponent(route.request().url().split("/api/runs/")[1]?.split("?")[0] ?? "");
    const model = MODELS.find((m) => m.run_id === runId);
    return route.fulfill({ json: runDetail(runId, model?.model_id ?? "bench-model-x") });
  });

  await page.goto("/stats");

  // 1) 첫 모델 선택 → 단일 모델 결과 렌더
  await page.getByRole("checkbox", { name: "bench-model-0 선택" }).check();
  await expect(page.getByRole("heading", { name: "스코어보드" })).toBeVisible();

  // 2) 두 번째 모델 추가. 버그가 있으면 여기서 무한 재렌더로 .check()가 멈춘다.
  await page.getByRole("checkbox", { name: "bench-model-1 선택" }).check();
  await expect(page.getByText(/선택 2 \//)).toBeVisible();

  // 2모델 결과가 실제로 렌더되고(스코어보드에 두 모델), 메인 스레드가 살아있어야 한다.
  await expect(page.getByText("bench-model-0").first()).toBeVisible();
  await expect(page.getByText("bench-model-1").first()).toBeVisible();
  await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 50)));
});
