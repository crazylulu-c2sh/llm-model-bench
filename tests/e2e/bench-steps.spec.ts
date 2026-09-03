import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import {
  AXE_TAGS,
  makeDetect,
  mockBenchRunning,
  mockDetect,
  mockQueueStart,
  mockRunsApi,
  openStates,
  resultsTable,
  settleAnimations,
  stepButton,
  type QueuePlan,
} from "./helpers/bench-mocks";

/**
 * "/" 모델 벤치의 6단계 아코디언 — 국면 전이와 헤더 클릭 의미론 회귀 가드.
 *
 * 여기서 잡으려는 것들은 전부 파생 상태·전이라 단위 테스트(lib/bench-steps.test.ts)로 규칙을
 * 고정하고, 이 스펙은 그 규칙이 실제 DOM에 연결돼 있는지를 본다. 특히:
 *  - 모델 체크박스를 눌러도 열린 단계가 바뀌지 않을 것(진척도가 아니라 국면으로 계산)
 *  - 열린 단계를 다시 누르면 접힐 것(다른 카드가 대신 펼쳐지지 않을 것)
 *  - 실행이 시작되면 설정 단계들이 접히고 진행 단계가 열릴 것
 *
 * e2e webServer는 백엔드 없는 정적 프리뷰라 API를 page.route로 고정한다. 실행 경로는 모델
 * for-루프가 아니라 **서버 소유 큐**(`POST /bench/queue` 한 번 + 큐 이벤트 소비)이므로 목업도
 * 큐 계약을 따른다 — 예전 `/bench/stream` 스텁은 아무도 부르지 않아, 실행 테스트가 "실행 중"
 * 한순간만 스치고 통과하는 빈 가드가 된다.
 */

const BASE_URL = "http://localhost:1234/v1";
const QUEUE_ID = "e2e-queue-1";
const MODEL_IDS = ["bench-model-a", "bench-model-b"];
const DETECT = makeDetect({ baseUrl: BASE_URL, modelIds: MODEL_IDS });

/**
 * 시나리오 2건이 통과로 끝나는 최소 런. 모델마다 rows가 2개 생기므로 종료 후 결과 단계가 열린다.
 *
 * 두 번째는 **일부러 오염된 행**이다(#169). 깨끗한 런만 목업하던 시절의 axe 스캔은 결과 표의
 * 경고 배지를 한 번도 훑지 못했고, 그래서 "role 없는 span의 aria-label은 무시된다"는 위반이
 * 실서버 데이터에서야 드러났다. 여기서 두 배지를 항상 렌더해 그 경로를 스캔 안으로 끌어들인다.
 */
const SCENARIOS = [
  { id: "chat_hello", api: "chat_completions" as const },
  {
    id: "code_sort_js",
    api: "chat_completions" as const,
    channelTagLeak: true,
    reasoningHidden: true,
  },
];
/** 오염 배지가 붙는 행의 시나리오 id — 배지 단언이 깨끗한 행을 잡지 않도록 이름으로 좁힌다. */
const CONTAMINATED_SCENARIO = SCENARIOS[1].id;
const PLAN: QueuePlan = {
  scenario_ids: SCENARIOS.map((s) => s.id),
  api_routes: ["chat_completions"],
  warmup_runs: 1,
  measured_runs: 3,
};

async function mockBackend(page: Page) {
  await mockDetect(page, DETECT);
  await mockRunsApi(page, { baseUrl: BASE_URL });
  // 감지 성공 직후 앱이 곧바로 부른다 — 살아 있는 큐가 없어야 새 실행 경로를 탄다.
  await mockBenchRunning(page);
  await mockQueueStart(page, { queueId: QUEUE_ID, baseUrl: BASE_URL, plan: PLAN, scenarios: SCENARIOS });
}

async function detectAndSelectFirstModel(page: Page) {
  await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
  await expect(stepButton(page, 4)).toHaveAttribute("aria-expanded", "true");
  await page.locator("#bench-step-4-body tbody input[type=checkbox]").first().check();
}

function queueChips(page: Page) {
  return page.getByRole("list", { name: /Run queue status|실행 큐 상태/ });
}

const CONTAMINATION_NAME = /엔진 프로토콜 회귀 의심|engine protocol regression/;
const REASONING_HIDDEN_NAME = /추론 숨김|Reasoning hidden/;

/**
 * 결과 표의 경고 배지 — 이름(aria-label)으로 찾는다.
 *
 * 배지는 aria-hidden 아이콘 하나뿐이라 `role="img"`가 없으면 aria-label이 무시되고
 * 접근 가능한 이름이 0이 된다(#169). 그러면 이 로케이터가 먼저 비어서 실패한다 —
 * 배지가 스크린리더에서 사라지는 회귀를 axe보다 먼저 잡는 가드다.
 * (모델 셀의 벤더 아이콘도 role="img"라, 이름 없이 role만으로 세면 안 된다.)
 */
function warnBadge(page: Page, scenarioId: string, name: RegExp) {
  return resultsTable(page).locator("tbody tr").filter({ hasText: scenarioId }).getByRole("img", { name });
}

/**
 * 실행 → 큐 종료까지. 칩이 "완료"로 바뀌는 것을 먼저 기다린다 — 큐 이벤트가 실제로 흐른 뒤에만
 * 일어나는 변화라, 목업이 죽어 있을 때 "실행 중" 한순간을 스치고 통과하는 일이 없다.
 */
async function runSelectedModelsAndWait(page: Page) {
  await page.getByRole("button", { name: /Run bench on selected models|선택 모델 벤치 실행/ }).click();
  await page.getByRole("button", { name: /^(Run bench|벤치 실행)$/ }).click();
  await expect(queueChips(page)).toContainText(/done|완료/, { timeout: 15_000 });
  // 헤더 진행률 바는 running일 때만 렌더된다 — 사라지면 큐 스트림이 닫힌 것.
  await expect(page.getByRole("progressbar")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("모델 벤치 6단계 아코디언", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
  });

  test("첫 진입은 연결 단계만 열려 있다", async ({ page }) => {
    expect(await openStates(page)).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  test("열린 단계를 다시 누르면 접힌다 — 다른 카드가 대신 펼쳐지지 않는다", async ({ page }) => {
    await stepButton(page, 3).click();
    expect(await openStates(page)).toEqual(["false", "false", "true", "false", "false", "false"]);

    await stepButton(page, 3).click();
    expect(await openStates(page)).toEqual(["false", "false", "false", "false", "false", "false"]);
  });

  test("감지에 성공하면 모델 선택 단계로 넘어간다", async ({ page }) => {
    await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
    await expect(stepButton(page, 4)).toHaveAttribute("aria-expanded", "true");
    await expect(stepButton(page, 1)).toHaveAttribute("aria-expanded", "false");
  });

  test("모델을 고르는 동안 단계가 접히지 않는다", async ({ page }) => {
    await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
    await expect(stepButton(page, 4)).toHaveAttribute("aria-expanded", "true");

    // 진척도로 계산하면 첫 체크박스에서 단계가 완료 처리되어 표가 사라지고 두 번째 모델을 고를 수 없다.
    const boxes = page.locator("#bench-step-4-body tbody input[type=checkbox]");
    await boxes.first().check();
    expect(await openStates(page)).toEqual(["false", "false", "false", "true", "false", "false"]);
    await boxes.nth(1).check();
    expect(await openStates(page)).toEqual(["false", "false", "false", "true", "false", "false"]);
  });

  test("실행하면 설정 단계가 접히고 진행·결과 단계가 열린다", async ({ page }) => {
    await detectAndSelectFirstModel(page);
    await runSelectedModelsAndWait(page);

    // 큐가 끝난 뒤 결과가 남아 있어야 6단계가 계속 열려 있다 — 실행 중 한순간이 아니라 종료 상태를 본다.
    await expect(stepButton(page, 6)).toHaveAttribute("aria-expanded", "true");
    expect((await openStates(page)).slice(0, 4)).toEqual(["false", "false", "false", "false"]);

    // 큐 스트림의 metrics_update가 실제 결과 행이 되었는지 — 목업이 계약에서 어긋나면 여기서 걸린다.
    const rows = resultsTable(page).locator("tbody tr");
    await expect(rows).toHaveCount(SCENARIOS.length);
    await expect(rows.first()).toContainText(SCENARIOS[0].id);
    await expect(rows.first()).toContainText(MODEL_IDS[0]);

    // 큐 칩이 남아 어느 모델이 어떻게 끝났는지 보인다.
    await expect(queueChips(page)).toBeVisible();
    await expect(queueChips(page).getByRole("listitem")).toHaveCount(1);
  });

  test("오염·추론 숨김 경고 배지에 접근 가능한 이름이 있다", async ({ page }) => {
    await detectAndSelectFirstModel(page);
    await runSelectedModelsAndWait(page);

    // 깨끗한 행에는 배지가 없어야 한다 — 플래그와 무관하게 늘 그린다면 경고가 의미를 잃는다.
    await expect(warnBadge(page, SCENARIOS[0].id, CONTAMINATION_NAME)).toHaveCount(0);
    await expect(warnBadge(page, SCENARIOS[0].id, REASONING_HIDDEN_NAME)).toHaveCount(0);
    await expect(warnBadge(page, CONTAMINATED_SCENARIO, CONTAMINATION_NAME)).toHaveCount(1);
    await expect(warnBadge(page, CONTAMINATED_SCENARIO, REASONING_HIDDEN_NAME)).toHaveCount(1);
  });

  test("axe: 실행 완료 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await detectAndSelectFirstModel(page);
    await runSelectedModelsAndWait(page);
    await expect(stepButton(page, 6)).toHaveAttribute("aria-expanded", "true");

    // 픽스처만 오염시켜 놓고 배지가 안 그려지면 이 스캔은 아무것도 못 본다(#169가 그래서 새어나갔다).
    // 배지가 실제로 화면에 있는지부터 못 박고 스캔한다.
    await expect(warnBadge(page, CONTAMINATED_SCENARIO, CONTAMINATION_NAME)).toHaveCount(1);
    await expect(warnBadge(page, CONTAMINATED_SCENARIO, REASONING_HIDDEN_NAME)).toHaveCount(1);

    await settleAnimations(page);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
