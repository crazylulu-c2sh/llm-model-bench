import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Base URL 별칭(이름 + 기기/스펙) 회귀 게이트.
 *
 * 웹 단위 테스트는 순수 로직만 다루므로(웹 앱에 DOM 테스트 러너가 없음) 표 셀·모달·키보드
 * 상호작용의 회귀는 여기서 막는다. e2e webServer는 백엔드 없이 정적 프리뷰만 띄우므로
 * stats/별칭 API는 page.route로 목업하고, PUT은 메모리 스토어로 서버 상태를 흉내 낸다.
 */

const BASE_URL = "http://localhost:1234/v1";
const BASE_URL_2 = "http://other.example:8080/v1";
const MODEL_COUNT = 3;
const SCENARIO_COUNT = 12;

const MODELS = Array.from({ length: MODEL_COUNT }, (_, i) => ({
  run_id: `run_${i}`,
  model_id: `bench-model-${i}`,
  // 마지막 한 대만 다른 호스트 — Base URL 필터 드롭다운(2개 이상일 때만 렌더)까지 켠다.
  base_url: i === MODEL_COUNT - 1 ? BASE_URL_2 : BASE_URL,
  provider: "lm_studio",
  finished_at: "2026-07-09T10:00:00.000Z",
  created_at: "2026-07-09T09:00:00.000Z",
  status: "completed",
  scenario_count: SCENARIO_COUNT,
}));

type AliasItem = { base_url: string; name: string; note?: string };

/** 서버의 trailing slash 정규화(normBaseUrl)와 같은 규칙. */
const norm = (u: string) => u.replace(/\/+$/, "");

async function mockApi(page: Page, initial: AliasItem[] = []) {
  const store = new Map(initial.map((a) => [norm(a.base_url), a]));

  await page.route("**/api/stats/model-latest", (route: Route) =>
    route.fulfill({ json: { items: MODELS, sqlite_available: true } }),
  );
  await page.route("**/api/base-url-names", (route: Route) => {
    const req = route.request();
    if (req.method() !== "PUT") {
      return route.fulfill({ json: { items: [...store.values()], sqlite_available: true } });
    }
    const body = JSON.parse(req.postData() ?? "{}") as { base_url?: string; name?: string; note?: string };
    const key = norm(body.base_url ?? "");
    const name = (body.name ?? "").trim();
    const note = (body.note ?? "").trim();
    if (name) store.set(key, { base_url: key, name, note: note || undefined });
    else store.delete(key);
    return route.fulfill({ json: { ok: true, base_url: key, name: name || null, note: note || undefined } });
  });
  // 행이 선택되면 상세를 부른다 — 선택이 '일어나지 않아야' 하는 테스트에서 호출 여부로도 쓸 수 있게 최소 응답.
  await page.route("**/api/runs/**", (route: Route) =>
    route.fulfill({ json: { meta: { run_id: "run_0", base_url: BASE_URL, provider: "lm_studio", model_id: "bench-model-0", created_at: "2026-07-09T09:00:00.000Z" }, scenarios: [] } }),
  );
}

const pencilFor = (page: Page, url: string) =>
  page.getByRole("button", { name: `${url} 이름 붙이거나 바꾸기` }).first();
const dialog = (page: Page) => page.getByRole("dialog");
const rowFor = (page: Page, modelId: string) => page.getByRole("row", { name: `${modelId} 선택 토글` });

test.describe("/stats Base URL 별칭", () => {
  test("연필 클릭은 모달만 열고 행 선택을 토글하지 않는다", async ({ page }) => {
    await mockApi(page);
    await page.goto("/stats");

    const checkbox = page.getByRole("checkbox", { name: "bench-model-0 선택" });
    await expect(checkbox).not.toBeChecked();

    await pencilFor(page, BASE_URL).click();
    await expect(dialog(page).getByRole("heading", { name: "Base URL에 이름 붙이기" })).toBeVisible();
    // 행 onClick으로 새어 나가면 이 런이 차트 비교 대상으로 선택돼 버린다.
    await expect(checkbox).not.toBeChecked();
  });

  test("연필은 키보드(Enter)로 활성화되고, 행 선택을 가로채지 않는다", async ({ page }) => {
    await mockApi(page);
    await page.goto("/stats");

    const checkbox = page.getByRole("checkbox", { name: "bench-model-0 선택" });
    await pencilFor(page, BASE_URL).focus();
    await page.keyboard.press("Enter");

    // 행 onKeyDown이 preventDefault로 버튼 활성화를 취소하면 모달이 열리지 않는다.
    await expect(dialog(page).getByRole("heading", { name: "Base URL에 이름 붙이기" })).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  test("저장 직후 새로고침 없이 표 셀에 별칭이 반영된다", async ({ page }) => {
    await mockApi(page);
    await page.goto("/stats");

    await pencilFor(page, BASE_URL).click();
    await dialog(page).getByLabel("이름 (선택)").fill("DGX Spark");
    await dialog(page).getByLabel("기기/스펙 (선택)").fill("GB200 128GB");
    await dialog(page).getByRole("button", { name: "저장" }).click();

    await expect(dialog(page)).toHaveCount(0);
    // columns useMemo가 aliasFor를 의존성에 담지 않으면 stale 클로저로 원본 URL만 계속 보인다.
    await expect(rowFor(page, "bench-model-0").getByText("DGX Spark")).toBeVisible();
    await expect(rowFor(page, "bench-model-1").getByText("GB200 128GB")).toBeVisible();
    // 별칭이 없는 호스트는 그대로 원본 URL.
    await expect(rowFor(page, `bench-model-${MODEL_COUNT - 1}`).getByText(BASE_URL_2)).toBeVisible();
  });

  test("텍스트 검색이 별칭 이름·기기 메모도 매칭한다", async ({ page }) => {
    await mockApi(page, [{ base_url: BASE_URL, name: "DGX Spark", note: "GB200 128GB" }]);
    await page.goto("/stats");

    const search = page.getByPlaceholder(/별칭/);
    await search.fill("DGX");
    await expect(rowFor(page, "bench-model-0")).toBeVisible();
    await expect(rowFor(page, `bench-model-${MODEL_COUNT - 1}`)).toHaveCount(0);

    await search.fill("GB200");
    await expect(rowFor(page, "bench-model-0")).toBeVisible();
    await expect(rowFor(page, `bench-model-${MODEL_COUNT - 1}`)).toHaveCount(0);
  });

  test("Base URL 필터만 걸어도 '표시 N'이 안내된다", async ({ page }) => {
    await mockApi(page);
    await page.goto("/stats");

    await expect(page.getByText(/개 표시/)).toHaveCount(0);
    // 셀렉트의 접근명은 라벨 텍스트 + 선택된 옵션값으로 합성되므로 부분 일치로 찾는다.
    const hostFilter = page.getByRole("combobox", { name: /Base URL/ });
    await expect(hostFilter).toHaveCount(1);
    await hostFilter.selectOption(BASE_URL_2);

    await expect(rowFor(page, "bench-model-0")).toHaveCount(0);
    await expect(page.getByText(/· 1개 표시/)).toBeVisible();
  });
});
