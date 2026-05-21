import { z } from "zod";
import {
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  isStressWorkloadId,
  type LlmProfileFamily,
  type SamplingPresetName,
  type StressWorkloadId,
  type ThinkingIntent,
} from "@llm-bench/shared";

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
    selectedScenarioIds: z.array(z.string()).optional(),
    scenarioPickerOpen: z.boolean().optional(),
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

function sanitizeSelectedScenarioIds(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_SCENARIO_IDS];
  const allowed = new Set(PUBLIC_SCENARIO_IDS as readonly string[]);
  const filtered = input.filter((s) => allowed.has(s));
  return filtered.length > 0 ? filtered : [...DEFAULT_SCENARIO_IDS];
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
      selectedScenarioIds: [...DEFAULT_SCENARIO_IDS] as string[],
      scenarioPickerOpen: true,
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
    selectedScenarioIds: sanitizeSelectedScenarioIds(p.selectedScenarioIds),
    scenarioPickerOpen: p.scenarioPickerOpen ?? true,
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
  selectedScenarioIds: string[];
  scenarioPickerOpen: boolean;
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
    selectedScenarioIds: sanitizeSelectedScenarioIds(s.selectedScenarioIds),
    scenarioPickerOpen: s.scenarioPickerOpen,
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

/* ------------------------------------------------------------------ */
/* Stress (프로바이더 벤치) 페이지 전용 prefs                            */
/* ------------------------------------------------------------------ */

export const STRESS_PREFS_STORAGE_KEY = "llm-bench-stress-prefs";
const STRESS_STORAGE_VERSION = 1 as const;

// clamp 범위는 StressPage UI 입력 한도와 정확히 일치 (서버 schema의 100ms 하한이 아님).
const StressPrefsSchema = z.object({
  v: z.literal(STRESS_STORAGE_VERSION),
  workloadId: z.string().refine((s): s is StressWorkloadId => isStressWorkloadId(s)).optional(),
  startCC: z.number().int().min(1).max(256).optional(),
  maxCC: z.number().int().min(1).max(256).optional(),
  stepCC: z.number().int().min(1).max(64).optional(),
  durationMs: z.number().int().min(1000).max(600_000).optional(),
  requestTimeoutMs: z.number().int().min(5000).max(600_000).optional(),
  workerPromptSuffix: z.boolean().optional(),
  maxTokensOverride: z.string().max(16).optional(),
  lastSelectedModelId: z.string().max(256).nullable().optional(),
});

export type StressInitialState = {
  workloadId: StressWorkloadId;
  startCC: number;
  maxCC: number;
  stepCC: number;
  durationMs: number;
  requestTimeoutMs: number;
  workerPromptSuffix: boolean;
  maxTokensOverride: string;
  lastSelectedModelId: string | null;
};

export type StressSaveSnapshot = StressInitialState;

function defaultStressState(): StressInitialState {
  return {
    workloadId: "stress_ping",
    startCC: 1,
    maxCC: 8,
    stepCC: 1,
    durationMs: 5000,
    requestTimeoutMs: 30_000,
    workerPromptSuffix: true,
    maxTokensOverride: "",
    lastSelectedModelId: null,
  };
}

/** Stress page 영속 상태 읽기. 실패·version mismatch·파싱 오류 시 전체 default. */
export function readInitialStressState(): StressInitialState {
  const defaults = defaultStressState();
  if (typeof window === "undefined") return defaults;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STRESS_PREFS_STORAGE_KEY);
  } catch {
    return defaults;
  }
  if (!raw) return defaults;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return defaults;
  }
  const parsed = StressPrefsSchema.safeParse(obj);
  if (!parsed.success) return defaults;
  return {
    workloadId: parsed.data.workloadId ?? defaults.workloadId,
    startCC: parsed.data.startCC ?? defaults.startCC,
    maxCC: parsed.data.maxCC ?? defaults.maxCC,
    stepCC: parsed.data.stepCC ?? defaults.stepCC,
    durationMs: parsed.data.durationMs ?? defaults.durationMs,
    requestTimeoutMs: parsed.data.requestTimeoutMs ?? defaults.requestTimeoutMs,
    workerPromptSuffix: parsed.data.workerPromptSuffix ?? defaults.workerPromptSuffix,
    maxTokensOverride: parsed.data.maxTokensOverride ?? defaults.maxTokensOverride,
    lastSelectedModelId: parsed.data.lastSelectedModelId ?? defaults.lastSelectedModelId,
  };
}

export function saveStressSnapshot(s: StressSaveSnapshot): void {
  if (typeof window === "undefined") return;
  // startCC ≤ maxCC 자동 보정.
  const startCC = Math.max(1, Math.min(256, Math.floor(s.startCC)));
  const maxCC = Math.max(startCC, Math.min(256, Math.floor(s.maxCC)));
  const stepCC = Math.max(1, Math.min(64, Math.floor(s.stepCC)));
  const durationMs = Math.max(1000, Math.min(600_000, Math.floor(s.durationMs)));
  const requestTimeoutMs = Math.max(5000, Math.min(600_000, Math.floor(s.requestTimeoutMs)));
  const payload = {
    v: STRESS_STORAGE_VERSION,
    workloadId: s.workloadId,
    startCC,
    maxCC,
    stepCC,
    durationMs,
    requestTimeoutMs,
    workerPromptSuffix: s.workerPromptSuffix,
    maxTokensOverride: s.maxTokensOverride.slice(0, 16),
    lastSelectedModelId: s.lastSelectedModelId,
  };
  try {
    window.localStorage.setItem(STRESS_PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / disabled */
  }
}

// ---------- Provider monitor 페이지 prefs ----------

export const MONITOR_PREFS_STORAGE_KEY = "llm-bench-monitor-prefs";
const MONITOR_STORAGE_VERSION = 1 as const;

const MonitorProviderSchema = z.enum(["lm_studio", "ollama"]);

const MonitorPrefsSchema = z.object({
  v: z.literal(MONITOR_STORAGE_VERSION),
  baseUrl: z.string().max(512).optional(),
  provider: MonitorProviderSchema.optional(),
  pollEnabled: z.boolean().optional(),
  intervalMs: z.union([z.literal(2000), z.literal(5000), z.literal(10000)]).optional(),
});

export type MonitorProvider = z.infer<typeof MonitorProviderSchema>;

export type MonitorInitialState = {
  baseUrl: string;
  provider: MonitorProvider;
  pollEnabled: boolean;
  intervalMs: 2000 | 5000 | 10000;
};

export type MonitorSaveSnapshot = MonitorInitialState;

function defaultMonitorState(): MonitorInitialState {
  return {
    baseUrl: DEFAULT_BASE,
    provider: "lm_studio",
    pollEnabled: true,
    intervalMs: 5000,
  };
}

export function readInitialMonitorState(): MonitorInitialState {
  const defaults = defaultMonitorState();
  if (typeof window === "undefined") return defaults;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MONITOR_PREFS_STORAGE_KEY);
  } catch {
    return fallbackFromUi(defaults);
  }
  if (!raw) return fallbackFromUi(defaults);
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return fallbackFromUi(defaults);
  }
  const parsed = MonitorPrefsSchema.safeParse(obj);
  if (!parsed.success) return fallbackFromUi(defaults);
  const baseUrl =
    parsed.data.baseUrl && parsed.data.baseUrl.trim()
      ? parsed.data.baseUrl
      : pickUiBaseUrl(defaults.baseUrl);
  return {
    baseUrl,
    provider: parsed.data.provider ?? defaults.provider,
    pollEnabled: parsed.data.pollEnabled ?? defaults.pollEnabled,
    intervalMs: (parsed.data.intervalMs ?? defaults.intervalMs) as MonitorInitialState["intervalMs"],
  };
}

function fallbackFromUi(defaults: MonitorInitialState): MonitorInitialState {
  return { ...defaults, baseUrl: pickUiBaseUrl(defaults.baseUrl) };
}

function pickUiBaseUrl(fallback: string): string {
  // monitor prefs가 비어 있으면 bench/stress 쪽 마지막 baseUrl을 따라간다.
  // sessionStorage 등 외부 의존을 피하기 위해 readPrefsFromDisk만 사용.
  try {
    const p = readPrefsFromDisk();
    if (typeof p.baseUrl === "string" && p.baseUrl.trim()) return p.baseUrl;
  } catch {
    /* swallow */
  }
  return fallback;
}

export function saveMonitorSnapshot(s: MonitorSaveSnapshot): void {
  if (typeof window === "undefined") return;
  const payload = {
    v: MONITOR_STORAGE_VERSION,
    baseUrl: (s.baseUrl ?? "").slice(0, 512),
    provider: s.provider,
    pollEnabled: !!s.pollEnabled,
    intervalMs: s.intervalMs,
  };
  try {
    window.localStorage.setItem(MONITOR_PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / disabled */
  }
}
