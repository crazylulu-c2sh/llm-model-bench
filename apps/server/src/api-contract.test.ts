import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { buildOpenApiSpec } from "./openapi/build-spec.js";

const detect = { provider: "openai_compatible", baseUrl: "http://localhost:1111", models: [{ id: "m" }], steps: [], capabilities: { openaiChat: true, anthropicMessages: false } };
const bench = { baseUrl: "http://localhost:2222", provider: "openai_compatible", modelId: "m" };

describe("API contracts", () => {
  it.each(["/api", "/api/v1"])("rejects mismatched detection before any run at %s", async (prefix) => {
    const app = createApp();
    for (const [path, body] of [
      ["/bench/stream", { detect, bench }],
      ["/bench/queue", { detect, bench, model_ids: ["m"] }],
      ["/stress/stream", { detect, stress: { ...bench, workloadId: "stress_ping", ramp: { start: 1, max: 1, step: 1, durationMs: 100 } } }],
    ] as const) {
      const response = await app.request(`${prefix}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "detect_target_mismatch" });
    }
  });
  it("documents every registered API operation except document delivery", () => {
    const app = createApp();
    const spec = buildOpenApiSpec() as { paths: Record<string, Record<string, unknown>> };
    const exclusions = new Set(["/openapi.json", "/docs"]);
    for (const route of app.routes) {
      if (!route.path.startsWith("/api/v1/") || route.method === "ALL") continue;
      const path = route.path.slice("/api/v1".length).replace(/:([^/]+)/g, "{$1}");
      if (exclusions.has(path)) continue;
      expect(spec.paths[path]?.[route.method.toLowerCase()], `${route.method} ${path}`).toBeDefined();
    }
  });
  it("all SSE operations reference a registered event schema", () => {
    const spec = buildOpenApiSpec() as { paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, unknown>; "x-sse-event-schema"?: { $ref: string } }> }>>; components: { schemas: Record<string, unknown> } };
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const operation of Object.values(operations)) {
        for (const response of Object.values(operation.responses ?? {})) {
          if (!response.content?.["text/event-stream"]) continue;
          // extension is carried by the media object (same convention for every SSE operation)
          const media = response.content["text/event-stream"] as { "x-sse-event-schema"?: { $ref: string } };
          const ref = media["x-sse-event-schema"]?.$ref;
          expect(ref, path).toBeDefined();
          expect(spec.components.schemas[ref!.split("/").at(-1)!], path).toBeDefined();
        }
      }
    }
  });
});
