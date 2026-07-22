import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("i18n 언어 전환", () => {
  test("헤더 셀렉트로 영어 전환 → 내비 라벨·lang·타이틀 변경", async ({ page }) => {
    await page.goto("/");
    const langSelect = page.getByRole("combobox", { name: "언어 선택" });
    await langSelect.selectOption("en");

    const nav = page.getByRole("navigation", { name: "Main menu" });
    await expect(nav.getByRole("link", { name: "Model Bench" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "모델 벤치" })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Model Bench · LLM Model Bench/);
  });

  test("영어 선택은 새로고침 후에도 유지된다(localStorage)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "언어 선택" }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Model Bench" }),
    ).toBeVisible();
  });

  test("일본어 전환 후 한국어로 복귀", async ({ page }) => {
    await page.goto("/");
    const bySelectAria = (name: string) => page.getByRole("combobox", { name });

    await bySelectAria("언어 선택").selectOption("ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(
      page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "モデルベンチ" }),
    ).toBeVisible();

    // ja 상태의 셀렉트는 ja aria-label로 노출된다.
    await bySelectAria("言語を選択").selectOption("ko");
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "모델 벤치" }),
    ).toBeVisible();
  });

  test("영어 로케일에서 /harness 문서가 영어 헤딩으로 렌더(글롭 로더 가드)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("llm-bench-locale", "en"));
    await page.goto("/harness");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: /Harness Know-How/ })).toBeVisible();
  });

  for (const locale of ["en", "ja"] as const) {
    test(`axe: ${locale} 로케일 홈 무위반`, async ({ page }) => {
      await page.addInitScript((l) => localStorage.setItem("llm-bench-locale", l), locale);
      await page.goto("/");
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
