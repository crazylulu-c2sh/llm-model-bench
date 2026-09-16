import { describe, expect, it, vi } from "vitest";
import {
  detectProvider,
  messagesRouteLikelyAvailable,
  parseAppleFmHealth,
  routeLikelyAvailable,
} from "./detect.js";

function jsonResponse(obj: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function textResponse(body: string, status = 200) {
  return Promise.resolve(new Response(body, { status }));
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("detectProvider", () => {
  it("detects LM Studio from /api/v1/models", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "m1",
              type: "llm",
              display_name: "M1",
              publisher: "unsloth",
              size_bytes: 4_000_000_000,
              params_string: "7B",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
    expect(r.models[0]?.publisher).toBe("unsloth");
    expect(r.models[0]?.size_bytes).toBe(4_000_000_000);
    expect(r.models[0]?.params_string).toBe("7B");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("#182: merges compatibility_type/quantization/arch from /api/v0/models when available", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [{ key: "m1", type: "llm", display_name: "M1", loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({
          data: [{ id: "m1", compatibility_type: "gguf", quantization: "Q4_K_M", arch: "qwen35" }],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.models[0]?.compatibility_type).toBe("gguf");
    expect(r.models[0]?.quantization).toBe("Q4_K_M");
    expect(r.models[0]?.arch).toBe("qwen35");
  });

  it("#194 후속: merges max_context_length from /api/v0/models — 로드 시 안전 상한 계산 입력", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [{ key: "m1", type: "llm", display_name: "M1", loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({ data: [{ id: "m1", max_context_length: 262_144 }] });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.models[0]?.max_context_length).toBe(262_144);
  });

  it("#159 후속: v0의 arch(_mtp 접미사)로 id/label만으로는 놓치는 진짜 MTP 드래프트를 거른다", async () => {
    // 실측(로컬 LM Studio 카탈로그) 재현 — qwen3.8-27b-mtp@8bit 는 id에 `-mtp@`가 있어
    // 본체크포인트 예외에 걸리므로 id/label 규칙만으로는 계속 살아남는다. arch가
    // qwen3_5_mtp 로 v0에서 오면 걸러져야 한다. 나란히 있는 진짜 본체(정상 arch)는 유지.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            { key: "qwen/qwen3.8-27b", type: "llm", display_name: "Qwen3.8 27B", loaded_instances: [] },
            {
              key: "qwen3.8-27b-mtp@8bit",
              type: "llm",
              display_name: "Qwen3.8 27B MTP",
              loaded_instances: [],
            },
          ],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({
          data: [
            { id: "qwen/qwen3.8-27b", compatibility_type: "mlx", quantization: "4bit", arch: "qwen3_5" },
            {
              id: "qwen3.8-27b-mtp@8bit",
              compatibility_type: "mlx",
              quantization: "8bit",
              arch: "qwen3_5_mtp",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.models.map((m) => m.id)).toEqual(["qwen/qwen3.8-27b"]);
  });

  it("#182: v0 enrichment failing (non-2xx) does not break the v1-only result", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [{ key: "m1", type: "llm", display_name: "M1", loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
    expect(r.models[0]?.compatibility_type).toBeUndefined();
  });

  it("#182: v0 enrichment throwing (network error) does not break the v1-only result", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [{ key: "m1", type: "llm", display_name: "M1", loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        throw new Error("network down");
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("filters imatrix / MTP draft / mmproj artifacts from LM Studio list", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "qwen3.8-27b@?",
              type: "llm",
              display_name: "Imatrix Unsloth",
              loaded_instances: [],
            },
            {
              key: "qwen3.8-27b@q4_0",
              type: "llm",
              display_name: "Mtp Qwen3.8 27B",
              loaded_instances: [],
            },
            {
              key: "mmproj-F16",
              type: "llm",
              display_name: "mmproj F16",
              loaded_instances: [],
            },
            {
              key: "qwen3.8-27b@iq1_s",
              type: "llm",
              display_name: "Qwen3.8 27B UD",
              loaded_instances: [],
            },
            {
              key: "qwen3.6-35b-a3b-mtp@q4_k_m",
              type: "llm",
              display_name: "Qwen3.6 35B A3B UD",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.models.map((m) => m.id)).toEqual([
      "qwen3.8-27b@iq1_s",
      "qwen3.6-35b-a3b-mtp@q4_k_m",
    ]);
  });

  it("falls back to org/ prefix when LM Studio omits publisher", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "qwen/qwen3.8-27b",
              type: "llm",
              display_name: "Qwen3.8 27B",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.publisher).toBe("qwen");
  });

  it("normalizes trailing /v1 on base URL and still detects LM Studio", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "m1",
              type: "llm",
              display_name: "M1",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234/v1/", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:1234");
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("falls back to Ollama when LM list missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "llama3", size: 2_000_000_000 }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:11434", { fetchImpl });
    expect(r.provider).toBe("ollama");
    expect(r.models[0]?.id).toBe("llama3");
    expect(r.models[0]?.size_bytes).toBe(2_000_000_000);
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(false);
    expect(r.reachability?.state).toBe("ok");
  });

  it("falls back to OpenAI-compatible", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "gpt-test" }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.models[0]?.id).toBe("gpt-test");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
    expect(r.engine ?? null).toBeNull();
  });

  it("sets engine sglang from /server_info after openai_compatible", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "qwen" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info")) {
        return jsonResponse({
          version: "0.4.1",
          mem_fraction_static: 0.88,
          internal_states: [],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:30000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.engine).toBe("sglang");
    expect(r.steps.some((s) => s.name === "sglang_server_info" && s.ok)).toBe(true);
    // metrics must not be probed once SGLang is confirmed
    expect(fetchImpl.mock.calls.some((c) => requestUrl(c[0]).endsWith("/metrics"))).toBe(false);
  });

  it("falls back to legacy /get_server_info for SGLang", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "m" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info")) return jsonResponse({}, 404);
      if (url.endsWith("/get_server_info")) {
        return jsonResponse({
          version: "0.3.0",
          schedule_conservativeness: 1,
          max_total_num_tokens: 8192,
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:30000", { fetchImpl });
    expect(r.engine).toBe("sglang");
    expect(r.steps.find((s) => s.name === "sglang_server_info" && s.ok)?.detail).toBe(
      "/get_server_info",
    );
  });

  it("sets engine vllm from /metrics vllm: gauges", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "llama" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info") || url.endsWith("/get_server_info")) {
        return jsonResponse({}, 404);
      }
      if (url.endsWith("/metrics")) {
        return textResponse("# HELP\nvllm:num_requests_running 0.0\nvllm:num_requests_waiting 0\n");
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.engine).toBe("vllm");
    expect(r.steps.find((s) => s.name === "vllm_metrics" && s.ok)?.detail).toBe("vllm");
  });

  it("sets engine llamacpp from /metrics llamacpp: gauges", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "gguf-model" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info") || url.endsWith("/get_server_info")) {
        return jsonResponse({}, 404);
      }
      if (url.endsWith("/metrics")) {
        return textResponse("llamacpp:requests_processing 0\nllamacpp:requests_deferred 0\n");
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8080", { fetchImpl });
    expect(r.engine).toBe("llamacpp");
    expect(r.steps.find((s) => s.name === "vllm_metrics" && s.ok)?.detail).toBe("llamacpp");
  });

  it("sets engine tgi from /metrics tgi_ gauges", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "tgi-model" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info") || url.endsWith("/get_server_info")) {
        return jsonResponse({}, 404);
      }
      if (url.endsWith("/metrics")) {
        return textResponse("tgi_batch_current_size 1\ntgi_queue_size 0\n");
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8080", { fetchImpl });
    expect(r.engine).toBe("tgi");
    expect(r.steps.find((s) => s.name === "vllm_metrics" && s.ok)?.detail).toBe("tgi");
  });

  it("prefers vllm over llamacpp when both prefixes appear in /metrics", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "m" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/server_info") || url.endsWith("/get_server_info")) {
        return jsonResponse({}, 404);
      }
      if (url.endsWith("/metrics")) {
        return textResponse(
          "llamacpp:requests_processing 0\nvllm:num_requests_running 0\n",
        );
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.engine).toBe("vllm");
  });

  it("leaves engine null when /metrics has no known gauges", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "generic" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      if (url.endsWith("/metrics")) return textResponse("custom_app_requests 0\n");
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8080", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.engine).toBeNull();
    expect(r.steps.find((s) => s.name === "vllm_metrics")?.detail).toBe("no_known_gauges");
  });

  it("detects Unsloth Studio from /api/models/list (before OpenAI /v1/models)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) {
        return jsonResponse({
          models: [
            { id: "unsloth/Qwen3.8-27B-GGUF", name: "Qwen3.8 27B", is_gguf: true },
            { id: "tts-model", name: "TTS", is_audio: true },
          ],
          default_models: ["unsloth/Qwen3.8-27B-GGUF"],
        });
      }
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "only-loaded" }] });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8888", {
      fetchImpl,
      apiKey: "sk-unsloth-test",
    });
    expect(r.provider).toBe("unsloth_studio");
    expect(r.models.map((m) => m.id)).toEqual(["unsloth/Qwen3.8-27B-GGUF"]);
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("does not claim Unsloth Studio on 401 from /api/models/list", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/api/models/list")) return jsonResponse({ detail: "Unauthorized" }, 401);
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "loaded-only" }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8888", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.steps.find((s) => s.name === "unsloth_models")?.detail).toBe("unauthorized");
    expect(r.models[0]?.id).toBe("loaded-only");
  });

  it("requires default_models fingerprint for Unsloth Studio", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      // models만 있고 default_models 없음 → Unsloth로 단정하지 않음
      if (url.endsWith("/api/models/list")) {
        return jsonResponse({ models: [{ id: "fake" }] });
      }
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "gpt-test" }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.steps.find((s) => s.name === "unsloth_models")?.detail).toBe("unrecognized_model_shape");
  });

  it("treats Ollama-style 404 JSON model-not-found as chat route available", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "gpt-test" }] });
      }
      if (url.includes("/v1/chat/completions")) {
        return jsonResponse({ error: { message: "model 'probe-model' not found" } }, 404);
      }
      if (url.includes("/v1/messages")) return textResponse("404 page not found", 404);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(false);
  });

  it("treats plain 404 page-not-found as route unavailable", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [] }, 200);
      if (url.includes("/v1/chat/completions")) return textResponse("404 page not found", 404);
      if (url.includes("/v1/messages")) return textResponse("404 page not found", 404);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("manual");
    expect(r.capabilities.openaiChat).toBe(false);
    expect(r.capabilities.anthropicMessages).toBe(false);
  });

  it("treats empty LM Studio /api/v1/models as lm_studio with zero models", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({ models: [] });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models).toEqual([]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("empty_model_list");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("reports unreachable when all model list requests fail at network layer", async () => {
    const fetchImpl = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    const r = await detectProvider("http://localhost:59999", { fetchImpl });
    expect(r.reachability?.ok).toBe(false);
    expect(r.reachability?.state).toBe("unreachable");
    expect(r.provider).toBe("manual");
    expect(r.models).toEqual([]);
  });

  it("reports partial reachability when one list path throws and others respond", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return Promise.reject(new TypeError("fetch failed"));
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [] }, 200);
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.reachability?.state).toBe("partial");
    expect(r.provider).toBe("manual");
    expect(r.models).toEqual([]);
  });

  it("keeps the transport error code so firewall/permission failures stay distinguishable", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new TypeError("fetch failed");
      (e as { cause?: unknown }).cause = { code: "EHOSTUNREACH", syscall: "connect" };
      return Promise.reject(e);
    });
    const r = await detectProvider("http://192.168.0.9:11234", { fetchImpl });
    expect(r.reachability?.state).toBe("unreachable");
    expect(r.reachability?.reason).toContain("EHOSTUNREACH");
  });

  it("stops probing once the origin is proven dead", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new TypeError("fetch failed");
      (e as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
      return Promise.reject(e);
    });
    const r = await detectProvider("http://localhost:59999", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.steps).toHaveLength(1);
    expect(r.capabilities).toEqual({ openaiChat: false, anthropicMessages: false });
    expect(r.reachability?.state).toBe("unreachable");
  });

  it("bounds every request so an unresponsive host cannot stall detection", async () => {
    const signals: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return jsonResponse({}, 404);
    });
    await detectProvider("http://localhost:8000", { fetchImpl, timeoutMs: 1_000 });
    expect(signals).toHaveLength(6);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("does not claim LM Studio when a 200 body carries no models array", async () => {
    // LM Studio는 모르는 경로에도 200 + {"error":…}를 준다.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/models") && !url.includes("/api/"))
        return jsonResponse({ data: [{ id: "m1" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({ error: "Unexpected endpoint or method." }, 200);
    });
    const r = await detectProvider("http://localhost:11234", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.models.map((m) => m.id)).toEqual(["m1"]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe(
      "unrecognized_model_shape",
    );
  });

  it("normalizes LM Studio's own /api/v1 base back to the server root", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(requestUrl(input));
      if (requestUrl(input).endsWith("/api/v1/models"))
        return jsonResponse({ models: [{ key: "m1", type: "llm", display_name: "M1" }] });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:11234/api/v1", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:11234");
    expect(seen[0]).toBe("http://localhost:11234/api/v1/models");
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("treats an uppercase scheme as a scheme instead of a hostname", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(requestUrl(input));
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("HTTP://localhost:1234", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:1234");
    expect(seen[0]).toBe("http://localhost:1234/api/v1/models");
  });

  it("keeps a body-parse failure from being misread as partial reachability", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return textResponse("<html>not json</html>", 200);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.steps.filter((s) => s.name === "lm_studio_list")).toHaveLength(1);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("invalid_json");
    expect(r.reachability?.state).toBe("ok");
  });

  it("drops an embedding-only LM Studio list instead of resurrecting the filtered model", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models"))
        return jsonResponse({
          models: [{ key: "text-embedding-nomic", type: "embedding", display_name: "Nomic" }],
        });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models).toEqual([]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("no_benchable_model");
  });
});

/** `fm serve`가 모르는 라우트에 돌려주는 JSON 404 — 슬래시가 `\/`로 이스케이프된 원문 그대로. */
function fmServeNotFound(method: string, path: string): string {
  return `{"error":{"code":"404","type":"not_found","message":"Not found: ${method} ${path.replace(/\//g, "\\/")}"}}`;
}

function rawJsonResponse(body: string, status: number) {
  return Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }));
}

describe("route probes: per-probe availability table", () => {
  // [설명, status, body, chat 프로브 기대값, messages 프로브 기대값]
  const cases: Array<[string, number, string, boolean, boolean]> = [
    [
      "Ollama model-not-found (existing fixture)",
      404,
      JSON.stringify({ error: { message: "model 'probe-model' not found" } }),
      true,
      true,
    ],
    [
      "Ollama model-not-found, try pulling it first",
      404,
      JSON.stringify({ error: { message: 'model "probe-model" not found, try pulling it first', type: "api_error" } }),
      true,
      true,
    ],
    [
      "OpenAI model_not_found",
      404,
      JSON.stringify({
        error: {
          message: "The model `probe-model` does not exist or you do not have access to it.",
          type: "invalid_request_error",
          param: null,
          code: "model_not_found",
        },
      }),
      true,
      true,
    ],
    [
      "vLLM NotFoundError (chat)",
      404,
      JSON.stringify({
        error: { message: "The model `probe-model` does not exist.", type: "NotFoundError", param: "model", code: 404 },
      }),
      true,
      true,
    ],
    [
      "vLLM Anthropic-shaped error (messages)",
      404,
      JSON.stringify({ type: "error", error: { type: "not_found_error", message: "The model `probe-model` does not exist." } }),
      true,
      true,
    ],
    [
      "llama.cpp unknown route File Not Found",
      404,
      JSON.stringify({ error: { message: "File Not Found", type: "not_found_error", code: 404 } }),
      true,
      false,
    ],
    ["fm serve escaped route echo", 404, fmServeNotFound("POST", "/v1/messages"), true, false],
    [
      "route echo that also mentions a model is still a missing route",
      404,
      JSON.stringify({ error: { message: "Not found: POST /v1/messages (model router)" } }),
      true,
      false,
    ],
    ["FastAPI default {detail: Not Found}", 404, JSON.stringify({ detail: "Not Found" }), true, false],
    ["empty JSON object", 404, "{}", true, false],
    ["invalid JSON starting with {", 404, "{model", true, false],
    ["plain-text 404 page not found", 404, "404 page not found", false, false],
    ["400 bad model", 400, JSON.stringify({ error: "Unknown model probe-model" }), true, true],
    ["401 unauthorized", 401, "", true, true],
    ["200 ok", 200, "{}", true, true],
    ["500 server error", 500, JSON.stringify({ error: "boom" }), false, false],
  ];

  it.each(cases)("%s", (_label, status, body, chatExpected, messagesExpected) => {
    expect(routeLikelyAvailable(status, body)).toBe(chatExpected);
    expect(messagesRouteLikelyAvailable(status, body)).toBe(messagesExpected);
  });

  it("the raw fm serve body only matches the route echo after a JSON round-trip", () => {
    const raw = fmServeNotFound("POST", "/v1/messages");
    expect(raw).toContain("POST \\/v1\\/messages");
    expect(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*/.test(raw)).toBe(false);
    expect(messagesRouteLikelyAvailable(404, raw)).toBe(false);
  });
});

describe("detectProvider: fm serve and Apple Foundation Models server", () => {
  it("fm serve: keeps chat, rejects the escaped JSON 404 on /v1/messages, and leaves engine null", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const path = new URL(url).pathname;
      if (path === "/v1/models") {
        return jsonResponse({ object: "list", data: [{ id: "system", object: "model", owned_by: "apple" }] });
      }
      if (path === "/v1/chat/completions") {
        return jsonResponse(
          { error: { code: "400", type: "invalid_request_error", message: "Unknown model: probe-model" } },
          400,
        );
      }
      if (path === "/health") {
        return jsonResponse({ models: ["system"], status: "fm serve is running" });
      }
      return rawJsonResponse(fmServeNotFound(method, path), 404);
    });
    const r = await detectProvider("http://127.0.0.1:18080", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.models.map((m) => m.id)).toEqual(["system"]);
    expect(r.capabilities).toEqual({ openaiChat: true, anthropicMessages: false });
    expect(r.engine ?? null).toBeNull();
    expect(r.engine_version).toBeUndefined();
    expect(r.steps.find((s) => s.name === "apple_fm_health")).toMatchObject({
      ok: false,
      status: 200,
      detail: "/health:unrecognized_shape",
    });
  });

  it("apple_fm: /health self-report sets engine + engine_version and skips SGLang/metrics probes", async () => {
    const engineVersion =
      "apple-fm-server/0.1.0; macOS 27.0 (26A428); AFM 3 Core Advanced; assets 1a2b3c4d; continuation=sentinel; tool_value_guides=off";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === "/v1/models") {
        return jsonResponse({
          object: "list",
          data: [
            { id: "apple-afm-3-core-advanced", owned_by: "apple", context_length: 8192, arch: "AFM 3 Core Advanced" },
          ],
        });
      }
      if (path === "/v1/chat/completions") {
        return jsonResponse({ error: { message: "model not found", code: "model_not_found" } }, 404);
      }
      if (path === "/health") {
        return jsonResponse({
          status: "ok",
          engine: "apple_fm",
          engine_version: engineVersion,
          available: true,
          queue: { active: 0, waiting: 0 },
        });
      }
      return textResponse("Not Found", 404);
    });
    const r = await detectProvider("http://127.0.0.1:18976", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.engine).toBe("apple_fm");
    expect(r.engine_version).toBe(engineVersion);
    expect(r.capabilities).toEqual({ openaiChat: true, anthropicMessages: false });
    expect(r.models[0]).toMatchObject({ arch: "AFM 3 Core Advanced", max_context_length: 8192 });
    expect(r.steps.find((s) => s.name === "apple_fm_health")).toMatchObject({ ok: true, status: 200, detail: "/health" });
    const probed = fetchImpl.mock.calls.map((c) => new URL(requestUrl(c[0])).pathname);
    expect(probed).not.toContain("/server_info");
    expect(probed).not.toContain("/metrics");
  });

  it("apple_fm: omits engine_version when /health does not report one", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === "/v1/models") return jsonResponse({ data: [{ id: "apple-afm-3-core" }] });
      if (path === "/v1/chat/completions") return jsonResponse({ error: "x" }, 400);
      if (path === "/health") return jsonResponse({ engine: "apple_fm", engine_version: "   " });
      return textResponse("Not Found", 404);
    });
    const r = await detectProvider("http://127.0.0.1:18976", { fetchImpl });
    expect(r.engine).toBe("apple_fm");
    expect(r.engine_version).toBeUndefined();
    expect("engine_version" in r).toBe(false);
  });

  it("a non-apple /health (e.g. MTPLX) records a failed apple_fm_health step and still reaches SGLang", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === "/v1/models") return jsonResponse({ data: [{ id: "qwen" }] });
      if (path === "/v1/chat/completions" || path === "/v1/messages") return jsonResponse({ error: "x" }, 400);
      if (path === "/health") {
        return jsonResponse({ ok: true, generation_mode: "serial", active_requests: 0 });
      }
      if (path === "/server_info") {
        return jsonResponse({ version: "0.4.1", mem_fraction_static: 0.88, internal_states: [] });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:30000", { fetchImpl });
    expect(r.engine).toBe("sglang");
    expect(r.engine_version).toBeUndefined();
    const names = r.steps.map((s) => s.name);
    expect(names.indexOf("apple_fm_health")).toBeLessThan(names.indexOf("sglang_server_info"));
    expect(r.steps.find((s) => s.name === "apple_fm_health")).toMatchObject({
      ok: false,
      detail: "/health:unrecognized_shape",
    });
  });

  it("a throwing /health does not stop the /metrics engine probe", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === "/v1/models") return jsonResponse({ data: [{ id: "llama" }] });
      if (path === "/v1/chat/completions" || path === "/v1/messages") return jsonResponse({ error: "x" }, 400);
      if (path === "/health") return Promise.reject(new TypeError("fetch failed"));
      if (path === "/metrics") return textResponse("vllm:num_requests_running 0\nvllm:num_requests_waiting 0\n");
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.engine).toBe("vllm");
    const health = r.steps.find((s) => s.name === "apple_fm_health");
    expect(health?.ok).toBe(false);
    expect(health?.detail).toMatch(/^\/health:TypeError: fetch failed/);
  });
});

describe("parseAppleFmHealth", () => {
  it("accepts only a plain object whose engine is apple_fm", () => {
    expect(parseAppleFmHealth({ engine: "apple_fm", engine_version: "v1" })).toEqual({ engine_version: "v1" });
    expect(parseAppleFmHealth({ engine: "apple_fm" })).toEqual({});
    expect(parseAppleFmHealth({ engine: "vllm", engine_version: "v1" })).toBeNull();
    expect(parseAppleFmHealth({ status: "fm serve is running" })).toBeNull();
    expect(parseAppleFmHealth([{ engine: "apple_fm" }])).toBeNull();
    expect(parseAppleFmHealth("apple_fm")).toBeNull();
    expect(parseAppleFmHealth(null)).toBeNull();
  });

  it("trims engine_version, drops blank or non-string values and caps the length", () => {
    expect(parseAppleFmHealth({ engine: "apple_fm", engine_version: "  v2  " })).toEqual({ engine_version: "v2" });
    expect(parseAppleFmHealth({ engine: "apple_fm", engine_version: 3 })).toEqual({});
    const long = parseAppleFmHealth({ engine: "apple_fm", engine_version: "x".repeat(500) });
    expect(long?.engine_version).toHaveLength(200);
  });
});

describe("detectProvider: OpenAI-compatible /v1/models row fields", () => {
  it("maps a non-empty string arch and a positive context_length, ignoring malformed values", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === "/v1/models") {
        return jsonResponse({
          data: [
            { id: "good", arch: " AFM 3 Core ", context_length: 8192 },
            { id: "blank-arch", arch: "   ", context_length: 0 },
            { id: "wrong-types", arch: 42, context_length: "8192" },
            { id: "negative", context_length: -1 },
            // arch가 드래프트 접미사로 끝나도 목록 필터에 넘기지 않으므로 모델이 사라지지 않는다.
            { id: "draft-looking-arch", arch: "qwen35_mtp" },
          ],
        });
      }
      if (path === "/v1/chat/completions") return jsonResponse({ error: "x" }, 400);
      return textResponse("Not Found", 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    const byId = new Map(r.models.map((m) => [m.id, m]));
    expect(byId.get("good")).toMatchObject({ arch: "AFM 3 Core", max_context_length: 8192 });
    for (const id of ["blank-arch", "wrong-types", "negative"]) {
      expect(byId.get(id)?.arch).toBeUndefined();
      expect(byId.get(id)?.max_context_length).toBeUndefined();
    }
    expect(byId.get("draft-looking-arch")?.arch).toBe("qwen35_mtp");
  });
});
