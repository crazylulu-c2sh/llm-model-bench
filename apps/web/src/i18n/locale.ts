// 로케일 스토어(모듈 레벨). React 밖(sonner 토스트·SSE 핸들러)에서도 msg()로 현재 로케일을
// 읽어야 하므로 Context가 아닌 모듈 스토어 + useSyncExternalStore 조합을 쓴다.
// useTheme(useState+useLayoutEffect)와는 구조가 다르며, 여기서 빌려오는 건 관례뿐:
// STORAGE_KEY 명명("llm-bench-*"), applyToDocument, typeof window SSR 가드.
export type Locale = "ko" | "en" | "ja";

export const LOCALES = ["ko", "en", "ja"] as const satisfies readonly Locale[];

/** 언어 스위처 옵션 라벨 — 항상 자기 언어로 표기(번역하지 않음). */
export const LOCALE_ENDONYMS: Record<Locale, string> = {
  // i18n-ignore-next-line — endonym(자기 언어 표기), 번역 금지
  ko: "한국어",
  en: "English",
  ja: "日本語",
};

const STORAGE_KEY = "llm-bench-locale";

export function isLocale(v: unknown): v is Locale {
  return v === "ko" || v === "en" || v === "ja";
}

/** 감지 순서: localStorage → navigator.languages 접두 매치 → ko(기본). */
function detectInitial(): Locale {
  if (typeof window === "undefined") return "ko";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage disabled/unavailable */
  }
  if (typeof navigator !== "undefined") {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of tags) {
      const base = tag?.slice(0, 2).toLowerCase();
      if (isLocale(base)) return base;
    }
  }
  return "ko";
}

let current: Locale = detectInitial();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function subscribeLocale(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage full/disabled */
  }
  applyToDocument(next);
  for (const fn of listeners) fn();
}

/** <html lang>을 갱신 → :lang() 폰트 스코프·스크린리더 언어 힌트가 따라온다. */
function applyToDocument(l: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
  }
}

// 모듈 초기화 시점(첫 페인트 전)에 lang을 적용해 index.html의 정적 lang="ko"를 덮어쓴다.
applyToDocument(current);
