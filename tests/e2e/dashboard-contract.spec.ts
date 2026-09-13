import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/fixtures";

const serverA = "http://localhost:1234";
const serverB = "http://localhost:2345";
const items = [serverA, serverA, serverB].map((base_url, i) => ({
  run_id: `config-run-${i}`, model_id: "same-model", base_url, provider: "openai_compatible",
  created_at: "2026-09-01T00:00:00Z", finished_at: "2026-09-01T00:01:00Z", status: "ok",
  scenario_count: 1, categories: ["text"], config_id: `v1:settings-${i}`, config_complete: true,
  config: { profile_thinking_intent: i === 0 ? "off" : "on", reasoning_effort: i === 0 ? "none" : "xhigh", temperature: i / 10, max_tokens: 512, request_max_tokens: i === 0 ? 128 : null, profile_max_tokens_override: null },
}));

test("same model stays separate by server/settings in tables, chart filters and details", async ({ page }) => {
  await page.route("**/api/stats/model-latest", (route) => route.fulfill({ json: { items, sqlite_available: true } }));
  await page.route("**/api/runs/**", (route) => {
    const item = items.find((it) => route.request().url().includes(it.run_id))!;
    return route.fulfill({ json: { meta: item, scenarios: [{ id: "chat_ping", api_route: "chat_completions", source_run_id: item.run_id,
      prompt_preview: `prompt-${item.run_id}`, prompt_system_preview: "system", runs: [{ ttft_ms: 100, total_ms: 1000, output_text: `output-${item.run_id}`, stream_completed: true, usage_output_tokens: 20, quality: { pass: true, score: 1 } }] }] } });
  });
  await page.goto("/stats");
  const saved = page.getByRole("table", { name: "저장된 모델 통계" });
  await expect(saved.locator("summary").filter({ hasText: "max=128" })).toHaveCount(1);
  await saved.locator("summary").first().click();
  await expect(saved.getByRole("checkbox").first()).not.toBeChecked();
  await saved.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(saved.getByRole("checkbox").first()).not.toBeChecked();
  for (const checkbox of await saved.getByRole("checkbox").all()) await checkbox.check();
  const board = page.getByRole("table", { name: /총합 품질.*스코어보드/ });
  await expect(board.locator("tbody tr")).toHaveCount(3);
  const results = page.getByRole("heading", { name: "결과 테이블" }).locator("..");
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: /same-model.*T=/ })).toHaveCount(6); // saved + chart filters
  for (let i = 0; i < 3; i++) {
    const row = results.locator("tbody tr").nth(i);
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/run_id: config-run-/)).toBeVisible();
    const source = (await dialog.getByText(/run_id: config-run-/).textContent())!.split("run_id: ")[1];
    await expect(dialog.getByText(`output-${source}`, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
});

test("stress invalidates detection on URL/key changes and discards in-flight stale results", async ({ page }) => {
  let release: (() => void) | undefined;
  let hold = false;
  await page.route("**/api/detect", async (route) => {
    const { baseUrl } = route.request().postDataJSON();
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { provider: "openai_compatible", baseUrl, models: [{ id: "same-model" }], steps: [], capabilities: { openaiChat: true, anthropicMessages: false } } });
  });
  await page.goto("/stress");
  const url = page.getByLabel("base URL", { exact: true });
  const detect = page.getByRole("button", { name: "감지", exact: true });
  const run = page.getByRole("button", { name: "실행", exact: true });
  await url.fill(serverA);
  await detect.click();
  await expect(run).toBeEnabled();
  await url.fill(serverB);
  await expect(run).toBeDisabled();
  await expect(page.getByText("연결 정보를 변경한 뒤에는 다시 감지해야 실행할 수 있습니다.")).toBeVisible();
  hold = true;
  await detect.click();
  await expect.poll(() => !!release).toBe(true);
  await url.fill(serverA);
  release!();
  await expect(detect).toBeEnabled();
  await expect(run).toBeDisabled();
  hold = false;
  await detect.click();
  await expect(run).toBeEnabled();
  await page.getByLabel("API key (선택)", { exact: true }).fill("mock-new-key");
  await expect(run).toBeDisabled();
});

for (const [path, api] of [["/stats", "/api/stats/model-latest"], ["/provider-stats", "/api/stress/runs**"]]) {
  test(`${path}: HTTP authentication failure is visible`, async ({ page }) => {
    await page.route(`**${api}`, (route) => route.fulfill({ status: 401, json: { error: "unauthorized" } }));
    await page.goto(path);
    await expect(page.getByText(/요청 실패 \(HTTP 401\)/)).toBeVisible();
  });
}


test("stats default order is newest first, with missing timestamps last", async ({ page }) => {
  const ordered = [
    { ...items[0], run_id: "older", model_id: "older", finished_at: "2026-09-01T00:00:00Z" },
    { ...items[1], run_id: "missing", model_id: "missing", finished_at: null },
    { ...items[2], base_url: serverA, run_id: "newest", model_id: "newest", finished_at: "2026-09-02T00:00:00Z" },
  ];
  await page.route("**/api/stats/model-latest", route => route.fulfill({ json: { items: ordered, sqlite_available: true } }));
  await page.goto("/stats");
  const table = page.getByRole("table", { name: "저장된 모델 통계" });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("newest");
  await expect(rows.nth(1)).toContainText("older");
  await expect(rows.nth(2)).toContainText("missing");
  const header = table.getByRole("columnheader").filter({ hasText: "완료" });
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.nth(0)).toContainText("older");
  await expect(rows.nth(1)).toContainText("newest");
  await expect(rows.nth(2)).toContainText("missing");
});

test("saved version filters combine with search and URL without clearing hidden selections", async ({ page }) => {
  const versions = [
    { evaluation_protocol_version: "2", warmup_protocol_version: "2" },
    { evaluation_protocol_version: "1", warmup_protocol_version: "2" },
    {},
    { evaluation_protocol_version: "2" },
  ];
  const records = versions.map((config, i) => ({ ...items[0], run_id: `version-${i}`,
    model_id: `version-model-${i}`, config_id: `version-config-${i}`, config,
    base_url: i === 1 ? serverB : serverA, categories: i === 3 ? ["vision"] : ["text"],
  }));
  await page.route("**/api/stats/model-latest", route => route.fulfill({ json: { items: records, sqlite_available: true } }));
  await page.route("**/api/runs/**", route => {
    const meta = records.find(item => route.request().url().includes(item.run_id))!;
    return route.fulfill({ json: { meta, scenarios: [{ id: "chat_ping", api_route: "chat_completions",
      runs: [{ ttft_ms: 100, total_ms: 1000, output_text: "pong", stream_completed: true, quality: { pass: true } }] }] } });
  });
  await page.goto("/stats");
  const saved = page.getByRole("table", { name: "저장된 모델 통계" });
  const version = page.getByRole("combobox", { name: "저장 버전", exact: true });
  const baseUrl = page.getByRole("combobox", { name: "Base URL", exact: true });
  await baseUrl.selectOption("");
  await expect(version).toHaveValue("");
  await expect(version.locator("option")).toHaveText([
    "전체 버전", "평가 2 / 워밍업 2", "평가 2 / 워밍업 미기록", "평가 1 / 워밍업 2", "버전 미기록",
  ]);
  await version.selectOption({ label: "평가 2 / 워밍업 2" });
  await expect(saved.locator("tbody tr")).toHaveCount(1);
  await expect(saved.locator("tbody tr")).toContainText("version-model-0");
  await saved.getByRole("button", { name: "표시된 선택 가능 항목 전체 선택" }).click();
  await version.selectOption({ label: "평가 1 / 워밍업 2" });
  await expect(saved.locator("tbody tr")).toContainText("version-model-1");
  const visionCategory = page.getByRole("button", { name: /^비전/ });
  await visionCategory.click();
  await expect(saved).toContainText("일치하는 모델이 없습니다");
  await visionCategory.click();
  await baseUrl.selectOption(serverA);
  await expect(saved).toContainText("일치하는 모델이 없습니다");
  await expect(version.locator("option")).toHaveCount(5);
  await baseUrl.selectOption("");
  await page.getByRole("textbox", { name: "저장된 모델 필터" }).fill("version-model-0");
  await expect(saved).toContainText("일치하는 모델이 없습니다");
  await page.getByRole("textbox", { name: "저장된 모델 필터" }).fill("");
  await version.selectOption({ label: "버전 미기록" });
  await expect(saved.locator("tbody tr")).toContainText("version-model-2");
  await version.selectOption("");
  await expect(saved.locator("tbody tr")).toHaveCount(4);
  await expect(saved.locator("tbody tr").filter({ hasText: "version-model-0" }).getByRole("checkbox")).toBeChecked();
  await expect(saved.locator("tbody tr").filter({ hasText: "version-model-1" }).getByRole("checkbox")).not.toBeChecked();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a"]).analyze();
  expect(axe.violations).toEqual([]);
});
