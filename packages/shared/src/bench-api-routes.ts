export type BenchApiRoute = "chat_completions" | "messages";

export type DetectCapabilities = {
  openaiChat: boolean;
  anthropicMessages: boolean;
};

/** detect 역량 + 선택적 restrict(교집합 비면 restrict 무시) — 서버 `makeBenchRunMeta`와 동일. */
export function resolveBenchApiRoutes(
  capabilities: DetectCapabilities,
  restrictTo?: readonly BenchApiRoute[] | null,
): BenchApiRoute[] {
  const detected: BenchApiRoute[] = [];
  if (capabilities.openaiChat) detected.push("chat_completions");
  if (capabilities.anthropicMessages) detected.push("messages");
  if (restrictTo?.length) {
    const restricted = detected.filter((r) => restrictTo.includes(r));
    return restricted.length ? restricted : detected;
  }
  return detected;
}
