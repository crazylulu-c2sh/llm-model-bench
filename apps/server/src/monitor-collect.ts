import type { LoadedModelInfo } from "@llm-bench/shared";
import { lmStudioListModels } from "./lmstudio.js";
import { lmsPs } from "./lms-cli.js";

export type ProviderLoadedSource = "http" | "cli" | "none";

export type ProviderLoadedResult = {
  source: ProviderLoadedSource;
  loaded: LoadedModelInfo[];
  http?: { ok: boolean; status?: number; error?: string };
  cli?: { ok: boolean; error?: string };
};

type LmStudioInstance = Record<string, unknown>;

/**
 * LM Studio 로드된 모델 수집.
 * HTTP `/api/v1/models`(또는 v0) 우선. HTTP 실패 시 `allowCli && env on`이면 `lms ps` fallback.
 *
 * `allowCli`는 호출자(라우트)가 클라이언트 IP가 loopback인지 + ENV가 켜졌는지를 검사한 결과를 넘김.
 * 비-loopback 클라이언트는 false로 호출해 CLI fallback이 절대 일어나지 않도록 한다.
 */
export async function collectLmStudioLoaded(
  baseUrl: string,
  opts: { apiKey?: string; allowCli: boolean },
): Promise<ProviderLoadedResult> {
  let listed: Awaited<ReturnType<typeof lmStudioListModels>>;
  try {
    // 5초 timeout — Ollama 경로와 일관, 죽은 호스트에서 snapshot 전체가 hang 안 되게.
    listed = await lmStudioListModels(baseUrl, { apiKey: opts.apiKey, timeoutMs: 5000 });
  } catch (e) {
    listed = { ok: false, status: 0, models: [], body: (e as Error).message };
  }
  if (listed.ok) {
    const loaded: LoadedModelInfo[] = [];
    for (const m of listed.models) {
      if (!m || typeof m.key !== "string") continue;
      const instances = Array.isArray(m.loaded_instances) ? (m.loaded_instances as LmStudioInstance[]) : [];
      if (instances.length === 0) continue;
      for (const inst of instances) {
        const id = typeof inst.id === "string" ? inst.id : m.key;
        const vram = numberField(inst, ["vram_usage", "vram", "vram_bytes"]);
        const ram = numberField(inst, ["ram_usage", "ram", "ram_bytes"]);
        const ctx = numberField(inst, ["context_length", "context", "ctx"]);
        loaded.push({
          id,
          name: m.key,
          vramBytes: vram,
          ramBytes: ram,
          contextLength: ctx,
        });
      }
    }
    return { source: "http", loaded, http: { ok: true, status: listed.status } };
  }

  // HTTP 실패. CLI fallback은 라우트가 허용했을 때만.
  if (opts.allowCli) {
    try {
      const cli = await lmsPs(5000);
      if (cli.ok) {
        return {
          source: "cli",
          loaded: parseLmsPsOutput(cli.stdout ?? ""),
          http: { ok: false, status: listed.status, error: listed.body },
          cli: { ok: true },
        };
      }
      return {
        source: "none",
        loaded: [],
        http: { ok: false, status: listed.status, error: listed.body },
        cli: { ok: false, error: cli.error },
      };
    } catch (e) {
      // env off 등 — fallback 불가
      return {
        source: "none",
        loaded: [],
        http: { ok: false, status: listed.status, error: listed.body },
        cli: { ok: false, error: (e as Error).message },
      };
    }
  }

  return {
    source: "none",
    loaded: [],
    http: { ok: false, status: listed.status, error: listed.body },
  };
}

function numberField(obj: LmStudioInstance, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

export function parseLmsPsOutput(stdout: string): LoadedModelInfo[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = pickArray(parsed);
      return list
        .map((x): LoadedModelInfo | null => {
          if (!x || typeof x !== "object") return null;
          const obj = x as Record<string, unknown>;
          const id = pickString(obj, ["id", "key", "identifier", "modelKey", "model"]);
          if (!id) return null;
          return {
            id,
            name: pickString(obj, ["name", "displayName"]),
            vramBytes: numberField(obj, ["vram", "vram_bytes", "vramUsage"]),
            ramBytes: numberField(obj, ["ram", "ram_bytes", "ramUsage"]),
            contextLength: numberField(obj, ["context_length", "contextLength", "ctx"]),
            raw: obj,
          };
        })
        .filter((m): m is LoadedModelInfo => m !== null);
    } catch {
      // fallthrough to plain
    }
  }
  // Plain text fallback: 헤더 + 행
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const out: LoadedModelInfo[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0) continue;
    out.push({ id: cols[0], name: cols[0] });
  }
  return out;
}

function pickArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const candidates = ["models", "items", "data"] as const;
    for (const k of candidates) {
      const v = (parsed as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export async function collectOllamaLoaded(baseUrl: string): Promise<ProviderLoadedResult> {
  const root = baseUrl.replace(/\/+$/, "");
  try {
    // 5초 timeout — 죽은 호스트에서 snapshot 전체가 hang하는 것을 방지.
    const r = await fetch(`${root}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        source: "none",
        loaded: [],
        http: { ok: false, status: r.status, error: text.slice(0, 500) || r.statusText },
      };
    }
    const j = (await r.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        size_vram?: number;
        size?: number;
        details?: { parameter_size?: string };
      }>;
    };
    const list = Array.isArray(j.models) ? j.models : [];
    const loaded: LoadedModelInfo[] = list
      .map((m): LoadedModelInfo | null => {
        const id = m.model ?? m.name;
        if (!id) return null;
        return {
          id,
          name: m.name ?? m.model,
          vramBytes: typeof m.size_vram === "number" ? m.size_vram : undefined,
          sizeBytes: typeof m.size === "number" ? m.size : undefined,
        };
      })
      .filter((m): m is LoadedModelInfo => m !== null);
    return { source: "http", loaded, http: { ok: true, status: r.status } };
  } catch (e) {
    return { source: "none", loaded: [], http: { ok: false, error: (e as Error).message } };
  }
}
