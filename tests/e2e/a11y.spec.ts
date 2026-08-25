import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * KWCAG 2.2 / WCAG 2.1 AA 자동 점검: 각 라우트를 axe-core로 스캔한다.
 * e2e webServer는 백엔드 없이 정적 프리뷰만 띄우므로 데이터가 채워진 /stats 케이스는
 * stats-nav.spec.ts와 같은 page.route 목업 패턴을 재사용한다.
 * 기본 테마는 다크(colorScheme: "dark") — 라이트 테마는 /와 /stats만 별도 스캔한다.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const ROUTES = ["/", "/stats", "/stress", "/provider-stats", "/profile", "/provider-monitor", "/scenarios", "/harness"] as const;

/**
 * axe의 color-contrast 규칙은 실행 중인 트랜지션의 *중간 프레임 합성색*을 그대로 읽는다.
 * 백엔드 없는 프리뷰에서 /api 호출이 실패하면 sonner 에러 토스트가 0.4s 페이드인하는데,
 * 그 중간이 잡히면 대비가 1.5~2.5로 계산돼 스캔이 무작위로 실패한다(정착 후에는 통과).
 * `transition-duration: 0s`를 덮어써도 *이미 실행 중인* 트랜지션은 끊기지 않으므로,
 * 실행 중인 애니메이션이 끝날 때까지 기다린 뒤 스캔한다. 모달·드로어 전환에도 동일하게 적용된다.
 * 무한 애니메이션(스피너 등)은 finished가 영영 resolve되지 않으므로 타임아웃과 경합시킨다.
 * 1패스가 끝나는 사이 새 토스트가 시작될 수 있어 2패스 돌린다.
 */
async function settleAnimations(page: Page) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(
      async (timeoutMs) =>
        void (await Promise.all(
          document.getAnimations().map((a) =>
            Promise.race([
              a.finished.catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ]),
          ),
        )),
      1000,
    );
  }
}

async function expectNoViolations(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

const BASE_URL = "http://localhost:1234/v1";
// 두 번째 Base URL — 통계 표의 Base URL 필터 드롭다운(2개 이상)과 별칭 표시까지 스캔 대상에 포함.
const BASE_URL_2 = "http://other.example:8080/v1";
const MODEL_COUNT = 3;
const SCENARIO_COUNT = 12;

const MODELS = Array.from({ length: MODEL_COUNT }, (_, i) => ({
  run_id: `run_${i}`,
  model_id: `bench-model-${i}`,
  base_url: i === 2 ? BASE_URL_2 : BASE_URL,
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
  // Base URL 별칭(이름 + 기기/스펙) — 셀 표시·필터 옵션 라벨까지 axe 대상에 포함.
  await page.route("**/api/base-url-names", (route: Route) =>
    route.fulfill({
      json: {
        items: [
          { base_url: BASE_URL, name: "Mock Host A", note: "RTX 4060 8GB" },
          { base_url: BASE_URL_2, name: "Mock Host B" },
        ],
        sqlite_available: true,
      },
    }),
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

  // Base URL 별칭(이름 + 기기/스펙) 편집 모달 열림 상태를 axe로 스캔.
  test("axe: /stats Base URL 이름 붙이기 모달 열림 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await mockStatsApi(page);
    await page.goto("/stats");
    await page.getByRole("button", { name: /이름 붙이거나 바꾸기/ }).first().click();
    await expect(page.getByRole("heading", { name: "Base URL에 이름 붙이기" })).toBeVisible();
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

/**
 * 백엔드가 없을 때 뜨는 에러 토스트는 실제 사용자에게 보이는 상태다. 로컬에 dev 서버가
 * 떠 있으면 프리뷰 프록시가 성공해 토스트가 안 뜨므로, 라우트를 끊어 CI와 같은 조건을 만든다.
 * (이 상태를 스캔하지 않고 스텁으로 가리면 라이트 테마 대비 미달이 그대로 묻힌다 — 실제로 그랬다.)
 */
test.describe("axe: 백엔드 다운(에러 토스트) 상태", () => {
  for (const [label, colorScheme] of [
    ["다크", "dark"],
    ["라이트", "light"],
  ] as const) {
    test(`axe: /stats 에러 토스트 (${label}) WCAG 2.1 AA 위반 없음`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(
        (theme) => localStorage.setItem("llm-bench-theme", theme),
        colorScheme,
      );
      await page.route("**/api/**", (route) => route.abort("connectionrefused"));
      await page.goto("/stats");
      await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
      await expectNoViolations(page);
    });
  }
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
