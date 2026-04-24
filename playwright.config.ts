import { defineConfig, devices } from "@playwright/test";

/** 기본 Vite preview(4173)와 격리 — 로컬에 다른 프로세스가 점유한 경우 오검출 방지 */
const E2E_PREVIEW_PORT = Number(process.env.PW_PREVIEW_PORT ?? "4174");
const e2eOrigin = `http://127.0.0.1:${E2E_PREVIEW_PORT}`;

/**
 * E2E: `vite preview`로 빌드된 웹만 띄웁니다(API 프록시 미사용 — 문서·탭 라우팅 검증).
 * 실행: `pnpm test:e2e` (첫 실행 전 `pnpm exec playwright install chromium`)
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: e2eOrigin,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @llm-bench/shared run build && pnpm --filter @llm-bench/web run build && pnpm --filter @llm-bench/web exec vite preview --host 127.0.0.1 --port ${E2E_PREVIEW_PORT} --strictPort`,
    url: e2eOrigin,
    reuseExistingServer: process.env.CI ? false : !!process.env.PW_REUSE_SERVER,
    timeout: 180_000,
  },
});
