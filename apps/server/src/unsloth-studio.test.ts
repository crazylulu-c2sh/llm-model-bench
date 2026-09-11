import { describe, expect, it, vi } from "vitest";
import {
  prepareUnslothStudioForRun,
  splitUnslothModelId,
  unslothLoad,
  unslothModelIdsMatch,
  unslothUnload,
} from "./unsloth-studio.js";

function jsonResponse(obj: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("splitUnslothModelId", () => {
  it("splits repo:VARIANT", () => {
    expect(splitUnslothModelId("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL")).toEqual({
      model_path: "unsloth/Qwen3.8-27B-GGUF",
      gguf_variant: "UD-Q4_K_XL",
    });
  });

  it("leaves plain repo ids alone", () => {
    expect(splitUnslothModelId("unsloth/gemma-4-26B")).toEqual({
      model_path: "unsloth/gemma-4-26B",
    });
  });

  it("does not treat Windows drive letters as variants", () => {
    expect(splitUnslothModelId("C:\\models\\foo.gguf")).toEqual({
      model_path: "C:\\models\\foo.gguf",
    });
  });
});

describe("unslothModelIdsMatch", () => {
  it("matches repo to repo:variant", () => {
    expect(unslothModelIdsMatch("unsloth/Qwen", "unsloth/Qwen:Q4_K_M")).toBe(true);
  });
});

describe("unslothLoad / unslothUnload", () => {
  it("POSTs load with model_path + gguf_variant", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("http://127.0.0.1:8888/api/inference/load");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model_path).toBe("unsloth/Qwen3.8-27B-GGUF");
      expect(body.gguf_variant).toBe("UD-Q4_K_XL");
      expect(body.force_cancel_active).toBe(true);
      return jsonResponse({ status: "loaded", model: "unsloth/Qwen3.8-27B-GGUF" });
    });
    const r = await unslothLoad("http://127.0.0.1:8888", "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", {
      fetchImpl,
      apiKey: "sk-unsloth-x",
      forceCancelActive: true,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("POSTs unload with model_path only", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("http://127.0.0.1:8888/api/inference/unload");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model_path).toBe("unsloth/Qwen3.8-27B-GGUF");
      return jsonResponse({ status: "unloaded", model: "unsloth/Qwen3.8-27B-GGUF" });
    });
    const r = await unslothUnload(
      "http://127.0.0.1:8888",
      "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL",
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
  });
});

describe("prepareUnslothStudioForRun", () => {
  it("skipModelLoad: never hits load", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const r = await prepareUnslothStudioForRun({
      baseUrl: "http://127.0.0.1:8888",
      modelId: "m1",
      skipModelLoad: true,
      fetchImpl,
    });
    expect(r).toEqual({ prepare: "load_skipped_by_request", loadedByThisRun: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("already_in_memory when status lists the model", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/inference/status")) {
        return jsonResponse({
          active_model: "unsloth/Qwen",
          loaded: ["unsloth/Qwen"],
          loading: [],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const r = await prepareUnslothStudioForRun({
      baseUrl: "http://127.0.0.1:8888",
      modelId: "unsloth/Qwen:Q4",
      skipModelLoad: false,
      fetchImpl,
    });
    expect(r.prepare).toBe("already_in_memory");
    expect(r.loadedByThisRun).toBe(false);
  });

  it("loads after unloading a different active model when unloadOtherModels", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/inference/status")) {
        return jsonResponse({
          active_model: "other/model",
          loaded: ["other/model"],
          loading: [],
        });
      }
      if (url.endsWith("/api/inference/unload")) {
        return jsonResponse({ status: "unloaded", model: "other/model" });
      }
      if (url.endsWith("/api/inference/load")) {
        return jsonResponse({ status: "loaded", model: "wanted" });
      }
      return jsonResponse({}, 404);
    });
    const r = await prepareUnslothStudioForRun({
      baseUrl: "http://127.0.0.1:8888",
      modelId: "wanted",
      skipModelLoad: false,
      unloadOtherModels: true,
      fetchImpl,
    });
    expect(r.prepare).toBe("loaded");
    expect(r.loadedByThisRun).toBe(true);
    expect(calls).toEqual([
      "GET http://127.0.0.1:8888/api/inference/status",
      "POST http://127.0.0.1:8888/api/inference/unload",
      "POST http://127.0.0.1:8888/api/inference/load",
    ]);
  });

  it("surfaces load failure", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/inference/status")) {
        return jsonResponse({ active_model: null, loaded: [], loading: [] });
      }
      if (url.endsWith("/api/inference/load")) {
        return jsonResponse({ detail: "OOM" }, 500);
      }
      return jsonResponse({}, 404);
    });
    const r = await prepareUnslothStudioForRun({
      baseUrl: "http://127.0.0.1:8888",
      modelId: "big",
      skipModelLoad: false,
      fetchImpl,
    });
    expect(r.loadedByThisRun).toBe(false);
    expect(r.error?.status).toBe(500);
  });
});
