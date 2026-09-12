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
