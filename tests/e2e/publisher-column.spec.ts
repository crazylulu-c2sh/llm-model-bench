import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

/**
 * Publisher 2줄 표시 회귀 게이트.
 *
 * 별도 게시자 열을 없애고 ModelLabel 1줄(게시자)+2줄(id)로 합쳤다.
 * 서버 publisher 우선 / id 접두 폴백 / bare 모델 "—" 를 같은 모델 셀 안에서 검증한다.
 *
 * 표시명은 게시자 접두를 벗겨 중복을 피하므로, 행 찾기는 가시 텍스트의 `org/id` 연속 문자열이
 * 아니라 `title={modelId}`(전체 id)로 한다.
 */

const BASE_URL = "http://localhost:1234/v1";

const STATS_MODELS = [
  { model_id: "prefix-org/model-named", publisher: "Detect Org" },
  { model_id: "legacy-org/model-plain" },
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
/** title에 전체 model_id가 있으므로 접두 제거 후에도 행을 찾을 수 있다. */
const stressRow = (page: Page, modelId: string) =>
  page.getByRole("row").filter({ has: page.locator(`[title="${modelId}"]`) });

/** 모델 셀(게시자 2줄 포함) — 선택 열 다음 첫 데이터 셀. */
const statsModelCell = (page: Page, modelId: string) =>
  statsRow(page, modelId).getByRole("cell").nth(1);
const stressModelCell = (page: Page, modelId: string) =>
  stressRow(page, modelId).getByRole("cell").nth(0);

test.describe("저장된 모델 표 Publisher 2줄", () => {
  test("서버가 준 publisher를 쓰고, 없으면 model_id org 접두로 폴백한다", async ({ page }) => {
    await mockStats(page);
    await page.goto("/stats");

    await expect(statsModelCell(page, "prefix-org/model-named")).toContainText("Detect Org");
    await expect(statsModelCell(page, "legacy-org/model-plain")).toContainText("legacy-org");
    await expect(statsModelCell(page, "bare-model")).toContainText("—");
  });

  test("텍스트 검색이 publisher도 매칭한다", async ({ page }) => {
    await mockStats(page);
    await page.goto("/stats");

    const search = page.getByPlaceholder(/게시자/);
    await search.fill("Detect Org");
    await expect(statsRow(page, "prefix-org/model-named")).toBeVisible();
    await expect(statsRow(page, "bare-model")).toHaveCount(0);

    await search.fill("legacy-org");
    await expect(statsRow(page, "legacy-org/model-plain")).toBeVisible();
    await expect(statsRow(page, "prefix-org/model-named")).toHaveCount(0);
  });
});

test.describe("스트레스 런 목록 Publisher 2줄", () => {
  test("서버가 준 publisher를 쓰고, 없으면 model_id org 접두로 폴백한다", async ({ page }) => {
    await mockStress(page);
    await page.goto("/provider-stats");

    await expect(stressModelCell(page, "prefix-org/stress-named")).toContainText("Detect Org S");
    await expect(stressModelCell(page, "legacy-org/stress-plain")).toContainText("legacy-org");
    await expect(stressModelCell(page, "bare-stress-model")).toContainText("—");
  });
});
