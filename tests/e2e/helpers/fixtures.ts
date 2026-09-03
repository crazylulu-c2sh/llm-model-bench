import { test as base, expect } from "@playwright/test";
import { installDefaultApiStubs } from "./api-stubs";

/**
 * 모든 e2e 스펙이 쓰는 `test` — API 기본 스텁 + 누수 가드를 자동으로 얹는다.
 *
 * **왜 필요한가.** e2e webServer는 백엔드 없는 `vite preview`인데, vite의 `server.proxy`가
 * preview에도 상속돼 스텁하지 않은 `/api/*`가 `VITE_API_URL`(기본 `http://127.0.0.1:20080`)로
 * 새어 나갔다. CI에서는 ECONNREFUSED라 앱이 열화된 상태로 테스트됐고, 개발 기계에서는 20080의
 * 진짜 백엔드가 응답해 **로컬과 CI가 다른 앱**을 봤다. `page.route`는 브라우저 단에서 가로채므로
 * "프록시까지 갔다 = 그 스펙이 스텁하지 않았다"가 정확히 성립한다.
 *
 * ## 등록 순서가 곧 계약이다
 * Playwright는 route 핸들러를 `unshift`로 쌓아 **나중에 등록된 것이 먼저** 매칭된다
 * (playwright-core `Page.route()`). 그래서 우선순위는 등록 순서의 역순이 된다:
 *
 * ```
 *   1) 누수 catch-all   `**\/api\/**`   ← 가장 먼저 등록 = 가장 낮은 우선순위
 *   2) 기본 스텁        `**\/api\/**`   ← 그다음(모르는 경로는 route.fallback()으로 1)에 넘김)
 *   3) 스펙 자신의 route               ← 테스트 본문/beforeEach에서 등록 = 가장 높은 우선순위
 * ```
 *
 * 이 순서가 뒤집히면 스펙의 목업이 조용히 무시된다. 뒤집히지 않았는지는 코드 주석이 아니라
 * `api-stub-guard.spec.ts`가 실제로 확인한다(3계층 각각이 이기는 케이스를 스펙으로 못 박아 뒀다).
 *
 * 이 픽스처는 `auto: true`라 스펙이 이름을 요청하지 않아도 붙는다. 자동 픽스처는 `beforeEach`
 * 훅보다 먼저 셋업되므로, 훅에서 거는 스펙 목업이 항상 기본 스텁을 이긴다.
 */

export type ApiLeakGuard = {
  /** 지금까지 catch-all에 걸린 요청 목록(`METHOD /path?query`). */
  leaked(): string[];
  /** 이번 테스트에 한해 누수 가드를 끈다 — 가드 자체를 검증하는 스펙 전용. */
  allowLeaks(): void;
};

export const test = base.extend<{ apiLeakGuard: ApiLeakGuard }>({
  apiLeakGuard: [
    async ({ page }, use) => {
      /** `METHOD /path?query` → 횟수. 같은 요청을 여러 번 새도 한 줄로 보여 준다. */
      const leaks = new Map<string, number>();
      let enforced = true;

      // (a) 누수 catch-all을 **가장 먼저** 건다 = 가장 낮은 우선순위.
      //     스텁되지 않은 /api 요청을 기록하고 503으로 끊어, 프록시(→ 20080)까지 나가지 못하게 한다.
      await page.route("**/api/**", async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const key = `${req.method()} ${u.pathname}${u.search}`;
        leaks.set(key, (leaks.get(key) ?? 0) + 1);
        try {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "e2e_api_not_stubbed", request: key }),
          });
        } catch {
          // 단언이 끝나 페이지가 먼저 닫히면 fulfill이 실패한다 — 기록은 이미 끝났으므로 무시.
        }
      });

      // (b) 기본 스텁 — catch-all보다 나중에 걸어 이긴다.
      await installDefaultApiStubs(page);

      await use({
        leaked: () => [...leaks.keys()].sort(),
        allowLeaks: () => {
          enforced = false;
        },
      });

      // (c) 누수 가드. 기본 스텁이 덮은 엔드포인트는 catch-all까지 오지 않으므로 여기 안 걸린다 —
      //     잡히는 건 **우리가 예상하지 못한 새 엔드포인트**뿐이고, 그게 이 가드의 목적이다.
      if (!enforced || leaks.size === 0) return;
      const lines = [...leaks.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, count]) => `  ${String(count).padStart(3, " ")}× ${key}`);
      throw new Error(
        [
          `스텁되지 않은 /api 요청 ${leaks.size}종이 새어 나갔다(503으로 끊음).`,
          "백엔드 없는 프리뷰에서 이 요청들은 vite 프록시로 나가 CI에선 실패하고 개발 기계에선 성공한다.",
          "tests/e2e/helpers/api-stubs.ts에 기본 스텁을 추가하거나, 이 스펙 안에서 직접 page.route로 목업해라.",
          ...lines,
        ].join("\n"),
      );
    },
    { auto: true },
  ],
});

export { expect };
