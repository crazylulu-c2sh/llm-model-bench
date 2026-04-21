import type { DetectResult, DetectStep, ProviderKind } from "@llm-bench/shared";

export type FetchLike = typeof fetch;

function normalizeBaseUrl(raw: string): string {
  const u = raw.trim().replace(/\/+$/, "");
  if (!u.startsWith("http")) return `http://${u}`;
  return u;
}

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export async function detectProvider(
  rawBaseUrl: string,
  opts: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] };
  } = {},
): Promise<DetectResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const steps: DetectStep[] = [];

  if (opts.manual?.provider && opts.manual.provider !== "manual") {
    const models = opts.manual.models?.length
      ? opts.manual.models
      : [{ id: "manual-model", label: "manual-model" }];
    const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
    return {
      provider: opts.manual.provider,
      baseUrl,
      models,
      steps: [{ name: "manual", ok: true, detail: opts.manual.provider }],
      capabilities: caps,
    };
  }

  // 1) LM Studio native list
  try {
    const r = await fetchImpl(`${baseUrl}/api/v1/models`, {
      headers: headers(opts.apiKey),
    });
    steps.push({
      name: "lm_studio_list",
      ok: r.ok,
      status: r.status,
    });
    if (r.ok) {
      const j = (await r.json()) as { models?: unknown[] };
      if (Array.isArray(j.models) && j.models.length > 0) {
        const first = j.models[0] as { key?: string; type?: string; display_name?: string };
        if (first && typeof first.key === "string") {
          const models = j.models
            .map((m) => m as { key: string; type?: string; display_name?: string })
            .filter((m) => m.key && (m.type === "llm" || !m.type))
            .map((m) => ({
              id: m.key,
              label: m.display_name ?? m.key,
              kind: m.type,
            }));
          const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
          return {
            provider: "lm_studio",
            baseUrl,
            models: models.length ? models : [{ id: first.key, label: first.display_name }],
            steps,
            capabilities: caps,
          };
        }
      }
    }
  } catch (e) {
    steps.push({
      name: "lm_studio_list",
      ok: false,
      detail: String(e),
    });
  }

  // 2) Ollama tags
  try {
    const r = await fetchImpl(`${baseUrl}/api/tags`, { headers: headers(opts.apiKey) });
    steps.push({ name: "ollama_tags", ok: r.ok, status: r.status });
    if (r.ok) {
      const j = (await r.json()) as { models?: { name: string; model?: string }[] };
      if (Array.isArray(j.models)) {
        const models = j.models.map((m) => ({
          id: m.name ?? m.model ?? "unknown",
          label: m.name,
        }));
        const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
        return {
          provider: "ollama",
          baseUrl,
          models,
          steps,
          capabilities: caps,
        };
      }
    }
  } catch (e) {
    steps.push({ name: "ollama_tags", ok: false, detail: String(e) });
  }

  // 3) OpenAI-compatible list
  try {
    const r = await fetchImpl(`${baseUrl}/v1/models`, { headers: headers(opts.apiKey) });
    steps.push({ name: "openai_models", ok: r.ok, status: r.status });
    if (r.ok) {
      const j = (await r.json()) as { data?: { id: string }[] };
      const arr = j.data;
      if (Array.isArray(arr) && arr.length > 0) {
        const models = arr.map((m) => ({ id: m.id, label: m.id }));
        const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
        return {
          provider: "openai_compatible",
          baseUrl,
          models,
          steps,
          capabilities: caps,
        };
      }
    }
  } catch (e) {
    steps.push({ name: "openai_models", ok: false, detail: String(e) });
  }

  const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
  return {
    provider: "manual",
    baseUrl,
    models: [],
    steps,
    capabilities: caps,
  };
}

async function probeCapabilities(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey?: string,
): Promise<{ openaiChat: boolean; anthropicMessages: boolean }> {
  const h = headers(apiKey);
  let openaiChat = false;
  let anthropicMessages = false;

  try {
    const r = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({
        model: "probe-model",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    openaiChat = r.status !== 404 && r.status !== 405;
  } catch {
    openaiChat = false;
  }

  try {
    const r = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        ...h,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "probe-model",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    anthropicMessages = r.status !== 404 && r.status !== 405;
  } catch {
    anthropicMessages = false;
  }

  return { openaiChat, anthropicMessages };
}
