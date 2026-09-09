import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerCatalogRoutes } from "./catalog-routes.js";

function makeApp(): Hono {
  const app = new Hono();
  registerCatalogRoutes(app, "/api");
  return app;
}

describe("registerCatalogRoutes GET /catalog (#165)", () => {
  it("defaults to the public set when `set` is omitted (unchanged behavior)", async () => {
    const app = makeApp();
    const res = await app.request("/api/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenarios: Array<{ id: string }> };
    const ids = body.scenarios.map((s) => s.id);
    expect(ids.some((id) => id.startsWith("agent_loop_"))).toBe(false);
  });

  it("honors `set=agent` and includes the builtin agent_loop scenarios", async () => {
    const app = makeApp();
    const res = await app.request("/api/catalog?set=agent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenarios: Array<{ id: string }> };
    const ids = body.scenarios.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "agent_loop_mock_v1",
        "agent_loop_budget_v1",
        "agent_loop_docs_v1",
        "agent_loop_error_v1",
        "agent_loop_grounding_v1",
        "agent_loop_chain_v1",
      ]),
    );
    expect(ids.every((id) => id.startsWith("agent_loop_"))).toBe(true);
  });

  it("still returns profiles and stressWorkloads regardless of `set`", async () => {
    const app = makeApp();
    const res = await app.request("/api/catalog?set=agent");
    const body = (await res.json()) as { profiles: unknown[]; stressWorkloads: unknown[] };
    expect(body.profiles.length).toBeGreaterThan(0);
    expect(body.stressWorkloads.length).toBeGreaterThan(0);
  });
});
