export type ImageDelivery = "base64" | "url";

/** loopback / 사설망 origin인지 판정 — base64 인라인 분기(서버·문서 미리보기 공통). */
export function isLoopbackOrPrivateOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return true;
  }
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

export function chooseImageDelivery(origin: string): ImageDelivery {
  return isLoopbackOrPrivateOrigin(origin) ? "base64" : "url";
}
