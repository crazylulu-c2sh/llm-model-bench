import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribeLocale, type Locale } from "./locale";
import { MESSAGES, type Messages } from "./messages";

export { setLocale, getLocale, isLocale, LOCALES, LOCALE_ENDONYMS, type Locale } from "./locale";
export type { Messages } from "./messages";

/**
 * 컴포넌트에서 로케일 구독 + 현재 카탈로그 접근.
 * `m`을 통해 렌더된 텍스트가 로케일 변경에 반응한다(useSyncExternalStore 구독).
 * lib/ 순수 헬퍼는 이 `m`(또는 하위 레코드)을 파라미터로 받고, 절대 모듈 스코프에 캡처하지 않는다.
 */
export function useI18n(): { locale: Locale; setLocale: (l: Locale) => void; m: Messages } {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => "ko" as Locale);
  return { locale, setLocale, m: MESSAGES[locale] };
}

/** React 밖(sonner 토스트·SSE 핸들러 등)에서 현재 로케일 카탈로그를 발화 시점에 읽는다. */
export function msg(): Messages {
  return MESSAGES[getLocale()];
}
