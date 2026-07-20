import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * KWCAG 2.2 / WCAG 2.1 AA 자동 점검: 각 라우트를 axe-core로 스캔한다.
 * e2e webServer는 백엔드 없이 정적 프리뷰만 띄우므로 데이터가 채워진 /stats 케이스는
 * stats-nav.spec.ts와 같은 page.route 목업 패턴을 재사용한다.
 * 기본 테마는 다크(colorScheme: "dark") — 라이트 테마는 /와 /stats만 별도 스캔한다.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const ROUTES = ["/", "/stats", "/stress", "/provider-stats", "/profile", "/provider-monitor", "/scenarios"] as const;

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

const BASE_URL = "http://localhost:1234/v1";
const MODEL_COUNT = 3;
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

async function mockStatsApi(page: Page) {
  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({ json: { items: MODELS, sqlite_available: true } }),
  );
  await page.route("**/api/runs/**", (route: Route) => {
    const runId = decodeURIComponent(route.request().url().split("/api/runs/")[1]?.split("?")[0] ?? "");
    const model = MODELS.find((m) => m.run_id === runId);
    return route.fulfill({ json: runDetail(runId, model?.model_id ?? "bench-model-x") });
  });
}

test.describe("axe: 다크 테마(기본)", () => {
  test.use({ colorScheme: "dark" });

  for (const route of ROUTES) {
    test(`axe: ${route} WCAG 2.1 AA 위반 없음`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
      await expectNoViolations(page);
    });
  }

  test("axe: /stats 데이터 채운 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await mockStatsApi(page);
    await page.goto("/stats");
    await page.getByRole("button", { name: "표시된 선택 가능 항목 전체 선택" }).click();
    await expect(page.getByRole("heading", { name: "스코어보드" })).toBeVisible();
    await expectNoViolations(page);
  });

  // 모달/드로어는 닫힌 동안 DOM에 없으므로(portal + return null) 열어 놓은 상태를 별도 스캔한다.
  test("axe: /stats 시나리오 상세 드로어 열림 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await mockStatsApi(page);
    await page.goto("/stats");
    await page.getByRole("button", { name: "표시된 선택 가능 항목 전체 선택" }).click();
    await page.getByRole("row", { name: /상세 열기/ }).first().click();
    await expect(page.getByRole("dialog", { name: "시나리오 상세" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("axe: /scenarios 비전 이미지 모달 열림 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await page.goto("/scenarios");
    const zoom = page.getByRole("button", { name: /이미지 확대/ }).first();
    await zoom.scrollIntoViewIfNeeded();
    await zoom.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: 라이트 테마", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("llm-bench-theme", "light"));
  });

  for (const route of ["/", "/stats"] as const) {
    test(`axe: ${route} (라이트) WCAG 2.1 AA 위반 없음`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
      await expectNoViolations(page);
    });
  }

  test("axe: /stats 데이터 채운 상태 (라이트) WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await mockStatsApi(page);
    await page.goto("/stats");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "표시된 선택 가능 항목 전체 선택" }).click();
    await expect(page.getByRole("heading", { name: "스코어보드" })).toBeVisible();
    await expectNoViolations(page);
  });
});
