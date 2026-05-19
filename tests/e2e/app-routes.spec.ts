import { test, expect } from "@playwright/test";

test.describe("LLM Model Bench UI", () => {
  test("홈: 제목·벤치 부제·탭 목록", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/LLM Model Bench/);
    await expect(page.getByRole("heading", { name: "LLM Model Bench" })).toBeVisible();
    await expect(page.getByText("로컬 프로바이더 감지 · 단일 모델 시나리오 벤치")).toBeVisible();
    const tablist = page.getByRole("tablist", { name: "페이지" });
    await expect(tablist.getByRole("tab", { name: "모델 벤치" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "프로바이더 벤치" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "모델 통계" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "프로바이더 통계" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "프로파일" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "프로바이더 모니터" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "시나리오" })).toBeVisible();
  });

  test("탭: 모델 통계 페이지 부제", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.getByText("SQLite에 저장된 최신 런 기준 메트릭·결과")).toBeVisible();
    await expect(page.getByRole("tab", { name: "모델 통계" })).toHaveAttribute("aria-selected", "true");
  });

  test("탭: 프로바이더 통계 페이지 부제·탭 활성", async ({ page }) => {
    await page.goto("/provider-stats");
    await expect(page.getByText("SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제")).toBeVisible();
    await expect(page.getByRole("tab", { name: "프로바이더 통계" })).toHaveAttribute("aria-selected", "true");
  });

  test("탭: 프로파일 문서", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText("모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙")).toBeVisible();
    await expect(page.getByRole("heading", { name: "모델 프로파일 문서" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "gemma4", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "프로파일" })).toHaveAttribute("aria-selected", "true");
  });

  test("탭: 프로바이더 모니터 페이지 부제·탭 활성", async ({ page }) => {
    await page.goto("/provider-monitor");
    await expect(page.getByText("로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작")).toBeVisible();
    await expect(page.getByRole("tab", { name: "프로바이더 모니터" })).toHaveAttribute("aria-selected", "true");
  });

  test("탭: 시나리오 문서", async ({ page }) => {
    await page.goto("/scenarios");
    await expect(page.getByText("시나리오 목적·도구·채점·프롬프트 미리보기")).toBeVisible();
    await expect(page.getByRole("heading", { name: "벤치 시나리오 문서" })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "chat_hello" }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "시나리오" })).toHaveAttribute("aria-selected", "true");
  });

  test("탭 클릭으로 홈 복귀", async ({ page, baseURL }) => {
    await page.goto("/profile");
    await page.getByRole("tab", { name: "모델 벤치" }).click();
    await expect(page).toHaveURL(new URL("/", baseURL!).href);
    await expect(page.getByText("로컬 프로바이더 감지 · 단일 모델 시나리오 벤치")).toBeVisible();
    await expect(page.getByRole("heading", { name: "모델 선택" })).toBeVisible();
  });

  test("벤치: 상세 문서 링크 존재", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "프로파일 수치·규칙 상세" })).toHaveAttribute("href", "/profile");
    await expect(page.getByRole("link", { name: "시나리오 상세 문서" })).toHaveAttribute("href", "/scenarios");
  });
});
