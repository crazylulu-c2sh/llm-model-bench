import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import {
  AXE_TAGS,
  makeDetect,
  makeRunDetail,
  mockBenchRunning,
  mockDetect,
  mockQueueReconnect,
  mockRunsApi,
  queueModel,
  queueStreamEvents,
  resultsTable,
  settleAnimations,
  type QueuePlan,
  type ScenarioFixture,
} from "./helpers/bench-mocks";

/**
 * 새로고침 후 서버 큐에 다시 붙는 화면 — "재접속한 탭"의 회귀 가드.
 *
 * 재접속한 탭에는 폼 상태(고른 모델·시나리오·라우트)가 하나도 없다. 예전에는 진행률·예약 행·ETA·
 * 스코어보드가 전부 그 폼에서 파생돼서, 새로고침하면 분모가 0이 되어 헤더가 "0/0 (0%)"에 굳고
 * 예약 칩과 복원한 결과가 통째로 사라졌다. 이제는 `GET /bench/running`의 큐 스냅샷이 계획의 단일
 * 소스이므로(lib/bench-run-plan.ts), 그 계획이 실제 DOM까지 도달하는지를 여기서 본다.
 *
 * 창(window) 이야기: `route.fulfill`은 본문을 한 번에 보내고 스트림을 닫는다. 그래서
 * `/bench/queue/:id/reconnect` 응답을 잠시 붙들어 두는 동안이 "재연결해서 실행 중"인 상태를
 * 관측할 수 있는 유일한 구간이다. 단언은 전부 그 안에서 끝나야 한다.
 */

const BASE_URL = "http://localhost:1234/v1";
const QUEUE_ID = "e2e-queue-reconnect";
const MODEL_IDS = ["recon-model-a", "recon-model-b", "recon-model-c"];
const DONE_RUN_ID = "recon-run-a";

/** 시나리오 2개 × 라우트 1개 × 모델 3개 = 진행률 분모 6. */
const SCENARIOS: ScenarioFixture[] = [
  { id: "chat_hello", api: "chat_completions", ttftMs: 120, totalMs: 800 },
  { id: "code_sort_js", api: "chat_completions", ttftMs: 220, totalMs: 1_600 },
];
const PLAN: QueuePlan = {
  scenario_ids: SCENARIOS.map((s) => s.id),
  api_routes: ["chat_completions"],
  warmup_runs: 1,
  measured_runs: 3,
};

/** 첫 모델은 끝났고(run_id 있음), 두 번째가 실행 중, 세 번째는 아직 예약 상태. */
const SNAPSHOT = {
  queue_id: QUEUE_ID,
  base_url: BASE_URL,
  provider: "lm_studio",
  status: "running",
  created_at: 1_700_000_000_000,
  finished_at: null,
  index: 1,
  paused: false,
  current_run_id: "recon-run-b",
  models: [
    queueModel({ modelId: MODEL_IDS[0], status: "done", runId: DONE_RUN_ID }),
    queueModel({ modelId: MODEL_IDS[1], status: "running", runId: "recon-run-b" }),
    queueModel({ modelId: MODEL_IDS[2], status: "pending" }),
  ],
  plan: PLAN,
};

/** replay는 큐 계획부터 다시 준다. 이미 끝난 0번 모델의 런 이벤트는 없다 — 그건 DB에서 복원한다. */
const REPLAY = queueStreamEvents({
  queueId: QUEUE_ID,
  baseUrl: BASE_URL,
  modelIds: MODEL_IDS,
  plan: PLAN,
  scenarios: SCENARIOS,
  fromIndex: 1,
  runIdFor: (modelId) => `${QUEUE_ID}-${modelId}`,
});

/**
 * 새로고침 직후를 흉내 낸다: 폼은 비어 있고, 연결하자마자 서버가 살아 있는 큐를 알려준다.
 * `holdMs`는 단언에 필요한 관측 창 — axe처럼 오래 걸리는 검사는 더 길게 잡는다.
 */
async function arriveOnReconnectingTab(page: Page, holdMs?: number) {
  await mockDetect(page, makeDetect({ baseUrl: BASE_URL, modelIds: MODEL_IDS }));
  await mockBenchRunning(page, { queues: [SNAPSHOT] });
  await mockQueueReconnect(page, { events: REPLAY, ...(holdMs != null ? { holdMs } : {}) });
  await mockRunsApi(page, {
    baseUrl: BASE_URL,
    detailByRunId: {
      [DONE_RUN_ID]: makeRunDetail({
        runId: DONE_RUN_ID,
        baseUrl: BASE_URL,
        modelId: MODEL_IDS[0],
        scenarios: SCENARIOS,
      }),
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
}

const queueChips = (page: Page) => page.getByRole("list", { name: /Run queue status|실행 큐 상태/ });

test.describe("서버 큐 재연결", () => {
  test("예약된 모델까지 큐 칩이 복원된다", async ({ page }) => {
    await arriveOnReconnectingTab(page);

    const chips = queueChips(page).getByRole("listitem");
    await expect(chips).toHaveCount(3);
    // 상태 텍스트는 sr-only span이라 getByRole/getByTitle로는 잡히지 않는다 — textContent로 본다.
    await expect(chips.nth(0)).toContainText(MODEL_IDS[0]);
    await expect(chips.nth(0)).toContainText(/done|완료/);
    await expect(chips.nth(1)).toContainText(MODEL_IDS[1]);
    await expect(chips.nth(1)).toContainText(/running|진행 중/);
    // 아직 시작도 안 한 모델이 사라지면 "몇 개 남았는지"를 화면에서 알 수 없다.
    await expect(chips.nth(2)).toContainText(MODEL_IDS[2]);
    await expect(chips.nth(2)).toContainText(/queued|대기/);
  });

  test("재연결 진행률이 0/0이 아니다", async ({ page }) => {
    await arriveOnReconnectingTab(page);

    // 헤더가 곧 진행률 바다(같은 수치를 role=progressbar 두 개로 노출하지 않는다).
    const bar = page.getByRole("progressbar");
    // 분모 6 = 모델 3 × 시나리오 2 × 라우트 1. 폼 폴백만 보던 시절엔 여기가 0/0이었다.
    await expect(bar).toHaveAttribute("aria-valuetext", /2\s*\/\s*6/);
    await expect(bar).not.toHaveAttribute("aria-valuenow", "0");
  });

  test("끝난 모델의 결과가 DB에서 복원되어 표에 남는다", async ({ page }) => {
    await arriveOnReconnectingTab(page);

    // 실행 중에는 5·6단계가 자동으로 열린다(접힌 StepSection은 hidden이라 Playwright에 안 보인다).
    const restored = resultsTable(page).locator('tbody tr:not([aria-hidden="true"])');
    await expect(restored).toHaveCount(SCENARIOS.length);
    await expect(restored.filter({ hasText: SCENARIOS[0].id })).toContainText(MODEL_IDS[0]);
    await expect(restored.filter({ hasText: SCENARIOS[1].id })).toContainText(MODEL_IDS[0]);
  });

  test("예약된 조합이 스켈레톤 행으로 보인다", async ({ page }) => {
    await arriveOnReconnectingTab(page);

    // 스켈레톤은 aria-hidden이라 role 쿼리로는 잡히지 않는다. 복원한 2건을 뺀 나머지가 예약으로 남는다.
    const skeletons = resultsTable(page).locator('tbody tr[aria-hidden="true"]');
    await expect(skeletons).not.toHaveCount(0);
  });

  /**
   * 이 스펙이 "실행 중" 화면을 처음 axe에 걸면서 드러난 **기존** 위반 3건.
   * PR-B가 만든 것이 아니다 — 지금까지의 axe 스캔은 전부 실행이 끝난 뒤 상태를 봤다.
   *  - aria-progressbar-name / nested-interactive: AppHeader가 `<header>` 통째에
   *    `role="progressbar"`를 얹어 접근가능한 이름이 없고 nav 링크를 품는다(components/AppHeader.tsx).
   *  - color-contrast: 예약 스켈레톤 행의 `opacity-40` × `text-[var(--muted)]`가 4.5:1 미달
   *    (components/ResultsTable.tsx, components/Scoreboard.tsx).
   * 담당 파일이 갈려 여기서 고칠 수 없으므로 목록으로 못 박고 **새 위반만** 실패로 잡는다.
   * 고치고 나면 이 배열에서 지워야 한다(고쳐도 남겨두면 아래 단언이 실패한다).
   */
  test("axe: 재연결 진행 중 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    // settleAnimations(최대 2초) + 스캔이 관측 창 안에서 끝나야 해서 넉넉히 붙들어 둔다.
    await arriveOnReconnectingTab(page, 12_000);
    await expect(queueChips(page).getByRole("listitem")).toHaveCount(3);
    // 복원까지 끝난 뒤 스캔해야 스켈레톤 개수가 흔들리지 않는다.
    await expect(resultsTable(page).locator('tbody tr:not([aria-hidden="true"])')).toHaveCount(SCENARIOS.length);
    await expect(resultsTable(page).locator('tbody tr[aria-hidden="true"]')).not.toHaveCount(0);

    await settleAnimations(page);
    // 실행 중 상태를 axe로 보는 첫 스캔이다. 여기서 드러난 기존 위반 3건(이름 없는 header progressbar,
    // 그 안에 갇힌 nav 컨트롤, 예약 스켈레톤의 대비 미달)은 이 PR에서 함께 고쳤다.
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
