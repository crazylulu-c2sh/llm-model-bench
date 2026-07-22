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
    // i18n 기본 로케일 = ko. Desktop Chrome 기본은 en-US라, 감지 순서(localStorage → navigator.languages → ko)에서
    // 저장값이 없으면 영어로 렌더돼 한국어 단언이 깨진다. ko-KR로 핀해 기존 스펙을 기본 로케일로 고정한다.
    locale: "ko-KR",
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
