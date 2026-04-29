import { z } from "zod";
import type { LlmProfileFamily, SamplingPresetName, ThinkingIntent } from "@llm-bench/shared";

export const PREFS_STORAGE_KEY = "llm-bench-ui-prefs";
export const SESSION_API_KEY = "llm-bench-api-key";

const STORAGE_VERSION = 2 as const;

const PrefsSchema = z
  .object({
    v: z.literal(STORAGE_VERSION),
    baseUrl: z.string().min(1).optional(),
    parallel: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    autoUnloadAfterBench: z.boolean().optional(),
    hlPreview: z.boolean().optional(),
    hlLog: z.boolean().optional(),
    persistApiKeyToDisk: z.boolean().optional(),
    apiKey: z.string().optional(),
    profileId: z
      .enum(["auto", "unknown", "gemma4", "qwen35", "qwen36", "gpt_oss", "minimax", "nemotron3", "qwen3_coder_next", "glm47_flash"])
      .optional(),
    profileMaxTokens: z.number().int().positive().optional(),
    thinkingIntent: z.enum(["on", "off"]).optional(),
    preserveThinking: z.boolean().optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    presetOverride: z
      .enum(["default", "thinking_general", "thinking_coding", "nonthinking_general", "tool_call"])
      .optional(),
    samplingOverridesJson: z.string().optional(),
    profileAdvancedOpen: z.boolean().optional(),
  })
  .passthrough();

export type UiPrefs = z.infer<typeof PrefsSchema>;

const DEFAULT_BASE = "http://127.0.0.1:1234";

function safeParsePrefs(raw: string | null): Partial<UiPrefs> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (typeof j !== "object" || j === null) return {};
    const obj = j as Record<string, unknown>;
    if (!("v" in obj)) obj.v = STORAGE_VERSION;
    if (obj.profileId === "minimax_m27") obj.profileId = "minimax";
    const parsed = PrefsSchema.safeParse(obj);
    if (parsed.success) return parsed.data;
    if (obj.v === 1) {
      const legacy = obj as Record<string, unknown>;
      return {
        v: STORAGE_VERSION,
        baseUrl: typeof legacy.baseUrl === "string" ? legacy.baseUrl : undefined,
        parallel: typeof legacy.parallel === "boolean" ? legacy.parallel : undefined,
        unloadOtherModels: typeof legacy.unloadOtherModels === "boolean" ? legacy.unloadOtherModels : undefined,
        autoUnloadAfterBench:
          typeof legacy.autoUnloadAfterBench === "boolean" ? legacy.autoUnloadAfterBench : undefined,
        hlPreview: typeof legacy.hlPreview === "boolean" ? legacy.hlPreview : undefined,
        hlLog: typeof legacy.hlLog === "boolean" ? legacy.hlLog : undefined,
        persistApiKeyToDisk: typeof legacy.persistApiKeyToDisk === "boolean" ? legacy.persistApiKeyToDisk : undefined,
        apiKey: typeof legacy.apiKey === "string" ? legacy.apiKey : undefined,
      };
    }
    return {};
  } catch {
    return {};
  }
}

export function readPrefsFromDisk(): Partial<UiPrefs> {
  if (typeof window === "undefined") return {};
  return safeParsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
}

function writePrefsToDisk(prefs: UiPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

export function readSessionApiKey(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SESSION_API_KEY) ?? "";
}

export function writeSessionApiKey(value: string) {
  if (typeof window === "undefined") return;
  if (value) sessionStorage.setItem(SESSION_API_KEY, value);
  else sessionStorage.removeItem(SESSION_API_KEY);
}

/** Full UI state for initial React state (client only). */
export function readInitialUiState() {
  if (typeof window === "undefined") {
    return {
      baseUrl: DEFAULT_BASE,
      parallel: false,
      unloadOtherModels: false,
      autoUnloadAfterBench: false,
      hlPreview: false,
      hlLog: false,
      persistApiKeyToDisk: false,
      apiKey: "",
      profileId: "auto" as const,
      profileMaxTokens: "" as string,
      thinkingIntent: "on" as ThinkingIntent,
      preserveThinking: false,
      reasoningEffort: "medium" as const,
      presetOverride: "" as const,
      samplingOverridesText: "",
      profileAdvancedOpen: false,
    };
  }
  const p = readPrefsFromDisk();
  const persist = p.persistApiKeyToDisk === true;
  const apiKey = persist ? (p.apiKey ?? "") : readSessionApiKey();
  return {
    baseUrl: typeof p.baseUrl === "string" && p.baseUrl.length ? p.baseUrl : DEFAULT_BASE,
    parallel: p.parallel ?? false,
    unloadOtherModels: p.unloadOtherModels ?? false,
    autoUnloadAfterBench: p.autoUnloadAfterBench ?? false,
    hlPreview: p.hlPreview ?? false,
    hlLog: p.hlLog ?? false,
    persistApiKeyToDisk: persist,
    apiKey,
    profileId: (p.profileId ?? "auto") as "auto" | LlmProfileFamily,
    profileMaxTokens:
      p.profileMaxTokens != null && Number.isFinite(p.profileMaxTokens) ? String(p.profileMaxTokens) : "",
    thinkingIntent: (p.thinkingIntent ?? "on") as ThinkingIntent,
    preserveThinking: p.preserveThinking ?? false,
    reasoningEffort: (p.reasoningEffort ?? "medium") as "minimal" | "low" | "medium" | "high",
    presetOverride: (p.presetOverride ?? "") as SamplingPresetName | "",
    samplingOverridesText: p.samplingOverridesJson ?? "",
    profileAdvancedOpen: p.profileAdvancedOpen ?? false,
  };
}

export type SaveUiSnapshot = {
  baseUrl: string;
  parallel: boolean;
  unloadOtherModels: boolean;
  autoUnloadAfterBench: boolean;
  hlPreview: boolean;
  hlLog: boolean;
  persistApiKeyToDisk: boolean;
  apiKey: string;
  profileId: "auto" | LlmProfileFamily;
  profileMaxTokens: string;
  thinkingIntent: ThinkingIntent;
  preserveThinking: boolean;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  presetOverride: SamplingPresetName | "";
  samplingOverridesText: string;
  profileAdvancedOpen: boolean;
};

/** Persist snapshot: non-secret prefs always on disk; api key follows opt-in / session. */
export function saveUiSnapshot(s: SaveUiSnapshot) {
  if (typeof window === "undefined") return;

  const prefs: UiPrefs = {
    v: STORAGE_VERSION,
    baseUrl: s.baseUrl,
    parallel: s.parallel,
    unloadOtherModels: s.unloadOtherModels,
    autoUnloadAfterBench: s.autoUnloadAfterBench,
    hlPreview: s.hlPreview,
    hlLog: s.hlLog,
    persistApiKeyToDisk: s.persistApiKeyToDisk,
    profileId: s.profileId,
    profileMaxTokens: (() => {
      const t = s.profileMaxTokens.trim();
      if (!t) return undefined;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    })(),
    thinkingIntent: s.thinkingIntent,
    preserveThinking: s.preserveThinking,
    reasoningEffort: s.reasoningEffort,
    presetOverride: s.presetOverride || undefined,
    samplingOverridesJson: s.samplingOverridesText.trim() ? s.samplingOverridesText : undefined,
    profileAdvancedOpen: s.profileAdvancedOpen,
  };

  if (s.persistApiKeyToDisk) {
    prefs.apiKey = s.apiKey;
    writeSessionApiKey("");
  } else {
    delete prefs.apiKey;
    writeSessionApiKey(s.apiKey);
  }

  writePrefsToDisk(prefs);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
}
