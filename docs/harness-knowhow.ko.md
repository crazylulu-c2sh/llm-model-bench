# 하네스 노하우

이 문서는 이 프로젝트의 로컬 LLM 벤치/스트레스 하네스에서 재사용 가능한 기법만 뽑아 정리한 것입니다 — 멀티 프로바이더 추상화, 스트리밍 TTFT/TPS 추출, GPU 경합 가드, 메모리 적합성 프리플라이트, 멀티턴 에이전트 루프, 램프형 스트레스 테스트, 런 영속화·회귀 비교 등. 각 섹션은 간단한 설명과 함께 정확한 소스 파일 위치를 짚어 주므로, 다른 프로젝트가 전체 시스템을 그대로 도입하지 않고도 필요한 기법 하나만 골라 옮겨 갈 수 있습니다.

> **유지보수.** 하네스 API(`apps/server/src/bench-runner.ts`, `openai-stream.ts`, `anthropic-stream.ts`, `stress-runner.ts`, `agent-loop.ts`, `contention-probe.ts`, `memory-preflight.ts` 등)를 바꾸는 PR에서는 이 문서에서 해당 함수·파일명을 검색해 영향받는 섹션의 서술을 함께 갱신하세요.

## 목차

- [1. 아키텍처와 이벤트 모델](#1-아키텍처와-이벤트-모델)
- [2. 멀티 프로바이더 추상화](#2-멀티-프로바이더-추상화)
- [3. 스트리밍 메트릭 추출](#3-스트리밍-메트릭-추출)
- [4. 메모리 적합성 프리플라이트 & OOM 방지](#4-메모리-적합성-프리플라이트--oom-방지)
- [5. 프로바이더 로드·언로드와 TTL](#5-프로바이더-로드언로드와-ttl)
- [6. 오염 가드 (경합 방지)](#6-오염-가드-경합-방지)
- [7. 스트레스 램프와 백프레셔](#7-스트레스-램프와-백프레셔)
- [8. 멀티턴 에이전트 루프 하네스](#8-멀티턴-에이전트-루프-하네스)
- [9. 품질 채점과 LLM-as-judge](#9-품질-채점과-llm-as-judge)
- [10. 런 영속화와 회귀 탐지](#10-런-영속화와-회귀-탐지)
- [11. 프로바이더 함정](#11-프로바이더-함정)
- [12. 재사용 방법 (체크리스트)](#12-재사용-방법-체크리스트)
- [부록 A. 용어 설명](#부록-a-용어-설명)
- [부록 B. 레퍼런스](#부록-b-레퍼런스)

---

## 1. 아키텍처와 이벤트 모델

이 프로젝트는 세 개의 배포 가능한 앱이 하나의 공유 라이브러리를 임포트하는 pnpm 워크스페이스 모노레포입니다. `@llm-bench/server`(`apps/server`)는 벤치마크 오케스트레이션과 SQLite 영속화를 담당하는 Hono HTTP 서비스이고, `@llm-bench/web`(`apps/web`)는 React SPA이며, `@llm-bench/mcp`(`apps/mcp`)는 동일한 벤치마크를 Model Context Protocol[^mcp-spec] 도구로 노출합니다. `@llm-bench/shared`(`packages/shared/src/index.ts`)가 단일 진실 공급원(single source of truth)입니다. 모든 와이어 타입 — `StreamEvent`, `BenchRunMeta`, `BenchResult`, 요청 본문(`BenchStreamBodySchema`), 그리고 채점 로직 — 은 Zod 스키마로 한 번만 정의하고 `z.infer`로 TS 타입을 추론하므로, 세 앱 모두 동일한 형태에 대해 검증합니다. 재사용 가능한 핵심은 `apps/server/src/bench-runner.ts`의 `runBench`입니다. 이 함수는 소켓에 직접 쓰는 대신 타입이 지정된 이벤트 스트림을 *yield*하는 `async function*`(`AsyncGenerator<StreamEvent>`)입니다. 따라서 오케스트레이션이 전송 계층과 완전히 분리됩니다. 핵심 재사용 패턴은 "제너레이터가 이벤트를 yield하고, 소비자가 전송 방식을 정한다"는 분리입니다. `runBench`는 SSE·WebSocket·HTTP 같은 전송 계층을 전혀 모릅니다. 그저 순서대로 `StreamEvent`를 yield할 뿐이고, 어떤 소비자든 `for await (const ev of runBench(...))`로 받아 원하는 형태(SSE 프레임, DB insert, 테스트 assertion)로 어댑트합니다. HTTP 라우트는 yield된 각 이벤트를 SSE 프레임으로 어댑트하고, 테스트는 제너레이터를 직접 순회하며, MCP 서버는 네트워크 너머로 동일한 SSE 엔드포인트를 소비합니다. 덕분에 같은 오케스트레이션 코드가 (1) 프로덕션 SSE 스트리밍, (2) SQLite 영속화, (3) 단위 테스트에서 그대로 재사용됩니다. 이벤트 스키마를 `shared` 패키지에 Zod discriminated union으로 두는 것이 이 구조의 계약(contract)입니다.

- **공유 계약(Shared contract).** `StreamEventSchema`는 `packages/shared/src/index.ts`의 `z.discriminatedUnion("type", [...])`입니다. 판별자 `type` 덕분에 모든 소비자가 빠짐없이(exhaustively) 타입 좁히기를 할 수 있고, 검증은 앱마다가 아니라 공유 경계에서 한 번만 일어납니다.
- **제너레이터 시그니처** (`apps/server/src/bench-runner.ts`):

```ts
export async function* runBench(
  input: BenchRequest,
  detect: DetectResult,
  opts: { fetchImpl?: typeof fetch; /* test-only injection: probeImpl, now, sleep, systemInfoImpl */ } = {},
): AsyncGenerator<StreamEvent>
```

- **전송 어댑터(Transport adapter).** 라우트는 제너레이터를 `ReadableStream`으로 감싸 각 이벤트를 하나의 SSE 프레임으로 직렬화하고, 동시에 퍼시스터로 tee합니다(`apps/server/src/routes/register.ts`):

```ts
const push = (ev: StreamEvent) =>
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
for await (const ev of runBench(req, detect)) {
  if (ev.type === "run_started") {
    persister.start(ev.meta ?? makeBenchRunMeta(req, detect, ev.run_id));
  }
  persister.onEvent(ev);   // → SQLite (BenchRunPersistence)
  push(ev);                // → text/event-stream
}
```
  응답은 `Content-Type: text/event-stream; charset=utf-8`로 전송됩니다. 웹 클라이언트는 `stream.getReader()` + `TextDecoder`로 읽어 `\n\n` 기준으로 나누고, 줄마다 `data:` 접두사를 떼어낸 뒤 각 블록을 다시 `JSON.parse`하여 `StreamEvent`로 복원합니다(`apps/web/src/App.tsx`). MCP 앱은 `BenchClient.postStream`(`apps/mcp/src/bench-client.ts`)과 SSE 라인 파서(`apps/mcp/src/sse.ts`)로 동일한 엔드포인트에 접근합니다.

- **이벤트 순서(런 하나의 정상 경로).** 제너레이터는 결정론적 순서로 이벤트를 방출합니다. 단 하나의 `run_started`가 전체 `meta` 스냅샷을 실어 나르므로 DB와 클라이언트가 하나의 진실 공급원을 공유하고, 정확히 하나의 `run_finished`가 런을 닫습니다.

| # | `type` | 발생 시점 | 주요 필드 |
|---|--------|---------|------------|
| 1 | `run_started` | 최초 1회 | `run_id`, `meta: BenchRunMeta` |
| 2 | `model_loaded` | (선택적 `preflight_memory_fit`, `model_unloaded`) 이후 | `model_id`, `provider` |
| 3 | `scenario_start` | 시나리오 × 라우트 × 반복마다 | `scenario_id`, `api_route`, `system_prompt`, `user_prompt` |
| 4 | `token_delta` | 생성 중 스트리밍 | `scenario_id`, `text` (UI 청크) |
| 5 | `scenario_end` | 시나리오 반복이 끝날 때 | `metrics { ttft_ms, total_ms, usage_output_tokens, ... }`, `quality` |
| 6 | `metrics_update` | 시나리오의 런이 끝난 뒤 시나리오마다 | `aggregate { scenario_id, api_route, runs[] }` |
| 7 | `contention_summary` | 경합 가드가 켜져 있으면 1회 | `total_iterations_discarded`, `guard_effective`, `abort_reason?` |
| 8 | `run_finished` | 최후 1회 | `run_id` |

  참고: 완료 이벤트는 코드상 `scenario_finished`가 아니라 `scenario_end`이며, `metrics_update`가 시나리오별 집계값을 실어 나릅니다.

- **오류는 예외가 아니라 이벤트다.** 제너레이터는 `{ type: "error", layer, code, message, partial? }`를 yield하며, `layer`는 `"upstream" | "downstream" | "orchestrator"` 중 하나입니다. 복구 가능한 곳에서는 스트리밍을 계속합니다(예: 한 반복에서 `429`나 `upstream_exception`이 나도 다음 반복으로 넘어감). 치명적 조건은 두 가지 방식으로 런을 끝냅니다. 일부는 오류를 yield한 직후 즉시 `return`하고(`no_routes`, `load_failed`), 다른 일부는 내부 `fatalStop` 플래그를 세워 시나리오/라우트 루프를 빠져나가므로 런이 여전히 종단 `contention_summary`(활성화된 경우) + `run_finished`로 수렴합니다(`contention_max_retries_exceeded`, `provider_or_model_unavailable`, 반복 간 대기 타임아웃). 라우트에는 바깥쪽 `catch`도 있어, 스트림 도중 throw가 나도 최종 `stream_failed` 오류를 밀어 넣어 타입이 지정된 이벤트로 클라이언트에 도달하게 합니다.
- **끼워 넣은 이벤트로서의 경합 가드.** 반복 사이의 유휴 게이팅(idle-gating)은 조용히 블로킹하는 대신 일급 스트림 이벤트(`contention_waiting`, `contention_resumed`, `iteration_discarded`)로 표면화되며, 조기 중단이 아닌 모든 경로는 `run_finished` 앞에서 단 하나의 종단 `contention_summary`로 수렴합니다 — 장시간 지속되는 부수 조건을 숨은 상태가 아니라 yield된 이벤트로 모델링하는 깔끔한 예입니다. (유일한 예외는 `pre_bench` 대기 타임아웃으로, 자체 인라인 `contention_summary`를 방출하고 `run_finished` 없이 `return`합니다.)

## 2. 멀티 프로바이더 추상화

단일 벤치마크 하네스가 여러 로컬 호스팅 또는 원격 LLM 서버를 대상으로 삼으려면 세 가지 관심사를 분리해야 합니다 — **감지(detection)**, **능력 해석(capability resolution)**, **디스패치(dispatch)**. `detectProvider()`(`apps/server/src/detect.ts`)는 base URL을 정해진 폴백 체인으로 프로브하여 엔드포인트에 `ProviderKind`를 태깅하고 `capabilities` 객체를 붙입니다. 그 하위에서 `resolveBenchApiRoutes()`(`packages/shared/src/bench-api-routes.ts`)가 그 불리언들을 구체적인 API 라우트 목록으로 바꾸고, `runBench()`(`apps/server/src/bench-runner.ts`)가 그 목록을 순회하며 각 라우트를 알맞은 와이어 포맷 어댑터(OpenAI chat vs. Anthropic messages)로 디스패치합니다. 핵심 아이디어는 프로바이더 정체성과 와이어 능력을 분리하는 것입니다. 즉 "어떤 서버인가(provider identity)"는 목록·수명주기 동작을 고르고, "어떤 요청 포맷을 지원하는가(wire capability)"는 요청/스트림 포맷을 고릅니다. `detectProvider()`는 base URL을 정규화한 뒤 세 개의 목록(list) 엔드포인트를 순서대로 시도해 서버를 식별하고, 각 provider마다 다른 `capabilities`를 붙입니다. 그 다음 단계는 provider 이름이 아니라 `capabilities` 불리언만 보고 실제 실행할 라우트를 정하므로, 새 provider를 추가해도 dispatch 로직은 바뀌지 않습니다.

### 감지(Detect) → 폴백 체인

`detectProvider()`는 각 목록 엔드포인트를 순서대로 시도하고 첫 성공에서 반환합니다. 진단을 위해 모든 시도가 `steps[]`에 덧붙여집니다. 셋 다 실패하면 `provider: "manual"`로 폴백합니다.

- `${base}/api/v1/models` → `provider: "lm_studio"` (`{ models: [{ key, type, display_name, ... }] }` 기대)
- `${base}/api/tags` → `provider: "ollama"` (`{ models: [{ name, model, size }] }` 기대)
- `${base}/v1/models` → `provider: "openai_compatible"` (`{ data: [{ id }] }` 기대)
- 매칭 없음 → `models: []`인 `provider: "manual"`과 계산된 `reachability` 상태(`ok` | `partial` | `unreachable`)

`base`는 먼저 `normalizeBaseUrl()`로 정규화됩니다. 이 함수는 스킴이 없으면 `http://`를 앞에 붙이고, 후행 OpenAI 스타일 `/v1` 접미사를 (`stripOpenAiStyleV1Suffix()`로) 벗겨내어 하네스가 `base + /v1/...`을 일관되게 조합할 수 있게 합니다.

```ts
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
// "lm_studio" | "ollama" | "openai_compatible" | "manual"

export async function detectProvider(
  rawBaseUrl: string,
  opts?: { fetchImpl?: FetchLike; apiKey?: string;
           manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] } },
): Promise<DetectResult>;
```

### 해석(Resolve) → capability 객체

감지된 각 provider는 `capabilities: { openaiChat: boolean; anthropicMessages: boolean }`를 실어 나릅니다. LM Studio와 Ollama는 **고정** capability 상수를 씁니다(가짜 모델 프로브가 오해를 부르는 `400`/`404` 코드를 돌려주므로 프로빙을 생략). `openai_compatible`과 `manual`은 `probeCapabilities()`가 실측하는데, 이 함수는 `/v1/chat/completions`와 `/v1/messages`에 더미 요청을 POST하고 `routeLikelyAvailable(status, body)`를 호출합니다 — `2xx`, 404가 아닌 `4xx`, 또는 본문이 `{`로 시작하는 `404`를 "라우트 존재"로 취급합니다.

| 프로바이더 | caps 출처 | `openaiChat` | `anthropicMessages` |
|---|---|---|---|
| `lm_studio` | `LM_STUDIO_COMPAT_CAPS` (고정) | `true` | `true` |
| `ollama` | `OLLAMA_COMPAT_CAPS` (고정) | `true` | `false` |
| `openai_compatible` | `probeCapabilities()` (실측) | 실측 | 실측 |
| `manual` | `probeCapabilities()` (실측) | 실측 | 실측 |

### 해석(Resolve) → 라우트 교집합

`resolveBenchApiRoutes()`는 capability 불리언을 라우트 이름으로 매핑한 뒤, 선택적으로 호출자가 제공한 `restrictTo`(예: `["chat_completions"]`만 원하는 perf 전용 모드)와 교집합을 취합니다. 교집합이 비면 `restrictTo`를 무시하고 감지된 전체 집합을 반환합니다 — 의도적인 "사용자에게 라우트 0개를 절대 남기지 않는다" 폴백입니다.

```ts
export type BenchApiRoute = "chat_completions" | "messages";

export function resolveBenchApiRoutes(
  capabilities: DetectCapabilities,           // { openaiChat, anthropicMessages }
  restrictTo?: readonly BenchApiRoute[] | null,
): BenchApiRoute[] {
  const detected: BenchApiRoute[] = [];
  if (capabilities.openaiChat) detected.push("chat_completions");
  if (capabilities.anthropicMessages) detected.push("messages");
  if (restrictTo?.length) {
    const restricted = detected.filter((r) => restrictTo.includes(r));
    return restricted.length ? restricted : detected; // empty intersection → ignore restrict
  }
  return detected;
}
```

### 디스패치(Dispatch) → 프로바이더 어댑터

`makeBenchRunMeta()`는 해석된 라우트를 `meta.api_routes`에 저장합니다. `runBench()`는 먼저 빈 목록을 가드하고(`code: "no_routes"`인 `error` 이벤트를 yield), 그다음 `for (const api_route of meta.api_routes)`를 순회하며 라우트별로 분기합니다:

- `api_route === "chat_completions"` → `openAiChatPostWithUsage()`로 `${base}/v1/chat/completions`에 POST하고 `consumeOpenAiChatStream()`으로 소비
- `api_route === "messages"` → 헤더 `anthropic-version: 2023-06-01`과 함께 `${base}/v1/messages`에 POST하고 `consumeAnthropicMessagesStream()`으로 소비

프로바이더별 수명주기(모델 로드/언로드 TTL)는 capability가 아니라 `ProviderKind`로 따로 게이팅됩니다. `providerSupportsLoadTtl()`(`packages/shared/src/provider-kind.ts`)은 `lm_studio`(로드 페이로드 `ttl`)와 `ollama`(`keep_alive`)에 대해서만 `true`를 반환하므로, `runBench()`는 정확히 그 두 프로바이더에만 TTL 처리를 적용하고 공유 라우트 디스패치 경로는 모든 프로바이더에서 동일하게 둡니다.

## 3. 스트리밍 메트릭 추출

두 프로바이더 어댑터는 SSE `ReadableStream`을 점진적으로 소비합니다 — `consumeOpenAiChatStream`은 버퍼를 `\n`(줄 단위)으로 나누고, `consumeAnthropicMessagesStream`은 `\n\n`(이벤트 블록 단위)으로 나눕니다 — 그리고 원시 텍스트 대신 하나의 평평한 메트릭 객체를 반환합니다. 소비자는 *첫* content/reasoning/tool 델타에서 `performance.now()`를 한 번만 샘플링하여, HTTP 요청 시작 시 캡처된 `origin` 기준으로 TTFT를 도출합니다. 그리고 모델 출력을 세 개의 병렬 채널(`text` / `assistantText` / `reasoningText`)로 분리하여, 추론 토큰이 채점 대상 답변을 오염시키지 않으면서 처리량에 반영되게 합니다. 재사용 아이디어는 다음과 같습니다: 모든 측정(TTFT, 토큰 추정, 잘림 플래그, 도구 호출 조립, 손상 가드)을 스트림 리더 안에서 수행하여, 어느 벤더의 SSE 방언이 만들어 냈든 호출자가 비교 가능하고 프로바이더 무관한 숫자를 얻게 하는 것입니다. 소스: `apps/server/src/openai-stream.ts`, `apps/server/src/anthropic-stream.ts`. 두 어댑터는 SSE 스트림을 직접 파싱하면서 지연·처리량·잘림·도구호출을 한 번에 측정합니다. 핵심은 (1) 첫 델타에서만 TTFT를 찍고, (2) `usageOutputTokens`(provider 보고)를 우선하되 없으면 `approxOutputTokens`(길이 기반 추정)로 폴백하며, (3) 추론(reasoning/thinking) 채널을 채점용 본문과 물리적으로 분리해 두는 것입니다. OpenAI 쪽은 여기에 반복-루프 조기 종료와 tool_call 인자 손상 감지까지 얹습니다.

### 첫 델타에서 `performance.now()`로 재는 TTFT

- `origin = opts?.requestStartedAt ?? performance.now()` — HTTP 발신 지점에서 `requestStartedAt`를 넘겨 TTFT가 파싱 시간뿐 아니라 연결/큐 지연까지 포함하게 합니다.
- 단일 `markTtft()` 클로저가 `ttft === null`일 때만 `ttft = performance.now() - origin`을 설정하므로, 첫 델타에서 래치되고 이후로는 멱등입니다.
- "첫 토큰"의 정의는 의도적입니다: OpenAI는 `reasoning_content`, 문자열 `reasoning`, `content`, 또는 `tool_calls`에서 찍고, Anthropic은 `content_block_start`(tool_use), `input_json_delta`, `thinking_delta`, 또는 텍스트 델타에서 찍습니다. 순수 메타데이터 이벤트(usage-only 청크, `message_delta`)는 TTFT를 찍지 **않습니다**.
- `totalMs = performance.now() - origin`은 read 루프가 끝난 뒤 캡처됩니다. 델타가 하나도 도착하지 않으면 `ttftMs`는 `null`로 남습니다.

### `usageOutputTokens ?? approxOutputTokens`로 재는 TPS

- 프로바이더 자체 카운트를 우선합니다. OpenAI는 `stream_options.include_usage` 트레일러(`usage.completion_tokens`, 없으면 `usage.output_tokens`)에서 읽고, Anthropic은 `usage.output_tokens`(`message_delta` 이벤트에 실린 누적 합계) 또는 `message.usage.output_tokens`에서 읽습니다. 둘 다 `usageOutputTokens`에 저장되며, 서버가 생략하면 `null`로 남습니다(vLLM / LM Studio에서 흔함).
- `approxOutputTokens`는 폴백 추정치로, `Math.max(0, Math.ceil(outText.length / 4))` — 고전적인 ~토큰당 4자 휴리스틱입니다. 처리량 소비자는 tokens/sec를 `(usageOutputTokens ?? approxOutputTokens) / (totalMs / 1000)`으로 계산합니다.
- 두 어댑터 모두 추정치에 추론 토큰을 포함시켜 두 프로바이더가 비교 가능하게 합니다: OpenAI의 `outText`(= `combined`)에는 이미 추론이 들어 있고, Anthropic은 추론을 `text`에서 빼 두는 대신 명시적으로 다시 더합니다: `Math.ceil((reasoningText.length + outText.length) / 4)`.

### 추론 채널 분리: `text` vs `assistantText` vs `reasoningText`

| 필드 | OpenAI 출처 | Anthropic 출처 | 용도 |
|---|---|---|---|
| `assistantText` | `delta.content`만 | `content_block_delta` 텍스트만 | 채점되는 가시 답변; 도구 라운드 히스토리 |
| `reasoningText` | `delta.reasoning_content` + 문자열 `delta.reasoning` | `thinking_delta` | 추론 히스토리로 재주입; 채점에서 제외 |
| `text` | `combined`(추론 + content, 도착 순) + `\n` + 직렬화된 `tool_calls` | content 텍스트 + `\n` + 직렬화된 `tool_calls`(추론은 **미포함**) | 처리량 분모 / `output_text` 베이스 |

- 채점은 깨끗한 채널을 우선하는 헬퍼를 씁니다: `openAiBenchOutputText`는 `assistantText`가 비어 있지 않으면 그것을 반환하고 아니면 `text`로 폴백합니다(마지막 턴이 추론-only 델타만 방출하는 끼워진 `reasoning_split` 케이스를 가드).
- 라이브 토큰 UI는 `openAiLiveTokenStreamText` = `` `${reasoningText}${assistantText}` ``를 써서 추론을 스트림으로 보여 주되 분리 가능한 상태로 둡니다.

### 잘림(truncation) 감지

- OpenAI는 마지막 비어 있지 않은 `choices[0].finish_reason`을 `finishReason`에 저장합니다. `"length"`는 `max_tokens` 상한에 도달했음(잘림)을 뜻합니다. Anthropic은 `message_delta.delta.stop_reason`을 `stopReason`에 저장하며, `"max_tokens"`가 잘림 신호입니다.
- OpenAI 호환 서버가 이 필드를 생략할 수 있어 두 값 모두 `null`일 수 있으므로, `null`을 "깨끗한 종료"가 아니라 "알 수 없음"으로 취급하세요. Anthropic은 스트림 *완료*(`message_stop`에서 오는 `sawMessageDelta`)를 *이유*와 별도로 추적한다는 점에 유의하세요.[^oai-compat][^anthropic-stream]

### 인덱스 기준 `tool_call` 병합

- 스트리밍된 도구 호출은 `index`로 키가 잡힌 조각으로 도착하며, 두 어댑터 모두 `Map<number, ...>`에 누적합니다. OpenAI의 `mergeToolCallDeltas`는 각 조각을 `typeof p.index === "number" ? p.index : 0`으로 키잉하고, `id`/`type`/`name`이 있으면 덮어쓰며, `function.arguments` 조각은 **이어붙입니다**. Anthropic은 `content_block_start`(tool_use)에서 항목을 시드하고(`j.index ?? 0`로 인덱싱) `input_json_delta.partial_json`을 `inputJson`에 덧붙입니다.
- 마무리 시 항목은 인덱스로 정렬됩니다. Anthropic은 각 `inputJson`을 `JSON.parse`하여(오류 시 `{}`로 폴백) `AnthropicToolUseOut.input`에 넣고, 누락된 id는 합성합니다(`bench_tool_${index}` / `toolu_bench_${index}`).

### `repetitionLoopDetected` 가드 (OpenAI 전용)

- `opts.loopGuard === true`로 옵트인하며, 아니면 전부 건너뛰어 기존 호출자의 동작/오버헤드가 그대로 유지됩니다.
- `contentOnly`가 512자 이상 늘어날 때마다 `detectRepetitionLoop`(`apps/server/src/repetition-guard.ts`)를 실행합니다 — 600자 이상과 함께 반복된 후행 블록 또는 6개 이상의 거의 동일한 후행 줄을 요구하는 보수적 휴리스틱입니다.
- 감지되면 `repetitionLoopDetected = true`를 설정하고, 다음 `reader.read()` **전에** `break`한 뒤(진행 중인 read 없음 → `AbortError` 없음) `reader.cancel()`을 호출해 백엔드 연결을 깔끔하게 닫습니다.

### `toolCallArgsCorrupted` 감지 (OpenAI 전용)

- 채점을 바꾸지 않는 주석-전용 신호로, 스트리밍된 `arguments`가 이어붙어 돌아오는(예: `{}{}` 또는 `{"…"}{"…"}`) LM Studio 엔진 프로토콜 회귀(lmstudio-bug-tracker #1922)를 위한 것입니다.
- `firstBalancedJsonEnd`는 문자열/이스케이프를 인식하며 첫 균형 잡힌 JSON 값의 끝을 스캔하고, `toolArgsLookCorrupted`는 그 뒤에 공백이 아닌 문자가 남으면 그 호출을 플래그합니다. 빈 문자열, 단일 완전 객체, 잘리거나 불완전한 JSON은 손상이 *아닌* 것으로 취급합니다(그런 것에는 다른 라벨이 붙음).

### 메트릭 형태(shape)

```ts
export type OpenAiStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;          // combined reasoning+content (+ tool_calls JSON)
  assistantText: string; // delta.content only
  reasoningText: string; // reasoning_content + string reasoning
  toolCalls: OpenAiToolCallOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;   // ceil(text.length / 4)
  usageOutputTokens: number | null; // stream_options.include_usage
  finishReason: string | null;  // "length" => truncated
  repetitionLoopDetected: boolean;
  toolCallArgsCorrupted: boolean;
};

export type AnthropicStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;          // content text (+ tool_calls JSON); reasoning NOT included
  assistantText: string; // content_block_delta text only
  reasoningText: string; // thinking_delta
  toolUses: AnthropicToolUseOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;   // ceil((reasoningText.length + text.length) / 4)
  usageOutputTokens: number | null; // message_delta.usage.output_tokens
  stopReason: string | null;    // "max_tokens" => truncated
};
```

## 4. 메모리 적합성 프리플라이트 & OOM 방지

모델 가중치를 RAM에 로드하기 전에, 이 하네스는 실제로 들어맞을지 예측하고, 아니면 런을 건너뛰거나 다른 상주 모델을 축출합니다 — 하드 OOM("insufficient system resources")을 깔끔하고 기록된 결정으로 바꿉니다. 예측기는 모델의 원시 `size_bytes`를 받아 런타임/KV 오버헤드 계수로 부풀린 뒤, 자유 메모리에서 고정 OS 안전 예약분을 뺀 값과 비교합니다. 결정적으로, 이 게이트는 **LM Studio 중심**입니다: 필요 크기 신호와 축출 메커니즘 둘 다 LM Studio의 로컬 모델 API에서 오므로, **다른 프로바이더(호스티드 API, 다른 로컬 런타임)에는 동등한 프리플라이트 게이트가 없습니다** — 이 검사 없이 그냥 실행됩니다. 핵심 로직은 `apps/server/src/memory-preflight.ts`에 있고, LM Studio 전용 헬퍼는 `apps/server/src/lmstudio.ts`에 있습니다. 핵심 아이디어는 "로드하기 전에 예측한다"입니다. 후보 모델의 디스크/가중치 용량(`size_bytes`)에 오버헤드 계수를 곱해 필요 RAM을 추정하고, `free - reserve`와 비교합니다. 크기를 알 수 없으면 절대 막지 않고 진행(`proceed`)하여 하위호환을 유지하며, 실제 차단은 `fitPolicy`가 명시적으로 지정됐을 때만 일어납니다. 이 게이트는 LM Studio의 로컬 모델 목록·언로드 API에 의존하므로 다른 provider에는 동일한 사전 검사가 존재하지 않는다는 점을 반드시 유의하세요.

### 조정 가능한 상수

두 상수가 안전 마진을 정의합니다(`apps/server/src/memory-preflight.ts`에서):

```ts
/** runtime/KV overhead factor, calibrated to an observed 25.71→28.28GB (~+10%) load. */
export const FIT_OVERHEAD_FACTOR = 1.1;
/** headroom reserved for the OS and other processes (bytes). */
export const FIT_SAFETY_RESERVE_BYTES = 2 * 1024 ** 3; // 2 GiB
```

- `FIT_OVERHEAD_FACTOR`는 디스크상 가중치가 실제 라이브 풋프린트(KV 캐시, 런타임 버퍼)를 과소평가하는 것을 보정합니다. 여기의 `1.1`은 추측이 아니라 실제 관측된 로드에 맞춰 보정한 값입니다 — 여러분 자신의 런타임에 맞게 재보정하세요.
- `FIT_SAFETY_RESERVE_BYTES`는 RAM의 고정 슬래브를 비워 두어, 모델 자체는 "들어맞아도" 머신이 스래싱하지 않게 합니다.

### 숫자의 출처 (LM Studio 헬퍼)

두 입력 모두 LM Studio의 `GET /api/v1/models`(실패 시 `/api/v0/models`로 폴백) 응답에서 끌어오며, `lmStudioListModels()`가 파싱합니다. `apps/server/src/lmstudio.ts`의 두 export 헬퍼가 프리플라이트에 필요한 것을 추출합니다:

```ts
// Required size: the candidate's on-disk/weights size, or undefined if missing/0.
export function lmStudioModelSizeBytes(
  models: readonly LmStudioListedModel[],
  modelKey: string,
): number | undefined;

// Eviction candidates: every currently-loaded instance EXCEPT the target model,
// with per-instance RAM/VRAM usage.
export function lmStudioResidentInstances(
  models: readonly LmStudioListedModel[],
  excludeKey: string,
): Array<{ modelKey: string; instanceId: string; ramBytes?: number; vramBytes?: number }>;
```

- 모델 키는 `baseKey()`로 정규화되며, 이 함수는 `.replace(/:\d+$/, "")`를 적용해 후행 숫자 `:<N>` 접미사를 벗겨 벤치 `modelId`가 LM Studio가 나열한 `key`와 매칭되게 합니다.
- `lmStudioModelSizeBytes()`는 나열된 `size_bytes`를 읽습니다. 그것이 없으면 `preflightMemoryFit()`가 `detect`가 보고한 `size_bytes`로 폴백하고, 둘 다 없을 때만 크기를 알 수 없음으로 취급합니다.
- `lmStudioResidentInstances()`는 로컬 `firstNumberField()` 헬퍼로 인스턴스별 사용량을 읽으며, 순서 있는 키 폴백(`ram_usage` → `ram` → `ram_bytes`, 그리고 `vram_usage` → `vram` → `vram_bytes` 대응)을 씁니다 — 모니터-수집의 `numberField` 관례를 그대로 반영합니다. 이 인스턴스들이 하네스가 회수할 수 있는 RAM이며, 각 `instanceId`는 `loaded_instances[].id`에서 오는데 이는 LM Studio의 공식 언로드 본문이 실어 나르는(`{ "instance_id": "…" }`, `lmStudioUnload()`가 POST) 바로 그 값입니다.

### 적합성 계산

`preflightMemoryFit()`는 `SystemSnapshot`(`getSystemSnapshot()` → `freeMemBytes` 필드의 `os.freemem()`, 테스트용 주입 가능)에서 자유 메모리를 읽어 다음을 계산합니다:

```ts
const requiredWithOverhead = Math.ceil(required * FIT_OVERHEAD_FACTOR);
const willFit          = requiredWithOverhead <= free - FIT_SAFETY_RESERVE_BYTES;
const fitsAfterUnload  = requiredWithOverhead <= free + residentRam - FIT_SAFETY_RESERVE_BYTES;
```

방출되는 이벤트의 `required_bytes`는 **원시** `size_bytes`(오버헤드 적용 전)이며, 오버헤드는 비교 안에서만 적용된다는 점에 유의하세요.

### FitPolicy 결과

`fitPolicy`는 선택적 enum입니다 — `FitPolicySchema = z.enum(["skip", "unload_other_models"]).optional()`(`packages/shared/src/index.ts` 참고). 여기에는 `"proceed"`가 절대 없으며, 정책이 없으면 "예측·기록만, 절대 차단 안 함"을 뜻합니다. 반환되는 `FitDecision.action`은 다음과 같이 해소됩니다:

| 조건 | `fitPolicy` | `action` | 효과 |
|---|---|---|---|
| `required` 미상 (`size_bytes` 없음) | 임의 | `proceed` | 기록만, `reason: preflight_skipped` — 절대 차단 안 함(하위호환) |
| `willFit`가 true | 임의 | `proceed` | 로드 정상 진행 |
| 안 맞지만 `fitsAfterUnload` & 상주 모델 존재 | `unload_other_models` | `unload_other_models` | 호출자가 축출할 `residentInstances`를 반환한 뒤 로드 |
| 안 맞음 (또는 언로드해도 여전히 안 맞음) | `skip` 또는 `unload_other_models` | `skip` | OOM 대신 런을 건너뜀 |
| 안 맞음 | *미설정* | `proceed` | "예측: 안 맞을 수 있음" 경고 이벤트를 방출하되 진행 |

- 함수는 정책과 무관하게 **항상** `PreflightMemoryFitEvent`(필드: `model_id`, `required_bytes`, `free_bytes`, `resident_ram_bytes`, `will_fit`, `action`, `reason`, `size_source`)를 반환하므로, 아무것도 게이팅하지 않을 때도 예측을 관측할 수 있습니다.
- `size_source`는 출처를 기록합니다: `"list"`(LM Studio), `"detect"`(폴백), 또는 `"unknown"`.
- 오직 `unload_other_models`만 `residentInstances`를 실행 가능한 축출 집합으로 채웁니다. 다른 결과는 빈 값이나 참고용으로 반환합니다(`skip` 분기도 `residents`를 참고용으로 통과시킴).

**재사용 포인트.** 이 패턴 — `predict(size × overhead) vs (free − reserve)`, 항상 결정 이벤트 방출, 명시적 옵트인 정책에서만 게이팅하고 기본은 비차단 — 은 후보의 메모리 크기와 상주 집합을 보고할 수 있는 어떤 로컬 모델 런타임에도 이식됩니다. 여기의 구체 사항(`/api/v1/models`, `instance_id` 언로드)은 LM Studio 것이지만, 프리플라이트/OOM 가드의 형태 자체는 프로바이더 무관합니다.

## 5. 프로바이더 로드·언로드와 TTL

로컬 모델 백엔드는 모델을 정해진 시간 동안 메모리에 붙잡아 두라고 지시하는 *방식*이 서로 다릅니다. 그래서 하네스는 이를 단일 능력 검사 `providerSupportsLoadTtl(kind)` 뒤로 게이팅하고 TTL을 프로바이더별로 적용합니다. LM Studio는 로드 호출에 `ttl`(**초 단위**)을 직접 받아 유휴 시 자동 축출(auto-eviction)을 제공합니다. Ollama는 `keep_alive`를 쓰지만 날카로운 함정이 있습니다: 벤치마크가 실제로 추론을 구동하는 OpenAI 호환 `/v1/chat/completions` 엔드포인트가 **`keep_alive`를 무시하고 요청마다 모델 수명을 기본값 5분으로 조용히 리셋**합니다([ollama#11458](https://github.com/ollama/ollama/issues/11458)). 재사용 가능한 우회책은 원하는 TTL을 Ollama의 *네이티브* API로 대역 외(out-of-band)에서 두 번 적용하는 것입니다: 한 번은 런 전 preload로, 다시 한 번은 런 후에 의도한 keep-alive를 재확정합니다.[^lms-rest][^ollama-api] 두 백엔드는 "모델을 메모리에 얼마나 붙잡아 둘지"를 지정하는 방식이 다르므로, 하네스는 `providerSupportsLoadTtl()` 하나로 지원 여부를 판별하고 실제 적용은 프로바이더별로 분기합니다. 핵심 함정은 Ollama의 `/v1/chat/completions`가 `keep_alive`를 무시하고 요청마다 기본 5분으로 리셋한다는 점이며, 이를 네이티브 `/api/generate`로 **preload + 벤치 종료 후 재적용**하여 우회합니다. `openai_compatible`·`manual` 프로바이더는 TTL 개념이 없어 값이 있어도 무시됩니다.

- **능력 게이트(Capability gate)** (`packages/shared/src/provider-kind.ts`): `providerSupportsLoadTtl(p)`는 `"lm_studio"`와 `"ollama"`에 대해서만 `true`를 반환합니다. `false`이면 호출자는 모든 TTL 로직을 건너뜁니다.
- **LM Studio** (`apps/server/src/lmstudio.ts`): `lmStudioLoad(baseUrl, modelKey, { ttlSeconds })`는 `/api/v1/models/load`(실패 시 `/api/v0/...`로 폴백)에 `{ model, ttl }`을 POST합니다. `ttl`은 `ttlSeconds`가 유한하고 `> 0`일 때만 포함되며 정수 초로 내림 처리됩니다. 이는 LM Studio 네이티브 필드이므로 재적용 절차가 필요 없습니다.
- **Ollama** (`apps/server/src/ollama.ts`): `ollamaKeepAliveLoad(baseUrl, model, { ttlSeconds })`는 **네이티브** `/api/generate`에 빈 프롬프트(`prompt: ""`, `stream: false`)로 POST하여, 생성 없이 모델만 메모리에 적재합니다(응답 `done_reason: "load"`). TTL은 숫자 vs 기간 문자열의 모호성을 피하려고 명시적 Go duration 문자열인 `keep_alive: "<seconds>s"` 형태로 보냅니다.
- **`/v1` 리셋 우회책** (`apps/server/src/bench-runner.ts` 참고): 동일한 `ollamaKeepAliveLoad` 호출을 (1) 추론 *전* preload로, (2) 벤치마크 완료 *후*에 재사용합니다. 그 사이의 `/v1/chat/completions` 호출들이 모델을 다시 기본 5분으로 리셋했을 것이기 때문입니다. 벤치 후 재적용은 best-effort입니다.
- **Best-effort 시맨틱스**: `ollamaKeepAliveLoad`는 절대 throw하지 않습니다 — 네트워크/업스트림 실패 시 `{ ok: false, status: 0, body }`를 반환하므로 불안정한 keep-alive가 런을 중단시킬 수 없습니다. 큰 모델의 콜드 로드는 수십 초가 걸릴 수 있으므로 넉넉한 120초 타임아웃(`OLLAMA_LOAD_TIMEOUT_MS`)을 씁니다.

| 프로바이더 | 함수 | 엔드포인트 | TTL 필드 / 형태 |
| --- | --- | --- | --- |
| `lm_studio` | `lmStudioLoad` | `POST /api/v1/models/load` | `{ model, ttl }` — `ttl`은 **정수 초**, `> 0`이 아니면 생략 |
| `ollama` | `ollamaKeepAliveLoad` | `POST /api/generate` (네이티브) | `{ model, prompt: "", stream: false, keep_alive: "<sec>s" }` |
| `openai_compatible`, `manual` | — | — | 미지원; TTL 무시 |

```ts
// packages/shared/src/provider-kind.ts
export function providerSupportsLoadTtl(p: ProviderKind): boolean {
  return p === "lm_studio" || p === "ollama";
}
```

```ts
// apps/server/src/ollama.ts — native preload that actually honors keep_alive
export async function ollamaKeepAliveLoad(
  baseUrl: string,
  model: string,
  opts: { ttlSeconds: number; fetchImpl?: FetchLike; apiKey?: string },
): Promise<{ ok: boolean; status: number; body: string }> {
  const seconds = Math.floor(opts.ttlSeconds);
  const body = JSON.stringify({ model, prompt: "", stream: false, keep_alive: `${seconds}s` });
  // POST to /api/generate; best-effort (returns { ok:false, status:0 } on failure)
}
```

```json
// Ollama native /api/generate load body — loads without generating
{ "model": "llama3.1:8b", "prompt": "", "stream": false, "keep_alive": "1800s" }
```

**다른 프로젝트를 위한 재사용 포인트:** 백엔드가 네이티브 API와 OpenAI 호환 shim을 함께 노출한다면, 호환 엔드포인트에서 수명/keep-alive 힌트가 존중되리라 가정하지 마세요. "모델을 상주시킨다"는 관심사를 하나의 멱등(idempotent)·best-effort 함수로 격리하고, 프로바이더 능력 술어(predicate) 뒤로 게이팅한 뒤, 실제 워크로드를 그 함수로 감싸십시오(전에 preload, 후에 재확정). 그래야 실효 TTL이 shim의 조용한 기본값이 아니라 여러분이 의도한 값이 됩니다.

## 6. 오염 가드 (경합 방지)

공유 GPU에서 지연과 처리량을 재는 벤치마크는 *다른* 추론이 동시에 돌지 않을 때만 신뢰할 수 있습니다 — 외부 생성이 TTFT를 부풀리고 tokens/sec를 떨어뜨려 조용히 수치를 오염시킬 수 있기 때문입니다. 여기서 재사용 가능한 기법은 단일 프로브를 절대 신뢰하지 않는 **다중 신호 유휴 게이트(multi-signal idle gate)**입니다: GPU 사용률(`nvidia-smi`), Prometheus `/metrics` 요청 게이지(vLLM[^vllm-metrics] / llama.cpp[^llamacpp-server] / TGI[^tgi-metrics]), `lms ps --json` 활동 뷰(LM Studio), Ollama `expires_at` churn을 융합합니다. 핵심 구조적 통찰은 *자기* 경합(우리 자신의 부하가 GPU를 밝히는 것)을 피하는 **두 개의 샘플링 모드**입니다: 우리 요청이 in-flight가 아닐 때만 쓰는 유휴 샘플러(`sampleIdle`), 그리고 우리 스트리밍 *중에만* 쓰이면서 (우리 자신이 유발한) GPU util을 무시하고 대신 우리의 알려진 기여분 1을 초과하는 요청 큐 델타를 세는 in-flight 샘플러(`sampleInFlight`). 이는 세 단계로 배선됩니다 — `pre_bench` 게이트, `between_iterations` 게이트, 그리고 감지 시 중단·재측정하는 백그라운드 in-flight 모니터. `apps/server/src/contention-probe.ts`와 `apps/server/src/bench-runner.ts`의 통합을 참고하세요. `sampleIdle`은 *우리 요청이 in-flight가 아닐 때만* 호출되어 GPU util·`/metrics`·`lms ps`를 신뢰하고(활성 신호 하나라도 임계 초과면 대기), `sampleInFlight`는 *우리 스트리밍 중에만* 호출되어 우리가 유발한 GPU util은 무시하고 서버 요청 수 게이지(우리 기여=1을 알기에 `running≥2`부터 경합)·타 모델 generating·로드 ID churn·Ollama `expires_at` 전진으로 외부 동시 추론을 감지합니다. `manual` provider면 가드는 자동 비활성화됩니다(`resolveContentionConfig`).

- **Signal reach (어디서 유효한가):** GPU와 `lms ps`는 서버 머신 로컬에서만 유효(`isTargetOnServerHost(baseUrl)`); `lms ps`는 추가로 `provider === "lm_studio"` + `isLmsCliEnabled()` + CLI 활성 토글일 때만. `/metrics`는 네트워크 엔드포인트라 원격 대상(`openai_compatible`/`manual`)도 가능. 미지원 서버면 `/metrics`가 non-OK 또는 파싱 불가로 한 번 실패한 뒤 `metricsUnavailable`로 래치되어 재폴링하지 않습니다.
- **Idle vs in-flight thresholds:** idle 모드는 `metrics.running >= 1 || metrics.waiting >= 1`이면 active로 보고 대기; in-flight 모드는 우리 요청 1건을 빼기 위해 `metrics.running >= 2 || metrics.waiting >= 1`을 경합 기준으로 씁니다.
- **`effective` (가드가 실제 효과가 있었나):** `sampleIdle`이 GPU/metrics/lms 중 "지금 연산 중"을 판정 가능한 신호를 하나라도 관측하면 `hasActiveSignal=true` → 게이트가 이를 `effective`로 승격. 로드된 재고(inventory)는 `effective`에 기여하지 않으며, 활성 신호가 전혀 없을 때만 `inventory_only_no_active_signal`(다른 모델이 로드돼 있음) 또는 `no_contention_signal_available` reason 라벨로 남습니다.

Prometheus[^prometheus-fmt] 파서는 세 엔진의 게이지를 합산합니다(매칭 없으면 `null` = 미지원 서버):

```ts
const RUNNING_METRICS = ["vllm:num_requests_running", "llamacpp:requests_processing", "tgi_batch_current_size"];
const WAITING_METRICS = ["vllm:num_requests_waiting", "llamacpp:requests_deferred", "tgi_queue_size"];
export function parsePrometheusRunningWaiting(text: string): { running: number; waiting: number } | null;
```

세 개의 프로브 진입점과 설정 노브(모두 `resolveContentionConfig`가 UI 입력에서 clamp):

```ts
interface ContentionProbe {
  sampleIdle(signal?: AbortSignal): Promise<IdleSample>;             // pre_bench / between_iterations gate
  segmentBaseline(signal?: AbortSignal): Promise<InFlightBaseline>;  // snapshot loaded IDs + expires_at
  sampleInFlight(baseline: InFlightBaseline, signal?: AbortSignal): Promise<InFlightSample>; // during our stream
}

type ContentionConfig = {
  enabled: boolean;                 // false for provider "manual"
  pollIntervalMs: number;           // clamp 250..5000,     default 1000
  maxRetriesPerIteration: number;   // clamp 0..5,          default 2
  preBenchTimeoutMs: number;        // clamp 0..600_000,    default 120_000
  betweenIterationTimeoutMs: number;// clamp 0..300_000,    default 30_000
  totalWaitBudgetMs: number;        // clamp 0..1_800_000,  default 300_000 (run-global accumulator)
  gpuUtilThresholdPct: number;      // clamp 1..100,        default 25
  requiredConsecutiveIdle: number;  // clamp 1..5,          default 2 (debounce before resuming)
  serverMetricsEnabled: boolean;    // default true
  lmsCliActivityEnabled: boolean;   // default true
};
```

각 신호를 그것을 소비하는 단계에 매핑하면:

| 신호 | 출처 | 유휴 게이트 (`sampleIdle`) | In-flight 모니터 (`sampleInFlight`) |
|---|---|---|---|
| GPU 사용률 | `getGpuSnapshot()`를 통한 `nvidia-smi` | `maxUtil > gpuUtilThresholdPct`이면 active | **사용 안 함** (우리 자신의 부하) |
| 요청 게이지 | Prometheus `/metrics` | `running≥1 \|\| waiting≥1` | `running≥2 \|\| waiting≥1` |
| LM Studio 활동 | `lms ps --json` | 아무 `generating` 또는 우리 `queued>0` | *외부* 모델 generating, 또는 우리 `queued>0` |
| 신규 모델 로드 | 로드된 모델 재고 | 트리거 아님; 활성 신호가 없을 때만 `inventory_only_no_active_signal` 라벨 | `baseline.loadedIds`에 없는 ID → `new_model_loaded` |
| Ollama churn | 모델별 `expires_at` | — | `expires_at`가 baseline을 넘어 전진 → `expires_at_advanced` (동일 모델 외부 요청) |

**게이트 루프 동작.** `runIdleGate`는 async generator입니다. 첫 샘플이 유휴면 즉시 반환하고(`waitedMs: 0`), 바쁜 샘플이면 `contention_waiting` 이벤트를 방출하는 폴 루프에 진입합니다(중복 제거 — 첫 폴, reason 변경 시, 또는 5폴마다 방출). `requiredConsecutiveIdle`회 연속 유휴 샘플 이후에만 재개하며 `contention_resumed`를 방출합니다. 타임아웃과 `totalWaitBudgetMs`는 매 폴마다 루프 *안에서* 재확인합니다(진입 시점만 검사하면 sleep 중 초과를 잡지 못함). 성공하면 in-flight 모니터가 diff할 새로운 `segmentBaseline()`을 돌려줍니다.

**In-flight 모니터 teardown 경쟁.** `startInflightMonitor`는 **비동기** `stop()`을 반환합니다. 내부 `sampleInFlight`는 의도적으로 teardown abort 신호 *없이* 호출됩니다 — 그래서 `stopRequested`가 이미 세팅된 상태에서도 in-flight 양성 감지가 `catch`에 삼켜지지 않고 존중됩니다. 폴 사이의 *sleep*만 중단 가능하며(별도 `AbortController`인 `sleepCtrl`을 통해), teardown이 빠르게 깨어나면서도 감지를 결코 잃지 않게 합니다. 감지 시 `onDetect(reasons)`를 발화하고, 그 러너 콜백이 `contentionController.abort()`를 호출합니다. 요청 자체는 결합된 `reqSignal = AbortSignal.any([controller.signal, contentionController.signal])`(요청 타임아웃 OR 경합)을 수신하므로, abort가 in-flight 요청을 해체합니다. 그다음 러너는 측정된 그 반복을 폐기하고 같은 인덱스를 재실행하며(`iteration_discarded`), 최대 `maxRetriesPerIteration`까지 반복합니다.

**종단 `contention_summary`.** 런당 정확히 하나의 `contention_summary`가 방출되며(pre-bench 중단 시 인라인으로, 그 외 모든 경로에서는 STEP 7에서), `updateRunMetaJson`(`apps/server/src/db/persist-stream.ts`)을 통해 `meta_json`에 영속화됩니다:

```json
{
  "type": "contention_summary",
  "total_iterations_discarded": 2,
  "max_pre_bench_wait_ms": 4000,
  "max_between_iteration_wait_ms": 1200,
  "total_wait_ms": 5200,
  "guard_effective": true,
  "gpu_signal_available": true,
  "abort_reason": "contention_max_retries_exceeded"
}
```

- `guard_effective` / `gpu_signal_available`는 소비자가 "깨끗한 런, 가드가 능동적으로 감시 중"과 "가드는 돌았지만 쓸 만한 신호가 없었음"을 구분하게 해 줍니다 — 이질적인 호스트들에 걸쳐 결과를 게시할 때 매우 중요합니다.
- `abort_reason`은 `pre_bench_wait_timeout`, `between_iteration_wait_timeout`, `total_wait_budget_exceeded`, `contention_max_retries_exceeded` 중 하나입니다(깨끗하게 끝나면 없음; `contentionAbortReason`은 `string | undefined`). `contention_max_retries_exceeded`로 중단된 시나리오는 집계가 신뢰 불가로 억제되며(`runs.length > 0 && contentionAbortReason !== "contention_max_retries_exceeded"`), 대기 타임아웃 중단은 그 앞에서 깨끗하게 완료된 런들을 유지합니다.

## 7. 스트레스 램프와 백프레셔

스트레스 런은 동시성을 이산적인 *스테이지*로 끌어올립니다(`step` 단위로 `start → max`). 각 스테이지 안에서는 `concurrency`개의 async 워커를 띄워 고정된 `durationMs` 인큐 창(enqueue window) 동안 스트리밍 요청을 연달아 발사한 뒤 in-flight 요청을 드레인(drain)합니다. 워커는 결과를 직접 쓰지 않고, 타입이 지정된 이벤트를 상한이 있는 인메모리 큐에 `push`하며, 바깥쪽 async 제너레이터가 그것을 `yield`합니다. 그래서 런 전체가 하나의 `AsyncGenerator<StressStreamEvent>`이고 전송 계층(SSE/WebSocket)이 곧바로 클라이언트로 파이프할 수 있습니다. 백프레셔는 high-water mark로 강제됩니다: 큐가 차면 생산자는 무한정 할당하는 대신 drain 신호를 `await`합니다. 각 스테이지는 p50/p95 지연 + TTFT, `aggregate_tps`, `tps_per_user`, `error_rate`를 담은 간결한 `StressStageResult`로 축약되며, 표본이 너무 작거나 짧아 신뢰할 수 없을 때는 `tps_unreliable` 플래그가 붙습니다. 이 형태는 라이브 진행 상황을 스트리밍하면서도 깔끔한 스테이지별 요약을 방출해야 하는 어떤 부하 하네스에도 재사용됩니다. `apps/server/src/stress-runner.ts`와 `packages/shared/src/stress.ts`를 참고하세요. 핵심 아이디어는 *생산자(워커)와 소비자(제너레이터)를 큐로 분리*하는 것입니다. 워커는 결과를 직접 방출하지 않고 `queue.push` 후 `wake()`로 소비자를 깨우며, 소비자는 큐에서 하나씩 `yield` 합니다. 큐가 `QUEUE_HIGH_WATER`(256)에 도달하면 워커가 `awaitDrainIfFull()`에서 대기하고, 소비자가 큐를 절반(128) 이하로 비우면 `drainSignal()`로 다시 깨워 메모리 폭주를 막습니다. 단계 요약값은 신뢰도 게이트를 통과해야 하며, 표본이 부족하면 TPS를 `null`로 두고 `tps_unreliable: true`를 붙여 소비자가 오해하지 않도록 합니다.

- **램프 루프.** `for (let cc = meta.ramp.start; cc <= meta.ramp.max; cc += meta.ramp.step)` — 동시성 레벨마다 한 스테이지. `clampRamp()`가 입력을 `start∈[1,256]`, `max=max(start,…,256)`, `step∈[1,64]`, `durationMs∈[100,600_000]`으로 제한하여 잘못된 요청이 무한하거나 퇴화한 램프를 만들 수 없게 합니다.
- **워커 풀.** 스테이지마다 `concurrency`개의 워커를 `workerPromises[]`로 띄웁니다. 각 워커는 루프를 돕니다: `externalSignal.aborted`와 `performance.now() >= enqueueDeadline`(여기서 `enqueueDeadline = stageStart + meta.ramp.durationMs`)를 검사한 뒤, 스트리밍 요청 하나를 보내고 `WorkerRequestOutcome`을 기록하고 반복합니다. `401`/`403`이면 그 워커는 조기 종료합니다(부하 중에는 인증이 회복되지 않으므로).
- **인큐 창 vs. 드레인.** `durationMs`는 *새* 요청 시작만 게이팅합니다. 이미 in-flight인 요청은 데드라인 이후에도 await됩니다. 스테이지는 두 국면을 모두 보고합니다: `enqueue_duration_ms`와 `drain_ms`(그리고 총 `duration_ms`).
- **백프레셔.** 두 개의 일회성 프로미스 resolver — `resolveWait`(소비자가 이벤트를 기다림)와 `resolveDrain`(생산자가 큐 드레인을 기다림). 이것이 재사용 가능한 핵심입니다:

```ts
const queue: StressStreamEvent[] = [];
const QUEUE_HIGH_WATER = 256;
const pushEvent = (ev: StressStreamEvent) => { queue.push(ev); wake(); };
const awaitDrainIfFull = async (): Promise<void> => {
  if (queue.length < QUEUE_HIGH_WATER) return;
  await new Promise<void>((resolve) => { resolveDrain = resolve; });
};
// consumer side, after shift():
if (queue.length < QUEUE_HIGH_WATER / 2) drainSignal();
```

- **경쟁 가드.** 소비자가 `resolveWait`에서 대기할 때, 프로미스 executor *안에서* `producerFinished || queue.length > 0`을 재확인하고, 그 틈에 워커가 push했거나 끝냈다면 즉시 resolve합니다 — lost-wakeup 교착을 피합니다.
- **라이브 틱.** `setInterval`(기본 `tickIntervalMs` 1000, 최소 250)이 라이브 UI를 위해 진행 중 `aggregate_tps_so_far`와 `succeeded_so_far`를 담은 `stress_stage_tick`을 방출합니다 — 최종 축약과는 독립적입니다.

**스테이지별 집계.** 스테이지가 드레인된 뒤에는 성공한 결과만 요약에 반영됩니다. `p50p95()`는 값을 정렬한 뒤 `floor(q * length)`에서 인덱스로 골라냅니다(보간 없는 nearest-rank). 요청 `latency_ms`(`totalMs`에서)와 `ttft_ms`(요청별 `ttftMs`에서; TTFT가 하나도 잡히지 않으면 통째로 생략) 모두에 적용됩니다.

```ts
const elapsedSec = durationMs / 1000;
const aggregateTpsRaw = elapsedSec > 0 ? outputTokensTotal / elapsedSec : null;
const tooFew = successful.length < 5;
const tooShort = durationMs < 3000;
const noSuccess = successful.length === 0;
const tpsUnreliable = noSuccess || tooShort || tooFew;
const aggregateTps = tpsUnreliable ? null : aggregateTpsRaw;
const tpsPerUser = aggregateTps != null ? aggregateTps / concurrency : null;
// error_rate is built inline in the result object:
//   error_rate: requestOutcomes.length > 0 ? failedCount / requestOutcomes.length : 0
```

- **`aggregate_tps` + `tps_unreliable`.** 벽시계 스테이지 초 대비 총 출력 토큰. 성공이 0이거나, 스테이지가 `< 3000 ms` 돌았거나, 성공 요청이 `5`개 미만이면 `null`로 억제되고 `tps_unreliable: true`가 추가됩니다 — 작은 표본은 오해를 부르는 처리량을 내기 때문입니다.
- **`tps_per_user`.** `aggregate_tps / concurrency` — 클라이언트당 몫으로, 램프가 올라갈수록 보통 이 값이 열화됩니다.
- **`tps_source`.** `mergeTpsSources()`는 요청별 출처를 `"usage" | "approx" | "mixed"`로 축약합니다: 모든 요청이 실제 토큰 usage를 보고했으면 `usage`, 모두 `approxOutputTokens(text)`로 폴백했으면 `approx`, 그 외에는 `mixed`. 처리량이 실측인지 추정인지 알려 줍니다.
- **`error_rate`.** *시도* 대비 실패(`requests_attempted - requests_succeeded`). 요청은 스트림이 완료(또는 비어 있지 않은 텍스트 생성)되고 *또한* `output_tokens > 0`일 때만 `ok`로 셉니다.

**재사용 가능한 스트레스 하네스 형태.** 계약은 `packages/shared/src/stress.ts`에 있으며 프로바이더 무관입니다(러너가 감지된 capabilities에 따라 `chat_completions` vs `messages`를 고름). 주요 형태:

| 타입 | 용도 | 주요 필드 |
| --- | --- | --- |
| `StressRampConfig` | 램프 입력 | `start`, `max`, `step`, `durationMs` |
| `StressStageResult` | 스테이지별 요약 | `concurrency`, `enqueue_duration_ms`, `drain_ms`, `aggregate_tps`, `tps_per_user`, `tps_unreliable?`, `latency_ms`, `ttft_ms?`, `error_rate`, `tps_source` |
| `StressStreamEvent` | 라이브 스트림 합집합 | `run_started`, `model_loaded`, `stress_stage_started`, `stress_worker_request_start/token_delta/request_end`, `stress_stage_tick`, `stress_stage_finished`, `run_finished`, `error` |

```ts
export interface StressStageResult {
  stage_index: number;
  concurrency: number;
  duration_ms: number;
  enqueue_duration_ms: number;
  drain_ms: number;
  requests_attempted: number;
  requests_succeeded: number;
  output_tokens_total: number;
  aggregate_tps: number | null;   // null when tps_unreliable
  tps_per_user: number | null;
  tps_unreliable?: true;
  latency_ms: StressStageLatencyMs;        // { p50, p95 } | nulls
  ttft_ms?: StressStageLatencyMs;          // omitted if no TTFT observed
  error_rate: number;
  tps_source: StressTpsSource;             // "usage" | "approx" | "mixed"
  script_match_rate?: number | null;
}
```

러너가 평범한 async generator이므로, 테스트는 `StressRunnerOptions`(`fetchImpl`, `signal`, `tickIntervalMs`, `maxRequestsPerWorker`)를 통해 결정론적으로 구동할 수 있습니다 — 재사용자가 업스트림을 mock하거나 워커의 요청 수를 제한하려고 주입할 바로 그 이음새입니다.

## 8. 멀티턴 에이전트 루프 하네스

멀티턴 에이전트 루프 하네스는 실제 도구를 전혀 실행하지 않고도 모델을 N번의 도구 호출 라운드에 걸쳐 구동합니다: 모든 `tool_call`은 미리 준비한 "mock" 응답으로 답하므로, 단일-샷 function-calling 프로브가 잡지 못하는 턴 간 실패 모드를 재현할 수 있습니다 — 빈 턴 정체(empty-turn stall), 중간 턴으로 새는 사고(thinking leak), 그리고 눈에 보이는 답이 나오기 전에 턴당 토큰 예산을 전부 태워 버리는 추론. 핵심은 라우트 중립적인 순수 reducer(`stepAgentLoop`)로, 라우트별로 정규화된 턴(`NormalizedTurn`)을 소비하고 `LoopState`를 누적하며, "이 도구 결과로 루프를 계속" 또는 "이번이 마지막 턴" 중 하나의 `StepDecision`을 반환합니다. 두 개의 얇은 라우트 어댑터(OpenAI `chat_completions`와 Anthropic `messages`)가 `NormalizedTurn`을 만들어 같은 reducer에 먹이므로, 와이어 포맷과 무관하게 지표가 동일하게 계산됩니다. 전체는 시나리오의 `agentLoop` 블록으로 선언적으로 정의되며, 이 블록의 존재 자체가 시나리오를 멀티턴으로 만듭니다. `apps/server/src/agent-loop.ts`와 `packages/shared/src/scenario-registry.ts`의 스키마를 참고하세요. 이 하네스의 핵심 재사용 포인트는 두 가지입니다. (1) 도구를 실제로 실행하지 않고 **캔드(canned) mock 결과만 되먹임**하므로 실행 환경 없이도 멀티턴 행동을 결정론적으로 관찰할 수 있고, (2) 턴 분석 로직을 라우트에서 분리한 **순수 reducer**로 만들어 OpenAI/Anthropic 두 라우트가 동일한 지표를 산출합니다. 라우트 어댑터가 스트림 결과를 `NormalizedTurn`으로 정규화하고, reducer(`stepAgentLoop`)는 그 정규화된 턴을 받아 상태를 누적합니다. 단일-샷 function-calling이 못 잡는 결함 — 빈 턴에서의 정체, 중간 턴 사고 누수, per-turn 예산 소진 — 을 턴을 가로질러 드러내는 것이 목적입니다.

- **Mock 디스패치 (`pullMock`)**: 평범한 `MockTool`이면 하네스가 도구별 `responses` 큐(`cursor: Map<string,number>`)에서 다음 항목을 꺼내고, `repeatLast`가 설정돼 있으면 큐가 비었을 때 마지막 항목을 반복합니다. 도구가 `argDispatch`를 정의하면, 응답은 대신 `JSON.parse(args)[argKey]`를 `cases`에서 조회해 선택되므로, 모델이 히트를 얻으려면 불투명한 id를 그대로(verbatim) 복사해야 합니다 — 이것이 인자 충실도(argument fidelity)를 측정하는 방식입니다.
- **라우트 어댑터는 정규화만 한다**: `runAgentLoopOpenAi` / `runAgentLoopAnthropic`는 `token_delta` 이벤트를 스트리밍하는 async generator로, `NormalizedTurn`(가시 `content`, `reasoningText`, `toolCalls`, `usageOutputTokens`, `finishReason`)을 만들고, 다음 반복 전에 어시스턴트 턴 + 도구 결과를 트랜스크립트에 다시 덧붙입니다.

지표 표면(`apps/server/src/agent-loop.ts`의 그대로의 형태):

```ts
export type AgentLoopMetrics = {
  turns_to_completion: number | null;   // null on stall / budget_exhausted
  empty_turn_count: number;             // turns with visible content=="" AND 0 tool_calls
  valid_tool_call_rate: number;         // validToolTurns / turnsExecuted, 0..1
  intermediate_turn_leak: boolean;      // thinking/channel tags leaked into a tool-calling turn
  thinking_exhausted_budget: boolean;   // a turn hit finish_reason=length/max_tokens with empty content
  tool_arg_hits: number | null;         // argDispatch hits; null if no argDispatch tool in scenario
  tool_arg_attempts: number | null;     // argDispatch calls;  null if no argDispatch tool in scenario
  final_turn_output_tokens: number | null; // output tokens of the no-tool final turn; null if never reached
  tool_call_counts: Record<string, number>; // per-tool actual calls (mock-matched only)
  completion_reason: "completed" | "stall" | "budget_exhausted";
};
```

- **`valid_tool_call_rate`**는 호출 비율이 아니라 *턴* 비율입니다: 어떤 턴이 유효하려면, `name`이 시나리오가 선언한 `def.tools`에 있고 **또한** `argsJson`이 `JSON.parse`를 통과하는(`jsonParses`) 도구 호출을 하나 이상 가져야 합니다. 분모는 `turnsExecuted`입니다.
- **`tool_call_counts`**는 하네스가 설정된 mock에 매칭할 수 있었던 호출만 셉니다(선언되지 않은 도구는 제외). 그리고 의도적으로 인자 유효성으로 **필터링하지 않습니다** — 시퀀스 mock은 인자가 손상돼도 여전히 "실행"되어 소비되므로, 필터링하면 실제 재시도를 "재시도 안 함"으로 잘못 보고하게 됩니다. 인자 품질은 `valid_tool_call_rate`와 `tool_arg_hits/attempts`로 따로 측정합니다.
- **`tool_arg_hits` / `tool_arg_attempts`**는 시나리오에 `argDispatch` mock이 없으면 `0`이 아니라 `null`입니다 — `state.argDispatchConfigured`가 이를 게이팅하므로 소비자가 "측정 안 됨"과 "측정했으나 히트 0"을 구분할 수 있습니다. 하위 충실도 = `hits / attempts`.
- **`intermediate_turn_leak`**는 도구 호출(비-최종) 턴에서만, `stripThinkingBlocks(content) !== content.trim()`일 때 발화합니다 — 즉 추론/채널 마크업이 깨끗해야 할 중간 콘텐츠로 새어 나온 경우입니다.

**세 가지 `completion_reason` 상태 구분하기.** 이것이 핵심입니다. `completed`와 `stall`은 둘 다 턴이 **도구 호출 없이** 도착했을 때 `stepAgentLoop`가 반환하는 *최종 턴* 판정이고, `budget_exhausted`는 바깥 루프가 반환하며 reducer는 절대 반환하지 않습니다.

| `completion_reason` | 결정 위치 | 트리거 | `turns_to_completion` | `final_turn_output_tokens` |
| --- | --- | --- | --- | --- |
| `completed` | `stepAgentLoop` (최종) | 도구 호출 없음 **그리고** 가시 콘텐츠 비어 있지 않음 | `state.turnsExecuted` | 설정됨 (최종 턴 usage) |
| `stall` | `stepAgentLoop` (최종) | 도구 호출 없음 **하지만** 가시 콘텐츠 비어 있음 (`empty_turn_loop:no_signal`) | `null` | 설정됨 (0일 수 있음) |
| `budget_exhausted` | 바깥 제너레이터 | `for` 루프가 `loop.maxTurns`에서 소진(여전히 도구 요청 중), 또는 업스트림 HTTP 오류 | `null` | `null` (최종 턴 도달 안 함) |

- 실전 판별 기준은 **누가 루프를 끝냈는가**입니다: `stall`에서는 *모델*이 자발적으로 도구 호출을 멈췄지만 쓸 만한 것을 내지 못했습니다(예산 안에서 포기). `budget_exhausted`에서는 모델이 하네스가 `maxTurns`에서 끊을 때까지 계속 도구 라운드를 요청했으므로, 도구 없는 최종 턴에 도달한 적이 없어 `final_turn_output_tokens`가 `null`입니다.
- **`thinking_exhausted_budget`은 직교적입니다 — *루프가 어떻게 끝났는지*가 아니라 *턴이 왜 비었는지*에 답합니다.** 이것은 빈 턴이 `finishReason === "length"`(OpenAI) / `"max_tokens"`(Anthropic)로 끝나거나, 서버가 `finishReason`을 생략할 때 `usageOutputTokens >= maxTokens`일 때 설정되는 스티키(sticky) 불리언입니다. `stall` 또는 `budget_exhausted` 어느 쪽과도 함께 나타날 수 있으며, 모델이 `reasoning_content`에서 과도하게 추론하다 가시 콘텐츠를 낼 예산이 남지 않은 프로덕션 `empty_turn_loop:no_signal` 시그니처를 정확히 짚어 줍니다.

```ts
// stepAgentLoop, final-turn branch (no tool calls this turn):
state.finalTurnUsageTokens = turn.usageOutputTokens;
if (isEmpty) {
  return { kind: "final", reason: "stall", turnsToCompletion: null, ... };
}
return { kind: "final", reason: "completed", turnsToCompletion: state.turnsExecuted, ... };
// vs. after the for-loop falls through at loop.maxTurns:
return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
```

mock/loop 형태는 `packages/shared/src/scenario-registry.ts`에 선언되며(`AgentLoopSchema`는 `maxTurns` 1–16, `mockTools`, `completion`을 가지고, `MockToolSchema`는 `responses`/`repeatLast`/`argDispatch`를 가짐), 구체적 시나리오는 `packages/shared/src/agent-loop-builtin.ts`에 있습니다.

## 9. 품질 채점과 LLM-as-judge

품질은 시나리오마다 단일 진입점 `scoreScenario(id, output, ctx?)`(`apps/server/src/scenarios.ts`)로 채점되며 `{ pass, score?, reason?, judge_pending? }`를 반환합니다. 대부분의 시나리오는 **빠른 prefilter**(빈 출력 검사, 정규식/부분 문자열 큐 매칭, JSON 형태 검증, 스크립트 감지)로 결정론적으로 해소되므로 API 키 없이도 점수가 재현됩니다. 주관적인 비전 시나리오(밈 설명, 와이어프레임 HTML)만 prefilter를 돌린 뒤, `LLM_JUDGE_ENABLED` 환경 변수로 게이팅되는 **선택적 LLM-as-judge** 호출(Anthropic Messages API 대상)에 위임합니다. 모든 내부 rubric 점수는 공유 스케일 `0 / 0.33 / 0.67 / 1`로 매핑되며 **`score >= 0.67`(rubric >= 2)이면 pass**입니다. 채점은 결정론 prefilter를 1차로 돌리고, 정답이 고정될 수 없는 주관적(비전) 시나리오만 LLM judge에 위임하는 2단계 구조입니다. prefilter가 통과하면 잠정 점수(`0.33`, 내부 rubric 1)와 `judge_pending: true` 플래그만 붙여 반환하고, judge가 켜져 있을 때만 `bench-runner`가 그 결과로 덮어씁니다. judge가 꺼져 있으면 점수가 `0.33`에서 **capped**되며, 이 상태는 `computeQualityScores`가 `judge_capped` caveat로 표면화합니다(무음 처리 금지). 이 섹션은 요약이며, 시나리오별 정확한 채점 기준과 런타임 규칙은 앱의 `/profile` 페이지와 저장소 `README.md`에 있으므로 여기서 중복 서술하지 않고 링크합니다.

- **Rubric → score 매핑** — 단일 출처 `rubricToScore(n: 0 | 1 | 2 | 3)`(`packages/shared/src/scenarios-preview.ts`), 서버·judge·UI가 재사용:

  | rubric | score | pass |
  |--------|-------|------|
  | 3 | `1` | true |
  | 2 | `0.67` | true |
  | 1 | `0.33` | false |
  | 0 | `0` | false |

- **빠른 prefilter (결정론, API 키 불필요)** — 예: `scoreChatMinimal`은 빈 출력에서 실패하고, `scoreVisionMemeExplain`은 4개의 정규식 큐(`/[가-힣]/`, server/donkey/contrast 큐 정규식)를 모두 요구하며, `scoreVisionWireframe`은 HTML 펜스 + N개의 시맨틱 태그 + 필수 부분 문자열 큐를 요구합니다. 구조화된 시나리오는 `extractFirstJsonObject` + Zod로 검증합니다. `detectScript`는 언어 충실도 라벨을 위해 `ko | ja | latin | mixed | unknown`으로 분류합니다.

- **`judge_pending` 핸드오프** — prefilter가 통과했지만 judge가 필요할 때, `scoreScenario`는 잠정 `score: 0.33` + `judge_pending: true`를 반환합니다. `apps/server/src/bench-runner.ts`는 `isJudgeEnabled() && quality.judge_pending === true`일 때만 judge를 호출하고, 그 뒤 **SSE/DB 방출 전에 내부 플래그를 벗겨냅니다**(`const { judge_pending: _drop, ...rest } = quality`) — 하위로 절대 새지 않도록.

- **`stripThinkingBlocks(text)`** (`packages/shared/src/llm-profiles.ts`) — `<think>` 스타일 추론 구간과 Gemma orphan-thought 접두사를 제거한 뒤 trim합니다. 코드/비전/텍스트 채점 전에 호출되어 추론 아티팩트가 rubric을 오염시키지 않게 합니다. 또한 `apps/server/src/bench-runner.ts`의 로컬 `channelTagLeak` 검사(`stripThinkingBlocks(visibleText) !== visibleText.trim()`)를 구동하여 가시 출력에 남은 `<think>`/`<|channel|>` 태그를 표시합니다(형제격인 `emptyResponse` 검사는 별개이며 이 헬퍼를 쓰지 않습니다).

- **LLM-as-judge 호출** — `runLlmJudge`(`apps/server/src/judge.ts`)는 `https://api.anthropic.com/v1/messages`에 `temperature: 0`, `max_tokens: 256`, 30초 abort 타임아웃(`LLM_JUDGE_TIMEOUT_MS`), 그리고 **재시도 없음**(`LLM_JUDGE_MAX_RETRIES`는 `0`)으로 POST합니다. 모델은 기본값 `DEFAULT_LLM_JUDGE_MODEL`(`"claude-opus-4-7"`)이며 `LLM_JUDGE_MODEL`로 재정의할 수 있고, `ANTHROPIC_API_KEY`가 필요합니다. 비전 요청은 base64 `image` 블록을 앞에 붙입니다. judge에게는 JSON만으로 답하라고 요청하며 첫 JSON 객체를 `extractFirstJsonObject`로 파싱해 냅니다.

```ts
// apps/server/src/judge.ts
export type JudgeRequest = {
  image?: { bytes: Buffer; mediaType: "image/jpeg" }; // omit → text/artifact judge
  modelOutput: string;
  criterion: string;
  scale?: "binary" | "0-3";        // default "0-3"
  model?: string;
  fetchImpl?: typeof fetch;        // test/proxy injection
};

export type JudgeResult =
  | { enabled: false }
  | { enabled: true; rubric: number; reason: string }
  | { enabled: true; error: "judge_timeout" | "judge_parse_error" | "judge_network_error"; reason: string };

export function isJudgeEnabled(): boolean; // LLM_JUDGE_ENABLED in {1,true,yes}
export async function runLlmJudge(req: JudgeRequest): Promise<JudgeResult>;
```

```bash
# enable the optional judge
export LLM_JUDGE_ENABLED=1
export ANTHROPIC_API_KEY=sk-ant-...
# optional override; default is claude-opus-4-7
export LLM_JUDGE_MODEL=claude-opus-4-7
```

- **재사용 가능한 패턴.** 저렴한 결정론 prefilter를 기본 경로로 유지하고, LLM judge는 opt-in·fail-soft 오버레이로 취급하세요: 잠정 점수 + `*_pending` 플래그, 강한 env 게이트, 제한된 단일 호출(temp 0, 타임아웃, 재시도 없음), 그리고 조용히 버리는 대신 집계 점수(`packages/shared/src/scoring/quality-score.ts`)에 표면화되는 명시적 "capped/uncovered" caveat. 전체 rubric 카탈로그는 `/profile`과 `README.md`를 참고하세요.

## 10. 런 영속화와 회귀 탐지

벤치 런은 로컬 SQLite 파일(Node 내장 `node:sqlite`[^node-sqlite]의 `DatabaseSync`, 외부 드라이버 없음)에 영속화되어 히스토리·스코어보드·A/B 비교가 프로세스 재시작을 넘어 살아남습니다. 단일 연결을 지연(lazy)으로 열어 프로세스 수명 동안 캐시하고, 파일을 열 수 없으면 하네스는 우아하게 저하됩니다(히스토리/영속화는 비활성, 벤치마크는 계속 실행). 라이브 스트리밍 이벤트는 작은 상태 기계(`start` → `onEvent` → `finalize`)로 행에 점진적으로 접혀 들어가고, 회귀 탐지는 영속화된 두 런 상세에 대한 **순수 함수**라서 DB 없이 서버 측이나 테스트에서 재사용할 수 있습니다. 재사용 가능한 패턴: 쓰기 헬퍼를 테이블별로 얇고 타입 있게 유지하고, DB를 선택적으로 취급하며, diff 로직을 부수 효과 없이 임계값 기반으로 만드는 것입니다. 이 저장소는 `apps/server/src/db/` 아래에 테이블별 얇은 헬퍼를 두는 방식을 씁니다. DB 연결은 `tryOpenProdBenchDatabase()`가 성공 시 프로세스 전역에서 재사용하고, 실패하면 `null`을 반환해 벤치는 계속 돌되 히스토리 API만 꺼집니다(최근 실패 후 `PROD_DB_RETRY_AFTER_MS = 60_000`ms 동안은 파일 I/O를 아끼려고 즉시 `null`). 스트림 이벤트는 완결된 결과를 한 번에 쓰는 대신, 이벤트가 올 때마다 행을 upsert/patch하며 누적합니다. 회귀 판정(`computeCompare`)은 DB에 의존하지 않는 순수 함수라 서버 라우트·단위 테스트 어디서나 같은 결과를 냅니다.

### SQLite 영속화 (persistence)

- 연결 설정은 `apps/server/src/db/database.ts`에 있습니다: `openBenchDatabase()`는 부모 디렉터리에 `mkdirSync`를 한 뒤 `PRAGMA journal_mode = WAL` + `PRAGMA foreign_keys = ON`을 실행하고, 이어서 `migrate()`를 돌립니다. 우아한 종료 시 `closeProdBenchDatabase()`는 `db.close()` 전에 `PRAGMA wal_checkpoint(TRUNCATE)`를 실행합니다.
- 스키마는 멱등입니다: 모든 테이블이 `CREATE TABLE IF NOT EXISTS`이고, `schema_migrations` 버전 행과 단일 best-effort `ALTER TABLE bench_scenarios ADD COLUMN prompt_system_preview` 가드(`PRAGMA table_info`로 확인)가 더해집니다. 모든 자식 테이블은 `FOREIGN KEY (run_id) ... ON DELETE CASCADE`를 쓰므로, 런을 삭제하면 시나리오/로그/스테이지가 정리됩니다.
- `apps/server/src/db/` 아래의 쿼리 헬퍼 파일(정확한 이름):

| 파일 | 역할 |
| --- | --- |
| `apps/server/src/db/database.ts` | 연결 열기/닫기/캐시, `migrate()`, 모든 행 insert/upsert/finish/list 헬퍼(`insertRun`, `upsertScenarioAggregate`, `finishRun`, `latestFinishedRunsByModels`, …) |
| `apps/server/src/db/run-queries.ts` | 읽기 측 재구성: `benchResultFromDb()` / `benchResultDetailFromDb()`가 런을 재수화(meta + 시나리오별 `runs` + 프롬프트 미리보기) |
| `apps/server/src/db/persist-stream.ts` | `BenchRunPersistence` — 라이브 벤치 중 `StreamEvent`를 `bench_*` 행으로 접음 |
| `apps/server/src/db/stress-persist-stream.ts` | `StressRunPersistence` — 스트레스 런에 대한 같은 패턴(`stress_runs` / `stress_stages`) |

- `database.ts`의 `migrate()`가 만드는 테이블:

| 테이블 | 단위(grain) | 키 컬럼 |
| --- | --- | --- |
| `bench_runs` | 런당 한 행 | `run_id` PK, `status` (`running`/`ok`/`partial`/`error`), `meta_json`, `error_code`/`error_message` |
| `bench_scenarios` | 런 × 시나리오 × 라우트 | PK `(run_id, scenario_id, api_route)`, `aggregate_json`, `prompt_preview`, `prompt_system_preview` |
| `bench_text_logs` | append-only 로그 라인 | PK `(run_id, seq)`, `ts`, `line` (4000자로 잘림) |
| `stress_runs` / `stress_stages` | 스트레스 런 / 동시성별 스테이지 | `stress_stages` PK `(run_id, stage_index)` |
| `custom_scenarios` | 사용자 정의 시나리오 def | `id` PK, `def_json`, upsert됨 |
| `schema_migrations` | 버전 원장 | 단조 증가로 삽입되는 `version` 행 |

- 복사할 만한 두 가지 쓰기 패턴: `upsertScenarioAggregate()`는 `ON CONFLICT ... DO UPDATE`에 `COALESCE(excluded.x, bench_scenarios.x)`를 써서 나중 이벤트가 앞선 프롬프트 미리보기를 null로 지우지 않게 합니다. `finishRun()`도 `error_code`/`error_message`를 `COALESCE`하여 런 도중의 `markRunErrorPartial()` 원인이 런 종료 시 지워지지 않게 합니다.

### persist-stream 라이프사이클 (start → onEvent → finalize)

`BenchRunPersistence`(`apps/server/src/db/persist-stream.ts`)는 `DatabaseSync | null`로 생성됩니다 — DB가 없으면 모든 메서드가 조기 반환하므로, 호출자는 영속화 활성 여부로 분기할 일이 없습니다.

```ts
class BenchRunPersistence {
  constructor(private readonly db: DatabaseSync | null) {}
  start(meta: BenchRunMeta): void;   // INSERT bench_runs, status="running"
  onEvent(ev: StreamEvent): void;    // fold each event into rows + text log
  finalize(): void;                  // finishRun(status = hadError ? "partial" : "ok")
}
```

- `start(meta)`는 `status: "running"`으로 `insertRun()`을 호출하고(`meta.base_url.replace(/\/+$/, "")`로 후행 슬래시를 벗겨 `base_url` 정규화), 인메모리 상태(`logSeq`, 프롬프트 캐시, `hadError`)를 리셋합니다.
- `onEvent(ev)`는 `ev.type`으로 분기합니다:
  - `scenario_start` → `` `${scenario_id}|${api_route}` `` 키로 `user_prompt` / `system_prompt`를 캐시하여(`chat_completions` / `messages`에 대해서만) 이후 집계 행이 실제 동적 프롬프트를 갖게 합니다.
  - `metrics_update` → `upsertScenarioAggregate()`가 `aggregate_json = JSON.stringify(agg)`와 캐시된(또는 정적 폴백) 프롬프트 미리보기를 씁니다.
  - `error` → `hadError = true`와 `markRunErrorPartial()`을 설정합니다(`running` → `partial`로 뒤집고 code/message 기록).
  - `contention_summary` / `preflight_memory_fit` → `updateRunMetaJson()`이 이벤트(`type` 제외)를 `meta_json`에 얕은 병합(shallow-merge)합니다. 이 값들은 런이 진행돼야 알 수 있기 때문입니다.
  - 대부분의 이벤트는 `appendTextLog()`로 사람이 읽을 수 있는 줄도 덧붙입니다.
- `finalize()`는 오류가 하나라도 있었으면 `partial`, 아니면 `ok`로 `finishRun()`을 호출한 뒤 상태를 비웁니다. 메서드 이름이 `finish()`가 아니라 `finalize()`임에 유의하세요.

### 회귀 비교 (`/api/v1/compare`)

라우트(`apps/server/src/catalog-routes.ts`의 `` `app.get(\`${prefix}/compare\`)` ``, `/api`와 `/api/v1` 양쪽에 마운트)는 `runA`&`runB` 또는 `modelA`&`modelB`&`baseUrl`(모델별 최신 완료 런을 `latestFinishedRunsByModels()`로)을 받아, 양쪽을 `benchResultDetailFromDb()`로 재수화하고, `packages/shared/src/scoring/compare.ts`의 순수 `computeCompare()`를 호출합니다. 임계값 재정의는 쿼리 파라미터로 들어오며 관대하게 파싱됩니다(`numQ`/`boolQ`).

- 런은 `` `${id} ${api_route}` ``로 조인됩니다(`joinKey` 헬퍼). **양쪽** 모두에 `runs.length > 0`으로 존재하는 시나리오만 비교됩니다. 각 쪽은 `SideMetrics`로 축약되고 모든 지표는 `MetricDelta`로 방출됩니다:

```ts
type MetricDelta = { a: number|null; b: number|null; delta: number|null; pct: number|null };
// delta = b - a  (null if either side null); pct = (b - a) / a (null if a is 0/null)
```

- 시나리오별로 방출되는 델타: `ttft_p50`, `ttft_p95`(nearest-rank 백분위), `tps_per_user`(런별 TPS의 평균), `tps_aggregate`(Σtokens / Σseconds), `quality`(점수 평균), `empty_turn_rate`, `channel_tag_leak`.
- 회귀 신호 타입(`RegressionKind`)과 정확한 규칙 — 방향이 중요하며, TPS는 **aggregate** 지표를 쓰고 TTFT는 **p95만** 쓴다는 점에 유의:

| `RegressionKind` | 임계값 키 (기본값) | 발화 조건 |
| --- | --- | --- |
| `quality_drop` | `qualityDropAbs` (0.05) | `a.quality - b.quality > qualityDropAbs` (절대 하락) |
| `tps_regression` | `tpsRegressionPct` (0.15) | `b.tps_aggregate < a.tps_aggregate * (1 - tpsRegressionPct)` |
| `ttft_regression` | `ttftRegressionPct` (0.25) | `b.ttft_p95 > a.ttft_p95 * (1 + ttftRegressionPct)` |
| `new_empty_turns` | `flagNewEmptyTurns` (true) | `a.empty_turn_rate === 0 && b.empty_turn_rate > 0` |

- 시나리오의 `regression` 불리언은 `regressions.length > 0`입니다. 최상위 `summary`는 `regression`, 합집합 `regressions`, `scenarios_regressed`, `scenarios_compared`를 롤업합니다. 기본값은 `CompareThresholdsSchema`에 한 번만 선언되고(Zod `.default(...)`) `CompareThresholdsSchema.parse(thresholdsInput ?? {})`로 적용되므로, 빈 재정의 객체라도 여전히 정본(canonical) 임계값을 냅니다 — API 기본값과 검증을 한 곳에 두는 깔끔한 방법입니다.

## 11. 프로바이더 함정

로컬 **LM Studio** 백엔드를 구동할 때, HTTP 오류를 전혀 던지지 않고도 점수를 조용히 오염시킬 수 있는 두 가지 실패 모드가 있으며, 둘 다 여러분의 하네스가 아니라 특정 앱 빌드/GGUF 템플릿에 달려 있습니다. 아래 두 문서를 정본(canonical)으로 취급하세요: LM Studio가 새 엔진 빌드를 내면서 버전 타임라인과 근본 원인 분석이 계속 바뀌므로, 내용을 복제하지 말고 단일 진실 공급원으로 유지하며 링크만 거세요. 앱 안에서는 영향받는 모든 결과 행이 `apps/web/src/components/ResultsTable.tsx`에서 `⚠` 배지로 표시됩니다. 배지 툴팁은 운영자에게 해당 행을 열라고 안내하고, 행 상세 드로어(`apps/web/src/components/ScenarioDetailDrawer.tsx`)와 표 범례가 운영자용 조치 안내인 `/profile#lmstudio-host`로의 딥링크를 담고 있습니다. 여기서 재사용 가능한 패턴은 **주석-전용(annotate-only) 감지**입니다: 오염을 런 레코드에 표시하되 pass/fail 판정은 건드리지 않고, 사람을 버전 관리되는 수정 페이지로 안내합니다. LM Studio는 두 경우 모두 200 응답을 정상으로 돌려주기 때문에 하니스가 예외로 잡을 수 없습니다. 대신 이 repo는 런 레코드에 불린 플래그만 붙이고(점수는 그대로) UI에서 `⚠` 배지로 해당 행을 표시합니다. 배지 자체는 링크가 아니라 아이콘이며, 조치 안내 `/profile#lmstudio-host` 링크는 행 상세 드로어(`ScenarioDetailDrawer.tsx`)와 결과 표 범례(`ResultsTable.tsx`)에 들어 있습니다(앵커는 웹 `ProfileDocPage.tsx`의 `id="lmstudio-host"`). 두 문서는 버전 타임라인·근본 원인이 계속 바뀌므로 여기서 복제하지 말고 canonical 문서를 링크만 합니다.

- **엔진 프로토콜 회귀(툴 인자 손상 + 추론 누수).** 증상: *"Use LM Studio Engine Protocol"*이 켜져 있으면(빌드 ~0.4.14–0.4.18), 스트리밍된 `tool_calls[].function.arguments`가 `{}{}{}`처럼 이어붙어 돌아와[^lms-1922] 하위 `JSON.parse`가 실패하고 도구 시나리오가 조용히 0점을 받습니다. 별개로, 추론이 `reasoning_content`가 아니라 응답 `content`로 재생되어 채점 텍스트를 오염시킵니다. 우회책: LM Studio **0.4.19+**로 고정(둘 다 수정됨)하거나 옵션을 끕니다. `⚠` 배지 **`tool_call_args_corrupted`**와 **`reasoning_leaked_into_content`**로 감지됩니다. 문서: [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) · 앱 내: `/profile#lmstudio-host`.
- **Jinja 템플릿 크래시(Anthropic `/v1/messages` + `tools`).** 증상: 도구가 있는 Anthropic messages 라우트에서만, 모델 내장 Jinja `chat_template`이 OpenAI 형태 가정에 맞춰 렌더링하다 `UndefinedValue`에 걸려 런이 비어서 끝납니다(`Response finished but empty`). 같은 모델의 OpenAI `/v1/chat/completions` 라우트는 대개 정상 렌더링됩니다. 우회책: 수정된 GGUF를 다시 내려받거나 LM Studio를 업데이트하거나, 호스트 측 템플릿 오버라이드 스크립트(`scripts/fix-nemotron-lmstudio-template.sh`, `scripts/fix-gemma4-lmstudio-template.sh`, 먼저 `--dry-run`으로 실행)를 적용합니다. 문서: [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) · 앱 내: `/profile#lmstudio-host`.

두 배지는 서로 다른 감지 지점에 매핑되므로, 패턴을 재사용할 때는 분리해서 유지하세요:

| 배지 플래그 | 방출 위치 | 잡아내는 시그니처 |
|---|---|---|
| `tool_call_args_corrupted` | `apps/server/src/bench-runner.ts`(`apps/server/src/openai-stream.ts`의 스트림 병합 중 계산된 `toolCallArgsCorrupted` 메트릭에서 집계) | 완전한 JSON 뒤에 또 다른 것이 이어지는 병합된 도구 호출 인자(`{}{}`) |
| `reasoning_leaked_into_content` | `apps/server/src/bench-runner.ts` | `chat_completions` 라우트에서, 별도 추론 채널이 비었을 때 thinking-block 마커가 `content`에 살아남음 |

두 플래그는 모두 `packages/shared/src/index.ts`의 런 스키마에서 선택적 불리언이며(각각 `z.boolean().optional()`로 선언), `apps/web/src/components/ResultsTable.tsx`는 둘 중 하나라도 설정되면 시나리오 옆에 `⚠`를 렌더링합니다:

```ts
// apps/web/src/components/ResultsTable.tsx
const corrupted = r.tool_call_args_corrupted === true;
// channel_tag_leak_detected is the generalized (route-agnostic) signal;
// fall back to the legacy reasoning_leaked_into_content for older runs.
const leaked =
  r.channel_tag_leak_detected === true ||
  r.reasoning_leaked_into_content === true;
```

재사용 포인트: 프로바이더가 여전히 `200 OK`를 반환하면서 출력을 오염시킬 수 있을 때는 **런을 실패시키는 대신 주석을 달아라** — 시그니처별로 이름 붙은 불리언을 붙이고, 채점은 그대로 두고, 결과 UI에서 배지로 표시하고, 운영자를 단일 버전 관리 조치 페이지(여기서는 `/profile#lmstudio-host`)로 안내해 하네스가 아니라 환경을 고치게 하세요.

## 12. 재사용 방법 (체크리스트)

이 하네스의 각 기법은 대부분 하나의 작은, 대체로 순수한 진입 모듈 뒤에 있어 따로 떼어낼 수 있습니다 — 대부분 `fetchImpl`과/또는 `signal`을 받고, 평범한 데이터나 `AsyncGenerator`를 반환하며, 프레임워크 접착제(glue)를 피합니다. 아래 "X를 원하면? 여기서 시작" 맵으로 곧장 파일과 그 패턴을 담은 export 심볼로 이동해, 먼저 그 함수 하나의 시그니처와 doc-comment부터 읽고, 협력자(collaborator)가 필요할 때만 그 import를 따라가세요. 스트리밍·감지·비교 코어는 HTTP 계층이나 SQLite에 의존하지 않으므로 다른 서버나 CLI로 깔끔하게 이식됩니다. 이 하네스의 각 기법은 대부분 "입력 → 순수 함수/제너레이터 → 데이터" 형태의 단일 진입 모듈로 격리돼 있어 통째로 들어내기 쉽습니다. 아래 표에서 원하는 기법의 파일과 export 심볼로 바로 가서, 먼저 그 함수의 시그니처와 상단 doc-comment만 읽고, 필요할 때만 import를 따라가세요. 공통 관례를 알면 이식이 빨라집니다.

- 대부분 진입 함수는 `fetchImpl?: typeof fetch`(테스트 주입·프록시 교체용)와 `signal?: AbortSignal`(취소)을 받습니다.
- 스트리밍·집계·비교 코어는 HTTP 라우팅·SQLite와 무관한 순수 로직이라 다른 서버/CLI로 그대로 옮겨집니다.
- `performance.now()` 기준 타이밍은 `requestStartedAt`를 넘겨 "HTTP 발신 시점"으로 앵커링합니다(재시도·큐 대기까지 포함하려면 이 값을 바깥에서 캡처).

| 원하는 것… | 여기서 시작 (repo 상대 경로) | 진입 심볼 |
|---|---|---|
| 스트리밍 메트릭 (TTFT/TPS, 도구 호출 병합, 잘림/루프 플래그) | `apps/server/src/openai-stream.ts` (Anthropic 쌍둥이: `apps/server/src/anthropic-stream.ts`) | `consumeOpenAiChatStream()` |
| 프로바이더 추상화 (자동 감지 + 능력 프로브) | `apps/server/src/detect.ts` | `detectProvider()` |
| 경합 가드 (바쁜 GPU를 벤치하지 않기) | `apps/server/src/contention-probe.ts` | `makeContentionProbe()`, `runIdleGate()` |
| 부하/스트레스 램프 (동시성 스윕, 백프레셔 이벤트 스트림) | `apps/server/src/stress-runner.ts` | `runStress()` |
| 멀티턴 에이전트 루프 (mock 도구 하네스, 턴별 지표) | `apps/server/src/agent-loop.ts` | `runAgentLoopOpenAi()` / `runAgentLoopAnthropic()` |
| 영속화 + 회귀 diff | `apps/server/src/db/` + `packages/shared/src/scoring/compare.ts` | `tryOpenProdBenchDatabase()`, `BenchRunPersistence`, `computeCompare()` |

**스트리밍 메트릭 — `openai-stream.ts`.** 하나의 평평한 메트릭 객체를 내는 단일 SSE 리더가 필요하면 `consumeOpenAiChatStream`을 복사하세요. 각 필드의 doc-comment가 곧 명세입니다.

```ts
export async function consumeOpenAiChatStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
  opts?: { onDelta?: (d: OpenAiStreamDelta) => void; loopGuard?: boolean; requestStartedAt?: number },
): Promise<OpenAiStreamMetrics>; // { ttftMs, totalMs, text, assistantText, reasoningText, toolCalls,
                                 //   streamCompleted, approxOutputTokens, usageOutputTokens, finishReason,
                                 //   repetitionLoopDetected, toolCallArgsCorrupted }
```

- TTFT는 **첫** content / `reasoning_content` / 도구 호출 델타에서 `markTtft()`가 찍으며, 기준은 `requestStartedAt ?? performance.now()`입니다.
- 스트림은 두 가지 토큰 수를 반환합니다: `usageOutputTokens` — `usage.completion_tokens`(없으면 `usage.output_tokens`)에서 오는 프로바이더 usage로, `stream_options.include_usage`가 필요하며 없으면 `null` — 그리고 항상 계산되는 `text.length / 4` 추정치인 `approxOutputTokens`. 호출자는 usage를 우선하고 `/ 4` 근사로 폴백하므로, TPS는 자신의 출처를 정직하게 밝힙니다(`tps_source: "usage" | "approx"`).
- 주석-전용 신호(잘림에 대한 `finishReason === "length"`, 이어붙은-`{}{}` 런타임 버그에 대한 `toolCallArgsCorrupted`)는 채점을 절대 바꾸지 않고 결과에 라벨만 붙입니다.

**프로바이더 추상화 — `detect.ts`.** `detectProvider(rawBaseUrl, opts)`는 base URL을 정규화한 뒤 네이티브 목록 엔드포인트를 순서대로 프로브합니다(LM Studio `/api/v1/models` → Ollama `/api/tags` → OpenAI `/v1/models`). LM Studio와 Ollama 히트는 고정 `capabilities`(`LM_STUDIO_COMPAT_CAPS` / `OLLAMA_COMPAT_CAPS`)를 받고, OpenAI 호환과 `manual` 폴스루(fall-through)는 `probeCapabilities`를 호출해 `/v1/chat/completions`와 `/v1/messages`에 일회용 `probe-model`을 POST합니다. 반환된 `capabilities: { openaiChat, anthropicMessages }`는 모든 하위 러너가 라우트를 고를 때 쓰는 값이므로(`stress-runner.ts`의 `pickRoute()`, 벤치 러너의 `resolveBenchApiRoutes()`), 호출마다 흩어진 분기 대신 하나의 감지 결과를 얻습니다.

- 라우트 가용성 휴리스틱 `routeLikelyAvailable(status, body)`는 잘못된-모델 `4xx`(또는 JSON 본문이 있는 `404`)를 "라우트 존재"로 취급합니다 — "엔드포인트 없음"과 "엔드포인트는 있지만 내 요청이 틀림"을 구분하려면 이걸 훔쳐 쓰세요.

**경합 가드 — `contention-probe.ts`.** 재사용 아이디어는 자기 부하가 경합으로 읽히지 않도록 하는 두 개의 **분리된 샘플링 모드**입니다: `sampleIdle()`(in-flight가 없을 때만 호출; GPU util + `/metrics` + `lms ps`를 신뢰) vs `sampleInFlight(baseline)`(요청 중; GPU 노이즈 무시, `running>=2 / waiting>=1`·모델 로드 churn·Ollama `expires_at` 전진을 감시). 이를 `runIdleGate()`로 구동하는데, 이는 진행 전에 `requiredConsecutiveIdle`회의 깨끗한 폴을 기다리는 `AsyncGenerator<StreamEvent, GateResult>`이며, 백그라운드 감지에는 `startInflightMonitor()`를 씁니다. `parsePrometheusRunningWaiting()`는 따로 떼어 쓸 수 있는 독립형 vLLM/llama.cpp/TGI 게이지 파서입니다.

**부하/스트레스 램프 — `stress-runner.ts`.** `runStress()`는 동시성을 `ramp.start`부터 `ramp.max`까지 `ramp.step` 단위로 스윕하며, `durationMs`가 지날 때까지 요청을 재발사하는 `concurrency`개의 워커를 돌립니다. 복사할 만한 것: 무한정 메모리 없이 요청별 이벤트를 스트리밍하는 상한 생산자/소비자 큐(`QUEUE_HIGH_WATER = 256`과 `awaitDrainIfFull`), 그리고 **신뢰도 게이트** — 스테이지가 성공 `< 5`, `< 3000ms` 실행, 또는 성공 0이면 `tps_unreliable`이 설정되고 `aggregate_tps`가 null됩니다.

**멀티턴 에이전트 루프 — `agent-loop.ts`.** 캔드 도구 결과를 먹이는(`pullMock`, opaque-id 충실도용 선택적 `argDispatch` 포함) mock 도구 하네스로, 단일 샷이 숨기는 멀티턴 실패 모드를 측정할 수 있습니다. 라우트 중립 코어 `stepAgentLoop(turn, def, loop, state, cursor, maxTokens)`은 순수하고(I/O 없음; 각 턴을 전달된 `state`에 접어 넣음), `finalize()`는 그 `state`를 `AgentLoopMetrics` — `empty_turn_count`, `valid_tool_call_rate`, `intermediate_turn_leak`, `thinking_exhausted_budget`, `tool_arg_hits`/`tool_arg_attempts`, `final_turn_output_tokens`, `completion_reason` — 로 렌더링하며, 전송 계층과 무관하게 재사용됩니다.

**영속화 + 회귀 — `db/` + `compare.ts`.** `tryOpenProdBenchDatabase()`는 `node:sqlite`(`DatabaseSync`, WAL, FK on)를 열고, 파일을 열 수 없으면 throw 대신 `null`을 반환하므로 벤치는 히스토리만 끈 채 계속 돌아갑니다. `BenchRunPersistence` / `StressRunPersistence`는 같은 SSE 이벤트 스트림(`start`/`onEvent`/`finalize`)을 소비해 기록합니다. 회귀 게이팅에는 `computeCompare()`가 있는데, 이는 `(scenario, api_route)`로 조인하고 시나리오별 델타를 방출하는 순수 `(detailA, detailB, thresholds) => CompareResponse`입니다.

```ts
export const CompareThresholdsSchema = z.object({
  qualityDropAbs:    z.number().default(0.05),  // abs quality drop → regression
  tpsRegressionPct:  z.number().default(0.15),  // aggregate TPS drop fraction
  ttftRegressionPct: z.number().default(0.25),  // TTFT p95 increase fraction
  flagNewEmptyTurns: z.boolean().default(true), // empty turns newly appearing in B
});
```

- `llm-bench-compare` CLI(`apps/mcp/src/compare-cli.ts`, `--fail-on-regression` / `--webhook`)로 헤드리스하게 CI에 배선하세요. 임계값은 Zod로 검증되므로 호출자가 어떤 부분집합이든 재정의할 수 있습니다.

---

## 부록 A. 용어 설명

문서 전반에 나오는 용어를, 그 개념을 깊이 다루는 섹션별로 묶었습니다. 코드 식별자는 영어 그대로 두며, 각 그룹 제목은 본문의 해당 섹션으로 되돌아가는 링크입니다.

### 측정 — [§3](#3-스트리밍-메트릭-추출)

| 용어 | 설명 |
|---|---|
| TTFT | 요청 전송부터 첫 토큰(content / `reasoning_content` / 도구 호출 델타) 도착까지의 ms. |
| TPS | 초당 출력 토큰 — 출력 토큰 ÷ 경과 시간. `aggregate_tps`는 스테이지를 합산하고, `tps_per_user`는 aggregate ÷ 동시성. |
| `approxOutputTokens` | 서버가 usage 카운트를 생략할 때 쓰는 폴백 토큰 추정치(~길이/4). |
| p50 / p95 | 스테이지 내 지연(또는 TTFT)의 중앙값 / 95백분위. |
| warmup vs measured | warmup 런은 캐시를 예열하고 버려지며, measured 런만 지표에 반영됩니다. |
| truncation | 토큰 상한에서 출력이 잘림 — `finish_reason:"length"`(OpenAI) / `stop_reason:"max_tokens"`(Anthropic). |

### 실행 모델 — [§1](#1-아키텍처와-이벤트-모델)

| 용어 | 설명 |
|---|---|
| SSE | Server-Sent Events — `data:` 프레임의 단방향 `text/event-stream`. |
| `AsyncGenerator` 이벤트 모델 | `runBench`가 타입이 지정된 이벤트를 *yield*하고, 각 소비자가 자신의 전송 방식을 고릅니다. |
| discriminated union | `type`로 키를 잡아 빠짐없이 타입을 좁히는 `StreamEvent` 합집합. |
| persist-stream lifecycle | `start → onEvent → finalize`가 라이브 이벤트를 DB 행으로 접어 넣습니다. |

### 프로바이더 — [§2](#2-멀티-프로바이더-추상화) · [§5](#5-프로바이더-로드언로드와-ttl)

| 용어 | 설명 |
|---|---|
| `ProviderKind` | `lm_studio` / `ollama` / `openai_compatible` / `manual` — 감지된 백엔드 종류. |
| capability | `{ openaiChat, anthropicMessages }` — 서버가 지원하는 와이어 라우트. |
| API route | `chat_completions`(OpenAI) 또는 `messages`(Anthropic). |
| TTL / `keep_alive` | 제한된 모델 상주 시간 — LM Studio 로드 `ttl`(초) vs Ollama `keep_alive`. |
| preload | 측정 전에 모델을 적재하는 네이티브 API 호출. |
| resident instance | 백엔드에 이미 로드된 모델(`lmStudioResidentInstances`). |
| memory-fit preflight | OOM을 피하려고 로드 전에 RAM 적합성을 예측(`FitPolicy`). |

### 가드 — [§4](#4-메모리-적합성-프리플라이트--oom-방지) · [§6](#6-오염-가드-경합-방지)

| 용어 | 설명 |
|---|---|
| contention / pollution | TTFT를 부풀리고 TPS를 떨어뜨리는 외부 동시 추론. |
| idle gate | N회 연속 유휴 폴을 요구하는 `pre_bench` / `between_iterations` / in-flight 단계. |
| `sampleIdle` vs `sampleInFlight` | 자기 부하가 경합으로 오독되지 않도록 나눈 두 샘플링 모드. |
| repetition loop | 폭주하는 반복 출력, 감지·중단됨. |
| tool-arg corruption | `{}{}{}`처럼 이어붙은 스트리밍 도구 인자(LM Studio 엔진 버그). |
| reasoning leak | 추론이 가시 `content` 채널로 재생되어 새어 나옴. |

### 스트레스·에이전트 — [§7](#7-스트레스-램프와-백프레셔) · [§8](#8-멀티턴-에이전트-루프-하네스)

| 용어 | 설명 |
|---|---|
| ramp | `step` 단위로 `start → max`인 동시성 스윕, 각 단계를 `durationMs` 동안 유지. |
| worker pool | 한 스테이지 내에서 요청을 재발사하는 N개의 동시 워커. |
| backpressure | 상한 생산자/소비자 큐(`QUEUE_HIGH_WATER`, `awaitDrainIfFull`). |
| `tps_unreliable` | 성공 <5, <3s, 또는 출력 0일 때 스테이지에 붙는 플래그(그리고 `aggregate_tps`는 null). |
| agent loop / mock tool | 단일 샷이 숨기는 실패를 드러내려고 캔드 도구 결과를 먹이는 멀티턴 루프. |
| empty turn | 가시 콘텐츠를 내지 않은 턴. |
| stall vs `budget_exhausted` | 루프 종료 이유 — 진전 없음 vs 토큰 예산 소진. |
| thinking / reasoning channel | 가시 콘텐츠와 분리해 둔 별도 추론 스트림. |

### 채점·회귀 — [§9](#9-품질-채점과-llm-as-judge) · [§10](#10-런-영속화와-회귀-탐지)

| 용어 | 설명 |
|---|---|
| rubric | 점수 스케일 `0 / 0.33 / 0.67 / 1`; `score >= 0.67`이면 pass. |
| prefilter | judge 이전에 돌리는 결정론 검사(빈 출력/정규식/JSON 형태/스크립트). |
| LLM-as-judge | `LLM_JUDGE_ENABLED`로 게이팅되는 선택적 Anthropic-Messages 채점. |
| `stripThinkingBlocks` | 채점·UI 표시 전에 인라인 추론을 제거. |
| regression thresholds | `qualityDropAbs` · `tpsRegressionPct` · `ttftRegressionPct` · `flagNewEmptyTurns`. |
| WAL | 런 DB가 쓰는 SQLite write-ahead logging 모드. |

## 부록 B. 레퍼런스

외부 출처는 본문에서 근거가 되는 정확한 지점마다 각주로 인용했으며, 이 페이지 맨 아래의 번호 목록으로 모입니다(각 항목에 `↩` 역링크). 내부 참고 문서는 아래에 정리합니다.

- [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) — LM Studio 엔진 프로토콜 회귀(툴 인자 손상·추론 누수)의 정본 진단·해결.
- [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) — Anthropic `/v1/messages` + tools에서의 Jinja 템플릿 크래시와 오버라이드.
- [`LLM_PROFILE.md`](LLM_PROFILE.md) — 모델 패밀리별 샘플링·컨텍스트·런타임 규칙.
- [`README.md`](README.md) — 프로젝트 개요와 「하네스 노하우」 절.
- 웹 UI: `/profile`(패밀리별 규칙·`#lmstudio-host` 호스트 설정) · `/scenarios`(시나리오 카탈로그) 탭.

[^mcp-spec]: [Model Context Protocol — Specification](https://modelcontextprotocol.io/specification) — MCP 서버(`apps/mcp`)가 노출하는 도구·트랜스포트 규격.
[^oai-compat]: [LM Studio — OpenAI-compatible Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) — `/v1/chat/completions` SSE 델타(`choices[].delta`) 형식. (OpenAI 공식 문서는 봇 접근을 차단하므로 검증 가능한 호환 스펙으로 대체.)
[^anthropic-stream]: [Anthropic — Messages streaming](https://docs.anthropic.com/en/api/messages-streaming) — `/v1/messages` SSE 이벤트(`content_block_delta`·`thinking_delta`·`message_delta`) 형식.
[^lms-rest]: [LM Studio — REST API](https://lmstudio.ai/docs/developer/rest) — 모델 load/unload 및 로드 시 `ttl`(초) 지정.
[^ollama-api]: [Ollama — API](https://docs.ollama.com/api) — `keep_alive`로 모델 상주 시간 지정(네이티브 `/api/generate`·`/api/chat`).
[^vllm-metrics]: [vLLM — Production metrics](https://docs.vllm.ai/en/latest/usage/metrics.html) — `vllm:num_requests_running` / `num_requests_waiting` 게이지.
[^llamacpp-server]: [llama.cpp — server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — `/metrics` Prometheus 노출(요청 처리 게이지).
[^tgi-metrics]: [Hugging Face TGI — Metrics](https://huggingface.co/docs/text-generation-inference/en/reference/metrics) — 배치·큐 게이지.
[^prometheus-fmt]: [Prometheus — Exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) — `/metrics` 텍스트 파싱 규격.
[^node-sqlite]: [Node.js — `node:sqlite`](https://nodejs.org/api/sqlite.html) — 외부 드라이버 없는 내장 `DatabaseSync`.
[^lms-1922]: [LM Studio bug-tracker #1922](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1922) — 엔진 프로토콜 런타임에서 스트리밍 `tool_calls` 인자 손상.
