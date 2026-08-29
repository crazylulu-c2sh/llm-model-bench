import {
  forgetWslLoopbackFallback,
  isConnectionRefused,
  rememberWslLoopbackFallback,
  resolveProviderFetchTarget,
} from "./util/wsl-windows-host.js";

/**
 * 프로바이더(LM Studio 등)용 기본 fetch.
 * WSL2에서 localhost가 거절되면 Windows 호스트 IP로 한 번 재시도한다.
 * 테스트는 기존처럼 `fetchImpl`을 넘기면 이 래퍼를 타지 않는다.
 */
export const providerFetch: typeof fetch = async (input, init) => {
  const { first, fallback } = resolveProviderFetchTarget(input);
  try {
    return await fetch(first, init);
  } catch (err) {
    if (!fallback || !isConnectionRefused(err)) throw err;
    try {
      const res = await fetch(fallback, init);
      rememberWslLoopbackFallback(input);
      return res;
    } catch (fallbackErr) {
      forgetWslLoopbackFallback(input);
      throw fallbackErr;
    }
  }
};
