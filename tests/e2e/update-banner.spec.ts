import { expect, test } from "./helpers/fixtures";

/**
 * UpdateBanner: behind일 때만 표시, 닫기(sessionStorage) 후 숨김.
 * 기본 스텁은 unavailable이라 a11y·다른 스펙에는 배너가 없다.
 */
test.describe("업데이트 확인 배너", () => {
  test("behind이면 배너 표시 · 닫기 · 재방문 시 숨김", async ({ page }) => {
    await page.route("**/api/update-check", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "behind",
          branch: "main",
          localSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          behindBy: 3,
          aheadBy: 0,
          compareUrl:
            "https://github.com/crazylulu-c2sh/llm-model-bench/compare/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...main",
        }),
      });
    });

    await page.goto("/");
    const banner = page.getByRole("status").filter({ hasText: "새 버전이 있습니다" });
    await expect(banner).toBeVisible();
    await expect(banner.getByText("3커밋 뒤처짐")).toBeVisible();

    const compare = banner.getByRole("link", { name: /GitHub에서 변경 사항 보기/ });
    await expect(compare).toHaveAttribute("target", "_blank");
    await expect(compare).toHaveAttribute("rel", "noreferrer");

    await banner.getByRole("button", { name: "업데이트 알림 닫기" }).click();
    await expect(banner).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "새 버전이 있습니다" })).toHaveCount(0);
  });

  test("unavailable이면 배너 없음", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "새 버전이 있습니다" })).toHaveCount(0);
  });
});
