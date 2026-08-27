import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * "/" 모델 벤치의 6단계 아코디언 — 국면 전이와 헤더 클릭 의미론 회귀 가드.
 *
 * 여기서 잡으려는 것들은 전부 파생 상태·전이라 단위 테스트(lib/bench-steps.test.ts)로 규칙을
 * 고정하고, 이 스펙은 그 규칙이 실제 DOM에 연결돼 있는지를 본다. 특히:
 *  - 모델 체크박스를 눌러도 열린 단계가 바뀌지 않을 것(진척도가 아니라 국면으로 계산)
 *  - 열린 단계를 다시 누르면 접힐 것(다른 카드가 대신 펼쳐지지 않을 것)
 *  - 실행이 시작되면 설정 단계들이 접히고 진행 단계가 열릴 것
 *
 * e2e webServer는 백엔드 없는 정적 프리뷰라 /api/detect·/api/bench/stream을 page.route로 고정한다.
 * 이 목업이 없으면 running·done 상태에 도달할 수 없어 새 disclosure 버튼·큐 칩이 axe 스캔을
 * 한 번도 받지 못한다.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BASE_URL = "http://localhost:1234/v1";
const RUN_ID = "e2e-run-1";
const MODEL_IDS = ["bench-model-a", "bench-model-b"];

const DETECT = {
  provider: "lm_studio",
  baseUrl: BASE_URL,
  models: MODEL_IDS.map((id, i) => ({
    id,
    publisher: "e2e",
    params_string: `${7 + i}B`,
    size_bytes: (4 + i) * 1024 ** 3,
  })),
  steps: [{ name: "models", ok: true }],
  capabilities: { openaiChat: true, anthropicMessages: false },
  reachability: { state: "ok" },
};

function sse(events: ReadonlyArray<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

/** 시나리오 1건이 통과로 끝나는 최소 런. rows가 1개 생기므로 종료 후 결과 단계가 열린다. */
function runStream(modelId: string): string {
  return sse([
    { type: "run_started", run_id: `${RUN_ID}-${modelId}` },
    { type: "scenario_start", scenario_id: "chat_hello", api_route: "chat_completions" },
    {
      type: "scenario_end",
      scenario_id: "chat_hello",
      api_route: "chat_completions",
      metrics: {
        ttft_ms: 120,
        total_ms: 800,
        output_chars: 40,
        approx_tokens: 10,
        usage_output_tokens: 10,
        stream_completed: true,
      },
      quality: { pass: true },
    },
    // 결과 행은 metrics_update의 aggregate에서 만들어진다 — scenario_end만으로는 rows가 비어
    // 종료 후 결과 단계가 열리지 않는다.
    {
      type: "metrics_update",
      aggregate: {
        scenario_id: "chat_hello",
        api_route: "chat_completions",
        runs: [
          {
            ttft_ms: 120,
            total_ms: 800,
            output_text: "hello from e2e",
            usage_output_tokens: 10,
            quality: { pass: true, score: 1 },
          },
        ],
      },
    },
    { type: "run_finished", run_id: `${RUN_ID}-${modelId}` },
  ]);
}

async function mockBackend(page: Page) {
  await page.route("**/api/detect", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(DETECT) }),
  );
  // 사전 예상 시간 조회 — 기록 없음. items가 없으면 앱이 순회하다 터지므로 실제 응답 형태 그대로 준다.
  await page.route("**/api/runs/latest-by-model*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ base_url: BASE_URL, items: [], sqlite_available: true }),
    }),
  );
  let call = 0;
  await page.route("**/api/bench/stream", (route) => {
    const modelId = MODEL_IDS[Math.min(call, MODEL_IDS.length - 1)];
    call += 1;
    route.fulfill({ contentType: "text/event-stream", body: runStream(modelId) });
  });
}

const stepButton = (page: Page, n: number) => page.locator(`#bench-step-${n} > div > h2 > button`);

async function openStates(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4, 5, 6].map(async (n) => (await stepButton(page, n).getAttribute("aria-expanded")) ?? "?"),
  );
}

/** axe의 color-contrast는 실행 중 트랜지션의 중간 합성색을 읽어 무작위로 실패한다 — 정착 후 스캔. */
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
    await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
    await page.locator("#bench-step-4-body tbody input[type=checkbox]").first().check();

    await page.getByRole("button", { name: /Run bench on selected models|선택 모델 벤치 실행/ }).click();
    await page.getByRole("button", { name: /^(Run bench|벤치 실행)$/ }).click();

    // 실행이 끝나면 결과가 있으므로 결과 단계가 열린다.
    await expect(stepButton(page, 6)).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
    expect((await openStates(page)).slice(0, 4)).toEqual(["false", "false", "false", "false"]);

    // 큐 칩이 남아 어느 모델이 어떻게 끝났는지 보인다.
    await expect(page.getByRole("list", { name: /Run queue status|실행 큐 상태/ })).toBeVisible();
  });

  test("axe: 실행 완료 상태 WCAG 2.1 AA 위반 없음", async ({ page }) => {
    await page.getByRole("button", { name: /Connect and detect provider|연결 및 프로바이더 감지/ }).first().click();
    await page.locator("#bench-step-4-body tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: /Run bench on selected models|선택 모델 벤치 실행/ }).click();
    await page.getByRole("button", { name: /^(Run bench|벤치 실행)$/ }).click();
    await expect(stepButton(page, 6)).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });

    await settleAnimations(page);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
