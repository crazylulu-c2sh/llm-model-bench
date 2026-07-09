import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
// DB 경로를 임시로 고정(실데이터 무영향). tryOpenProdBenchDatabase는 최초 요청 때 열림.
process.env.BENCH_DB_PATH = join(tmpdir(), `llm-bench-apptest-${process.pid}.sqlite`);
import { createApp } from "./app.js";
import { _setRemoteAddrResolverForTest } from "./util/localhost.js";

const app = createApp();
const req = (path: string, init?: RequestInit) => app.request(path, init);

afterEach(() => {
  delete process.env.BENCH_API_KEYS;
  delete process.env.BENCH_TRUST_LOOPBACK;
  delete process.env.BENCH_TRUST_PROXY;
  _setRemoteAddrResolverForTest(null);
});

describe("dual-prefix routing (/api ≡ /api/v1)", () => {
  it("health is served at both prefixes with identical body", async () => {
    const a = await req("/api/health");
    const b = await req("/api/v1/health");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it("scenarios served at both prefixes", async () => {
    for (const p of ["/api/scenarios", "/api/v1/scenarios"]) {
      const r = await req(p);
      expect(r.status).toBe(200);
      const j = (await r.json()) as { scenarios: unknown[] };
      expect(Array.isArray(j.scenarios)).toBe(true);
      expect(j.scenarios.length).toBeGreaterThan(0);
    }
  });

  it("unknown /api route → 404", async () => {
    const r = await req("/api/definitely-not-a-route");
    expect(r.status).toBe(404);
  });
});

describe("catalog / scoreboard", () => {
  it("scenarios?set=vision returns only vision", async () => {
    const r = await req("/api/scenarios?set=vision");
    const j = (await r.json()) as { scenarios: Array<{ isVision: boolean }> };
    expect(j.scenarios.length).toBeGreaterThan(0);
    expect(j.scenarios.every((s) => s.isVision)).toBe(true);
  });

  it("catalog returns scenarios + profiles + stressWorkloads", async () => {
    const r = await req("/api/catalog");
    const j = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["profiles", "scenarios", "stressWorkloads"]);
  });

  it("scoreboard requires baseUrl (400) and returns rows array otherwise", async () => {
    expect((await req("/api/scoreboard")).status).toBe(400);
    const r = await req("/api/scoreboard?baseUrl=http://127.0.0.1:1");
    expect(r.status).toBe(200);
    const j = (await r.json()) as { rows: unknown[]; base_url: string };
    expect(Array.isArray(j.rows)).toBe(true);
    expect(j.base_url).toBe("http://127.0.0.1:1");
  });
});

describe("api-key auth (opt-in) + exemptions", () => {
  it("disabled when BENCH_API_KEYS unset (no key → 200)", async () => {
    const r = await req("/api/scenarios");
    expect(r.status).toBe(200);
  });

  it("non-loopback without key → 401; correct Bearer/x-api-key → 200; health/OPTIONS exempt", async () => {
    process.env.BENCH_API_KEYS = "k1,k2";
    _setRemoteAddrResolverForTest(() => "10.0.0.5"); // non-loopback

    expect((await req("/api/scenarios")).status).toBe(401);
    expect((await req("/api/v1/scenarios")).status).toBe(401);
    expect(
      (await req("/api/scenarios", { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    expect(
      (await req("/api/scenarios", { headers: { Authorization: "Bearer k1" } })).status,
    ).toBe(200);
    expect((await req("/api/scenarios", { headers: { "x-api-key": "k2" } })).status).toBe(200);
    // 면제
    expect((await req("/api/health")).status).toBe(200);
    expect((await req("/api/v1/health")).status).toBe(200);
    expect((await req("/api/scenarios", { method: "OPTIONS" })).status).not.toBe(401);
  });

  it("loopback remote is exempt unless BENCH_TRUST_LOOPBACK=0", async () => {
    process.env.BENCH_API_KEYS = "k1";
    _setRemoteAddrResolverForTest(() => "127.0.0.1");
    expect((await req("/api/scenarios")).status).toBe(200); // loopback exempt
    process.env.BENCH_TRUST_LOOPBACK = "0";
    expect((await req("/api/scenarios")).status).toBe(401); // exemption disabled
  });

  it("BENCH_TRUST_PROXY: X-Forwarded-For honored only when enabled", async () => {
    process.env.BENCH_API_KEYS = "k1";
    _setRemoteAddrResolverForTest(() => "172.18.0.9"); // socket peer = proxy (non-loopback)

    // trust-proxy off: XFF ignored → 401
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "127.0.0.1" } })).status,
    ).toBe(401);

    // trust-proxy on: loopback XFF honored → 200
    process.env.BENCH_TRUST_PROXY = "1";
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "127.0.0.1" } })).status,
    ).toBe(200);
    // non-loopback XFF still needs a key
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "8.8.8.8" } })).status,
    ).toBe(401);
  });
});

describe("OpenAPI spec", () => {
  it("serves a valid 3.1 doc with expected schemas + paths (both prefixes)", async () => {
    for (const p of ["/api/openapi.json", "/api/v1/openapi.json"]) {
      const r = await req(p);
      expect(r.status).toBe(200);
      const spec = (await r.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(spec.openapi).toBe("3.1.0");
      for (const path of ["/health", "/detect", "/scenarios", "/scoreboard", "/bench/stream"]) {
        expect(spec.paths[path]).toBeDefined();
      }
      for (const s of ["DetectResult", "BenchResult", "StreamEvent", "ScoreboardResponse"]) {
        expect(spec.components.schemas[s]).toBeDefined();
      }
    }
  });

  it("docs page is self-contained HTML (no external src)", async () => {
    const r = await req("/api/v1/docs");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("llm-model-bench API");
    expect(html).not.toMatch(/<script[^>]+src=/i); // 외부 스크립트 없음
  });
});
