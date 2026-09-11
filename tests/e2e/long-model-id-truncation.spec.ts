import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

/**
 * 매우 긴 model_id가 표에서 실제로 말줄임(ellipsis)되는지 회귀 게이트.
 *
 * `ModelLabel`은 저장된 모델 표(StatsModelTable)·모델 선택 위저드(ModelTable)·결과
 * 스코어보드(Scoreboard)·결과 표(ResultsTable) 4곳이 공유하는 단일 컴포넌트라, 여기서
 * 한 곳(저장된 모델 표)만 검증해도 네 곳 모두를 보호하는 회귀 게이트가 된다. `truncate`
 * 클래스만 있고 실제로 폭이 제한되지 않으면(과거 버그) 텍스트가 잘리지 않고 그대로 넘쳐서
 * `scrollWidth === clientWidth`가 되므로, 그 차이로 말줄임이 "진짜 작동"하는지를 잡는다.
 *
 * 2줄 라벨에서는 `title`(전체 id)이 바깥 래퍼에 있고, 말줄임은 2줄째 표시명 `.font-mono.truncate`
 * 에 걸린다 — overflow는 그쪽을 잰다.
 */

const BASE_URL = "http://localhost:1234/v1";
const LONG_MODEL_ID = "esatapedico/qwen3.8-27b-nvfp4-mtp-gguf/qwen3.8-27b-nvfp4-mtp-compact-low.gguf";

async function mockStats(page: Page) {
  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({
      json: {
        items: [
          {
            run_id: "run_long",
            model_id: LONG_MODEL_ID,
            publisher: "esatapedico",
            base_url: BASE_URL,
            provider: "lm_studio",
            finished_at: "2026-09-09T10:00:00.000Z",
            created_at: "2026-09-09T09:00:00.000Z",
            status: "completed",
            scenario_count: 12,
          },
        ],
        sqlite_available: true,
      },
    }),
  );
  await page.route("**/api/base-url-names", (route: Route) =>
    route.fulfill({ json: { items: [], sqlite_available: true } }),
  );
}

test.describe("저장된 모델 표 — 매우 긴 model_id", () => {
  test("이름이 말줄임되고, 전체 id는 title 툴팁으로 남는다", async ({ page }) => {
    await mockStats(page);
    await page.goto("/stats");

    const row = page.getByRole("row", { name: `${LONG_MODEL_ID} 선택 토글` });
    await expect(row).toBeVisible();

    const label = row.locator(`[title="${LONG_MODEL_ID}"]`);
    await expect(label).toHaveAttribute("title", LONG_MODEL_ID);

    // 말줄임은 표시명(2줄째)에 걸린다 — 래퍼가 아니라 그 span의 overflow를 잰다.
    const nameSpan = label.locator("span.truncate.font-mono");
    await expect(nameSpan).toBeVisible();

    // 말줄임(overflow:hidden + ellipsis)이 실제로 작동하면, 잘려나간 원문 때문에 논리적
    // 콘텐츠 폭(scrollWidth)이 실제 렌더 폭(clientWidth)보다 커진다. 과거 버그는 박스가
    // 콘텐츠에 맞춰 그냥 늘어나서 둘이 항상 같았다(overflow 없음 = 말줄임 미작동).
    const { scrollWidth, clientWidth } = await nameSpan.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(clientWidth).toBeGreaterThan(0);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });
});
