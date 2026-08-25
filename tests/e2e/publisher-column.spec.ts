import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Publisher 열(#151) 회귀 게이트.
 *
 * 웹 앱에 DOM 테스트 러너가 없어 `itemPublisher`(StatsModelTable)·`runPublisher`(StressStatsPage)의
 * 폴백과 텍스트 필터 매칭이 어느 계층에서도 검증되지 않았다. 두 헬퍼가 항상 ""를 반환하게 만들어도
 * 단위·e2e가 전부 통과하던 상태를 여기서 막는다.
 *
 * 서버는 이미 폴백을 적용해 내려주지만, SPA를 구버전 서버에 붙이는 배포(README의 `VITE_API_URL`)가
 * 문서화돼 있으므로 웹 쪽 폴백도 살아 있어야 한다 — publisher 없는 응답을 일부러 섞어 그 경로를 태운다.
 */

const BASE_URL = "http://localhost:1234/v1";

const STATS_MODELS = [
  // 서버가 publisher를 준 경우 — id 접두("prefix-org")가 아니라 이 값이 보여야 한다.
  { model_id: "prefix-org/model-named", publisher: "Detect Org" },
  // 구버전 서버 응답(publisher 없음) — 웹이 id 접두에서 파생해야 한다.
  { model_id: "legacy-org/model-plain" },
  // org 접두도 없는 모델 — 표시할 게 없으므로 "—".
  { model_id: "bare-model" },
].map((m, i) => ({
  run_id: `run_${i}`,
  base_url: BASE_URL,
  provider: "lm_studio",
  finished_at: "2026-07-09T10:00:00.000Z",
  created_at: "2026-07-09T09:00:00.000Z",
  status: "completed",
  scenario_count: 12,
  ...m,
}));

const STRESS_RUNS = [
  { model_id: "prefix-org/stress-named", publisher: "Detect Org S" },
  { model_id: "legacy-org/stress-plain" },
  { model_id: "bare-stress-model" },
].map((m, i) => ({
  run_id: `srun_${i}`,
  created_at: "2026-07-09T09:00:00.000Z",
  finished_at: "2026-07-09T10:00:00.000Z",
  base_url: BASE_URL,
  provider: "lm_studio",
  workload_id: "stress_ping",
  status: "ok" as const,
  ...m,
}));

async function mockStats(page: Page) {
  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({ json: { items: STATS_MODELS, sqlite_available: true } }),
  );
  await page.route("**/api/base-url-names", (route: Route) =>
    route.fulfill({ json: { items: [], sqlite_available: true } }),
  );
}

async function mockStress(page: Page) {
  await page.route("**/api/stress/runs?**", (route: Route) =>
    route.fulfill({
      json: {
        items: STRESS_RUNS,
        filter_options: {
          workload_ids: ["stress_ping"],
          statuses: ["ok"],
          model_ids: STRESS_RUNS.map((r) => r.model_id),
          base_urls: [BASE_URL],
        },
        has_more: false,
        sqlite_available: true,
      },
    }),
  );
  await page.route("**/api/base-url-names", (route: Route) =>
    route.fulfill({ json: { items: [], sqlite_available: true } }),
  );
}

const statsRow = (page: Page, modelId: string) =>
  page.getByRole("row", { name: `${modelId} 선택 토글` });
const stressRow = (page: Page, modelId: string) =>
  page.getByRole("row").filter({ hasText: modelId });

// 파생 게시자("legacy-org")는 model_id 셀에도 부분 문자열로 들어 있으므로 텍스트가 아니라
// 열 위치로 집는다. 저장된 모델 표: [선택, 모델, 게시자, ...] / 스트레스 목록: [모델, 게시자, ...]
const statsPublisherCell = (page: Page, modelId: string) =>
  statsRow(page, modelId).getByRole("cell").nth(2);
const stressPublisherCell = (page: Page, modelId: string) =>
  stressRow(page, modelId).getByRole("cell").nth(1);

test.describe("저장된 모델 표 Publisher 열", () => {
  test("서버가 준 publisher를 쓰고, 없으면 model_id org 접두로 폴백한다", async ({ page }) => {
    await mockStats(page);
    await page.goto("/stats");

    // 저장된 publisher가 id 접두("prefix-org")를 이긴다.
    await expect(statsPublisherCell(page, "prefix-org/model-named")).toHaveText("Detect Org");
    // publisher 없는 응답 → 웹이 접두에서 파생.
    await expect(statsPublisherCell(page, "legacy-org/model-plain")).toHaveText("legacy-org");
    // 둘 다 없으면 대시(빈 칸도 "undefined"도 아니어야 한다).
    await expect(statsPublisherCell(page, "bare-model")).toHaveText("—");
  });

  test("텍스트 검색이 publisher도 매칭한다", async ({ page }) => {
    await mockStats(page);
    await page.goto("/stats");

    const search = page.getByPlaceholder(/게시자/);
    await search.fill("Detect Org");
    await expect(statsRow(page, "prefix-org/model-named")).toBeVisible();
    await expect(statsRow(page, "bare-model")).toHaveCount(0);

    // 파생된 게시자도 검색돼야 한다(model_id에도 들어 있으므로 폴백이 죽어도 통과할 수 있어,
    // 위 "Detect Org" 케이스가 실질적인 게이트다).
    await search.fill("legacy-org");
    await expect(statsRow(page, "legacy-org/model-plain")).toBeVisible();
    await expect(statsRow(page, "prefix-org/model-named")).toHaveCount(0);
  });
});

test.describe("스트레스 런 목록 Publisher 열", () => {
  test("서버가 준 publisher를 쓰고, 없으면 model_id org 접두로 폴백한다", async ({ page }) => {
    await mockStress(page);
    await page.goto("/provider-stats");

    await expect(stressPublisherCell(page, "prefix-org/stress-named")).toHaveText("Detect Org S");
    await expect(stressPublisherCell(page, "legacy-org/stress-plain")).toHaveText("legacy-org");
    await expect(stressPublisherCell(page, "bare-stress-model")).toHaveText("—");
  });
});
