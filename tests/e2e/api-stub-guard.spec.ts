import type { Page, Route } from "@playwright/test";
import { DEFAULT_SCENARIO_ITEMS } from "./helpers/api-stubs";
import { expect, test } from "./helpers/fixtures";

/**
 * API 스텁 3계층(누수 catch-all < 기본 스텁 < 스펙 자신의 route)이 실제로 그 순서로 이기는지,
 * 그리고 누수 가드가 진짜 무는지를 못 박는다.
 *
 * 이 순서는 helpers/fixtures.ts에 주석으로 적혀 있지만, 주석은 회귀를 막지 못한다.
 * 뒤집히면 스펙의 목업이 **조용히** 무시돼(에러 없이 기본 스텁 응답이 나감) 다른 스펙이
 * 엉뚱한 데이터를 보고 통과하기 시작한다 — 그래서 계층마다 이기는 케이스를 여기서 확인한다.
 */

/** 페이지 안에서 `/api/...`를 직접 불러 상태·본문을 그대로 돌려받는다. */
async function fetchApi(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const res = await fetch(p);
    return { status: res.status, body: await res.text() };
  }, path);
}

test.describe("e2e API 스텁 우선순위", () => {
  test("기본 스텁이 누수 catch-all을 이긴다", async ({ page, apiLeakGuard }) => {
    await page.goto("/");

    const health = await fetchApi(page, "/api/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      ok: true,
      service: "llm-bench-server",
      wsl_windows_host: null,
    });

    // 기본 스텁이 덮은 엔드포인트는 catch-all까지 오지 않으므로 누수 목록이 비어 있어야 한다.
    expect(apiLeakGuard.leaked()).toEqual([]);
  });

  test("스펙이 테스트 본문에서 건 route가 기본 스텁을 이긴다", async ({ page, apiLeakGuard }) => {
    await page.route("**/api/health", (route: Route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, service: "spec-override" }) }),
    );
    await page.goto("/");

    const health = await fetchApi(page, "/api/health");
    expect(JSON.parse(health.body)).toMatchObject({ service: "spec-override" });
    expect(apiLeakGuard.leaked()).toEqual([]);
  });

  // bench-steps·bench-reconnect처럼 beforeEach에서 목업을 거는 스펙과 같은 모양.
  // 자동 픽스처가 훅보다 먼저 셋업되지 않으면 여기서 기본 스텁 응답이 나와 실패한다.
  test.describe("beforeEach에서 건 route", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/scenarios**", (route: Route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ scenarios: [{ id: "hook_only_v1", source: "custom", isAgentLoop: false, maxTurns: null }] }),
        }),
      );
    });

    test("기본 스텁을 이긴다", async ({ page, apiLeakGuard }) => {
      await page.goto("/");
      const res = await fetchApi(page, "/api/scenarios?set=all");
      expect(JSON.parse(res.body).scenarios).toHaveLength(1);
      expect(apiLeakGuard.leaked()).toEqual([]);
    });
  });
});

test.describe("누수 가드", () => {
  test("스텁 없는 엔드포인트는 503으로 끊기고 누수 목록에 남는다", async ({ page, apiLeakGuard }) => {
    // 이 테스트는 일부러 새게 만든다 — 가드가 실패시키지 않도록 이번 테스트에 한해 끈다.
    apiLeakGuard.allowLeaks();
    await page.goto("/");

    const res = await fetchApi(page, "/api/definitely-not-stubbed?x=1");
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ error: "e2e_api_not_stubbed" });
    expect(apiLeakGuard.leaked()).toContain("GET /api/definitely-not-stubbed?x=1");
  });

  test("기본 스텁 표에 없는 메서드도 누수로 잡힌다", async ({ page, apiLeakGuard }) => {
    apiLeakGuard.allowLeaks();
    await page.goto("/");

    // GET만 스텁돼 있다 — PUT은 기본 스텁 표에서 fallback()으로 catch-all에 넘어간다.
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/base-url-names", { method: "PUT", body: "{}" });
      return r.status;
    });
    expect(res).toBe(503);
    expect(apiLeakGuard.leaked()).toContain("PUT /api/base-url-names");
  });
});

test.describe("기본 시나리오 스텁", () => {
  test("실서버와 같은 31건 · 빌트인 agent_loop 6건만 isAgentLoop", async ({ page }) => {
    await page.goto("/");
    const res = await fetchApi(page, "/api/scenarios?set=all");
    const scenarios = JSON.parse(res.body).scenarios as typeof DEFAULT_SCENARIO_ITEMS;

    expect(scenarios).toHaveLength(31);
    expect(scenarios.filter((s) => s.isAgentLoop).map((s) => s.id)).toEqual([
      "agent_loop_mock_v1",
      "agent_loop_budget_v1",
      "agent_loop_docs_v1",
      "agent_loop_error_v1",
      "agent_loop_grounding_v1",
      "agent_loop_chain_v1",
    ]);
    // 웹은 `source === "custom" || isAgentLoop`만 dynamicScenarioIds로 삼는다 — 커스텀은 0건이어야
    // 피커의 "커스텀 시나리오" 영역이 빈 상태(실서버 기본값)로 유지된다.
    expect(scenarios.filter((s) => s.source === "custom")).toEqual([]);
    // agent_loop이 아닌 항목의 maxTurns는 서버와 같이 null.
    expect(scenarios.filter((s) => !s.isAgentLoop).every((s) => s.maxTurns === null)).toBe(true);
  });
});
