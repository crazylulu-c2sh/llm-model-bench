import type { DetectResult, DetectStep, ProviderKind, Reachability } from "@llm-bench/shared";

export type FetchLike = typeof fetch;

const LIST_STEP_NAMES = ["lm_studio_list", "ollama_tags", "openai_models"] as const;

/** OpenAI 문서식 `…/v1` 베이스를 서버 루트로 맞춤 — 이 앱은 `base + /v1/...`로 조합합니다. */
function stripOpenAiStyleV1Suffix(u: string): string {
  try {
    const url = new URL(u);
    let path = url.pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
    const pl = path.toLowerCase();
    if (pl === "/v1" || pl.endsWith("/v1")) {
      path = path.slice(0, -3) || "/";
      url.pathname = path === "/" ? "/" : path;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return u.replace(/\/v1$/i, "");
  }
}

function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!u.startsWith("http")) u = `http://${u}`;
  u = stripOpenAiStyleV1Suffix(u);
  return u.replace(/\/+$/, "");
}

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function computeReachability(steps: DetectStep[]): Reachability {
  const list = steps.filter((s) => (LIST_STEP_NAMES as readonly string[]).includes(s.name));
  if (list.length === 0) return { ok: true, state: "ok" };

  const withoutStatus = list.filter((s) => s.status === undefined);
  if (withoutStatus.length === list.length) {
    return {
      ok: false,
      state: "unreachable",
      reason: withoutStatus[0]?.detail ?? "네트워크 연결에 실패했습니다.",
    };
  }
  if (withoutStatus.length > 0) {
    return {
      ok: false,
      state: "partial",
      reason: "모델 목록 일부 경로에만 응답했습니다.",
    };
  }
  return { ok: true, state: "ok" };
}

const reachOk: Reachability = { ok: true, state: "ok" };

/** `/api/v1/models`로 식별된 LM Studio는 OpenAI·Anthropic 호환 POST를 제공합니다. 가짜 모델명 프로브는 400이 나와 역능력 판별과 맞지 않으므로 고정합니다. */
const LM_STUDIO_COMPAT_CAPS = { openaiChat: true, anthropicMessages: true } as const;

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
    const caps =
      opts.manual.provider === "lm_studio"
        ? LM_STUDIO_COMPAT_CAPS
        : await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
    return {
      provider: opts.manual.provider,
      baseUrl,
      models,
      steps: [{ name: "manual", ok: true, detail: opts.manual.provider }],
      capabilities: caps,
      reachability: reachOk,
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
      const modelsArr = Array.isArray(j.models) ? j.models : [];
      if (modelsArr.length > 0) {
        const first = modelsArr[0] as { key?: string; type?: string; display_name?: string };
        if (first && typeof first.key === "string") {
          const models = modelsArr
            .map(
              (m) =>
                m as {
                  key: string;
                  type?: string;
                  display_name?: string;
                  size_bytes?: number;
                  params_string?: string | null;
                },
            )
            .filter((m) => m.key && (m.type === "llm" || !m.type))
            .map((m) => ({
              id: m.key,
              label: m.display_name ?? m.key,
              kind: m.type,
              size_bytes: typeof m.size_bytes === "number" && m.size_bytes > 0 ? m.size_bytes : undefined,
              params_string:
                typeof m.params_string === "string" && m.params_string.trim()
                  ? m.params_string.trim()
                  : undefined,
            }));
          return {
            provider: "lm_studio",
            baseUrl,
            models: models.length
              ? models
              : [
                  {
                    id: first.key,
                    label: first.display_name,
                    kind: first.type,
                    size_bytes:
                      typeof (first as { size_bytes?: number }).size_bytes === "number"
                        ? (first as { size_bytes: number }).size_bytes
                        : undefined,
                    params_string:
                      typeof (first as { params_string?: string | null }).params_string === "string" &&
                      (first as { params_string: string }).params_string.trim()
                        ? (first as { params_string: string }).params_string.trim()
                        : undefined,
                  },
                ],
            steps,
            capabilities: LM_STUDIO_COMPAT_CAPS,
            reachability: reachOk,
          };
        }
      }
      const lmIdx = steps.length - 1;
      const detail =
        modelsArr.length === 0 ? "empty_model_list" : "unrecognized_model_shape";
      steps[lmIdx] = { ...steps[lmIdx], detail };
      return {
        provider: "lm_studio",
        baseUrl,
        models: [],
        steps,
        capabilities: LM_STUDIO_COMPAT_CAPS,
        reachability: reachOk,
      };
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
        const models = j.models.map((m) => {
          const row = m as { name?: string; model?: string; size?: number };
          return {
            id: row.name ?? row.model ?? "unknown",
            label: row.name ?? row.model,
            size_bytes: typeof row.size === "number" && row.size > 0 ? row.size : undefined,
          };
        });
        const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
        return {
          provider: "ollama",
          baseUrl,
          models,
          steps,
          capabilities: caps,
          reachability: reachOk,
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
        const models = arr.map((m) => {
          const row = m as { id: string; size?: number };
          return {
            id: row.id,
            label: row.id,
            size_bytes: typeof row.size === "number" && row.size > 0 ? row.size : undefined,
          };
        });
        const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
        return {
          provider: "openai_compatible",
          baseUrl,
          models,
          steps,
          capabilities: caps,
          reachability: reachOk,
        };
      }
    }
  } catch (e) {
    steps.push({ name: "openai_models", ok: false, detail: String(e) });
  }

  const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey);
  const reachability = computeReachability(steps);
  return {
    provider: "manual",
    baseUrl,
    models: [],
    steps,
    capabilities: caps,
    reachability,
  };
}

/** Ollama·OpenAI 호환·manual 프로바이더용. LM Studio는 네이티브 목록으로 식별 시 `LM_STUDIO_COMPAT_CAPS`를 씁니다. */
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
    openaiChat = r.ok;
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
    anthropicMessages = r.ok;
  } catch {
    anthropicMessages = false;
  }

  return { openaiChat, anthropicMessages };
}
