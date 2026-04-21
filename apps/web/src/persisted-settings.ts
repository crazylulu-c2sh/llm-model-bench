import { z } from "zod";

export const PREFS_STORAGE_KEY = "llm-bench-ui-prefs";
export const SESSION_API_KEY = "llm-bench-api-key";

const STORAGE_VERSION = 1 as const;

const PrefsSchema = z
  .object({
    v: z.literal(STORAGE_VERSION),
    baseUrl: z.string().min(1).optional(),
    parallel: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    hlPreview: z.boolean().optional(),
    hlLog: z.boolean().optional(),
    persistApiKeyToDisk: z.boolean().optional(),
    apiKey: z.string().optional(),
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
    const parsed = PrefsSchema.safeParse(obj);
    return parsed.success ? parsed.data : {};
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
      hlPreview: false,
      hlLog: false,
      persistApiKeyToDisk: false,
      apiKey: "",
    };
  }
  const p = readPrefsFromDisk();
  const persist = p.persistApiKeyToDisk === true;
  const apiKey = persist ? (p.apiKey ?? "") : readSessionApiKey();
  return {
    baseUrl: typeof p.baseUrl === "string" && p.baseUrl.length ? p.baseUrl : DEFAULT_BASE,
    parallel: p.parallel ?? false,
    unloadOtherModels: p.unloadOtherModels ?? false,
    hlPreview: p.hlPreview ?? false,
    hlLog: p.hlLog ?? false,
    persistApiKeyToDisk: persist,
    apiKey,
  };
}

export type SaveUiSnapshot = {
  baseUrl: string;
  parallel: boolean;
  unloadOtherModels: boolean;
  hlPreview: boolean;
  hlLog: boolean;
  persistApiKeyToDisk: boolean;
  apiKey: string;
};

/** Persist snapshot: non-secret prefs always on disk; api key follows opt-in / session. */
export function saveUiSnapshot(s: SaveUiSnapshot) {
  if (typeof window === "undefined") return;

  const prefs: UiPrefs = {
    v: STORAGE_VERSION,
    baseUrl: s.baseUrl,
    parallel: s.parallel,
    unloadOtherModels: s.unloadOtherModels,
    hlPreview: s.hlPreview,
    hlLog: s.hlLog,
    persistApiKeyToDisk: s.persistApiKeyToDisk,
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
