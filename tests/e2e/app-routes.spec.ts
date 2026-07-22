import { test, expect, type Page } from "@playwright/test";

test.describe("LLM Model Bench UI", () => {
  const navLink = (page: Page, name: string) =>
    page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name });

  test("홈: 제목·벤치 부제·탭 목록", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/LLM Model Bench/);
    await expect(page.getByRole("heading", { name: "LLM Model Bench" })).toBeVisible();
    await expect(page.getByText("로컬 프로바이더 감지 · 단일 모델 시나리오 벤치")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "주요 메뉴" });
    await expect(nav.getByRole("link", { name: "모델 벤치" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "프로바이더 벤치" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "모델 통계" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "프로바이더 통계" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "프로파일" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "프로바이더 모니터" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "시나리오" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "하네스" })).toBeVisible();
  });

  test("탭: 모델 통계 페이지 부제", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.getByText("SQLite에 저장된 최신 런 기준 메트릭·결과")).toBeVisible();
    await expect(navLink(page, "모델 통계")).toHaveAttribute("aria-current", "page");
  });

  test("탭: 프로바이더 통계 페이지 부제·탭 활성", async ({ page }) => {
    await page.goto("/provider-stats");
    await expect(page.getByText("SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제")).toBeVisible();
    await expect(navLink(page, "프로바이더 통계")).toHaveAttribute("aria-current", "page");
  });

  test("탭: 프로파일 문서", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText("모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙")).toBeVisible();
    await expect(page.getByRole("heading", { name: "모델 프로파일 문서" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "gemma4", exact: true })).toBeVisible();
    await expect(navLink(page, "프로파일")).toHaveAttribute("aria-current", "page");
  });

  test("탭: 프로바이더 모니터 페이지 부제·탭 활성", async ({ page }) => {
    await page.goto("/provider-monitor");
    await expect(page.getByText("로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작")).toBeVisible();
    await expect(navLink(page, "프로바이더 모니터")).toHaveAttribute("aria-current", "page");
  });

  test("탭: 시나리오 문서", async ({ page }) => {
    await page.goto("/scenarios");
    await expect(page.getByText("시나리오 목적·도구·채점·프롬프트 미리보기")).toBeVisible();
    await expect(page.getByRole("heading", { name: "벤치 시나리오 문서" })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "chat_hello" }).first()).toBeVisible();
    await expect(navLink(page, "시나리오")).toHaveAttribute("aria-current", "page");
  });

  test("탭: 하네스 문서", async ({ page }) => {
    await page.goto("/harness");
    await expect(page.getByText("벤치/스트레스 하네스 설계·기법 — 다른 프로젝트 참고용")).toBeVisible();
    await expect(page.getByRole("link", { name: /docs\/harness-knowhow\.md/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Harness Know-How/ })).toBeVisible();
    await expect(navLink(page, "하네스")).toHaveAttribute("aria-current", "page");
    // 스크롤-스파이 사이드바(xl+): 기본 Desktop Chrome 뷰포트(1280px)에서 노출
    const toc = page.getByRole("navigation", { name: "이 페이지 목차" });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole("link", { name: /Architecture & Event Model/ })).toBeVisible();
    // 스크롤-스파이: 문서 하단으로 스크롤하면 마지막 섹션(부록 B) 링크가 활성(aria-current)이 된다.
    // (heading remount로 observer가 죽으면 활성 표시가 갱신되지 않으므로 이 단언이 회귀를 잡는다.)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(toc.getByRole("link", { name: /부록 B\. 레퍼런스/ })).toHaveAttribute("aria-current", "location");
  });

  test("탭 클릭으로 홈 복귀", async ({ page, baseURL }) => {
    await page.goto("/profile");
    await navLink(page, "모델 벤치").click();
    await expect(page).toHaveURL(new URL("/", baseURL!).href);
    await expect(page.getByText("로컬 프로바이더 감지 · 단일 모델 시나리오 벤치")).toBeVisible();
    await expect(page.getByRole("heading", { name: "모델 선택" })).toBeVisible();
  });

  test("벤치: 상세 문서 링크 존재", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "프로파일 수치·규칙 상세" })).toHaveAttribute("href", "/profile");
    await expect(page.getByRole("link", { name: "시나리오 상세 문서" })).toHaveAttribute("href", "/scenarios");
  });

  test("헤더: 좁은 뷰포트에서 활성 탭 라벨 항상·비활성 탭은 호버 시 라벨", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/");
    const activeBenchTab = navLink(page, "모델 벤치");
    const providerBenchTab = navLink(page, "프로바이더 벤치");
    await expect(activeBenchTab.getByText("모델 벤치")).toBeVisible();
    await expect(providerBenchTab.getByText("프로바이더 벤치")).not.toBeVisible();

    await providerBenchTab.hover();
    await expect(providerBenchTab.getByText("프로바이더 벤치")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(providerBenchTab.getByText("프로바이더 벤치")).toBeVisible();
  });

  test("헤더: 중간 너비에서 타이틀·부제 세로 깨짐 없음", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "LLM Model Bench" });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("white-space", "nowrap");
    const subtitle = page.getByText("로컬 프로바이더 감지 · 단일 모델 시나리오 벤치");
    await expect(subtitle).toBeVisible();
    const subtitleLines = await subtitle.evaluate((el) => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      return el.offsetHeight / (lineHeight || 20);
    });
    expect(subtitleLines).toBeLessThan(1.5);
  });

  test("헤더: 데스크톱 너비에서 탭바 가로 스크롤·잘림 없음", async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "주요 메뉴" });
      // 마지막 탭(하네스)까지 잘림 없이 뷰포트 안에 보여야 한다.
      await expect(nav.getByRole("link").last()).toBeInViewport();
      // 전폭 2행 레이아웃이므로 탭바에 가로 스크롤이 생기지 않아야 한다.
      const bar = nav.locator("div").first();
      const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });
});
