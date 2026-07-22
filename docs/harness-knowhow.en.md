# Harness Know-How

Reusable techniques distilled from this project's local-LLM benchmarking & stress harness — multi-provider abstraction, streaming TTFT/TPS extraction, GPU-contention guarding, memory-fit preflight, multi-turn agent loops, ramped stress testing, and run persistence / regression comparison. Each section gives a short reference, then pointers to the exact source files, so another project can lift a single technique without adopting the whole system.

> **Maintenance.** When you change a harness API (`apps/server/src/bench-runner.ts`, `openai-stream.ts`, `anthropic-stream.ts`, `stress-runner.ts`, `agent-loop.ts`, `contention-probe.ts`, `memory-preflight.ts`, etc.), search this doc for the function / file name and update the reference in the affected section.

## Contents

- [1. Architecture & Event Model](#1-architecture--event-model)
- [2. Multi-provider abstraction](#2-multi-provider-abstraction)
- [3. Streaming metrics extraction](#3-streaming-metrics-extraction)
- [4. Memory-fit preflight & OOM guard](#4-memory-fit-preflight--oom-guard)
- [5. Provider load/unload & TTL](#5-provider-loadunload--ttl)
- [6. Contention / Pollution Guard](#6-contention--pollution-guard)
- [7. Stress ramp & backpressure](#7-stress-ramp--backpressure)
- [8. Multi-turn agent loop harness](#8-multi-turn-agent-loop-harness)
- [9. Quality scoring & LLM-as-judge](#9-quality-scoring--llm-as-judge)
- [10. Run persistence & regression detection](#10-run-persistence--regression-detection)
- [11. Provider Gotchas](#11-provider-gotchas)
- [12. How to reuse (checklist)](#12-how-to-reuse-checklist)
- [Appendix A. Glossary](#appendix-a-glossary)
- [Appendix B. References](#appendix-b-references)

---

## 1. Architecture & Event Model

**Reference.** This is a pnpm workspace monorepo of three deployable apps that all import one shared library. `@llm-bench/server` (`apps/server`) is a Hono HTTP service that owns benchmark orchestration and SQLite persistence; `@llm-bench/web` (`apps/web`) is a React SPA; `@llm-bench/mcp` (`apps/mcp`) exposes the same benchmarks as Model Context Protocol[^mcp-spec] tools. `@llm-bench/shared` (`packages/shared/src/index.ts`) is the single source of truth: every wire type — `StreamEvent`, `BenchRunMeta`, `BenchResult`, the request bodies (`BenchStreamBodySchema`), and the scoring logic — is defined once as a Zod schema and inferred into a TS type via `z.infer`, so all three apps validate against identical shapes. The reusable core is `runBench` in `apps/server/src/bench-runner.ts`: it is an `async function*` that *yields* a stream of typed events (`AsyncGenerator<StreamEvent>`) instead of writing to a socket. Orchestration is thus fully decoupled from transport — the HTTP route adapts each yielded event into an SSE frame, tests iterate the generator directly, and the MCP server consumes the same SSE endpoint over the network.

- **Shared contract.** `StreamEventSchema` is a `z.discriminatedUnion("type", [...])` in `packages/shared/src/index.ts`. The discriminant `type` lets every consumer narrow exhaustively; validation happens at the shared boundary, not per-app.
- **Generator signature** (`apps/server/src/bench-runner.ts`):

```ts
export async function* runBench(
  input: BenchRequest,
  detect: DetectResult,
  opts: { fetchImpl?: typeof fetch; /* test-only injection: probeImpl, now, sleep, systemInfoImpl */ } = {},
): AsyncGenerator<StreamEvent>
```

- **Transport adapter.** The route wraps the generator in a `ReadableStream`, serialising each event as one SSE frame and tee-ing it into a persister (`apps/server/src/routes/register.ts`):

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
  The response is served with `Content-Type: text/event-stream; charset=utf-8`; the web client reads it with `stream.getReader()` + `TextDecoder`, splits on `\n\n`, strips the `data:` prefix per line, and `JSON.parse`s each block back into a `StreamEvent` (`apps/web/src/App.tsx`). The MCP app reaches the identical endpoint via `BenchClient.postStream` (`apps/mcp/src/bench-client.ts`) and an SSE line parser (`apps/mcp/src/sse.ts`).

- **Event order (happy path of one run).** The generator emits a deterministic sequence; a single `run_started` carries the full `meta` snapshot so DB and clients share one source of truth, and exactly one `run_finished` closes the run.

| # | `type` | Emitted | Key fields |
|---|--------|---------|------------|
| 1 | `run_started` | once, first | `run_id`, `meta: BenchRunMeta` |
| 2 | `model_loaded` | after (optional `preflight_memory_fit`, `model_unloaded`) | `model_id`, `provider` |
| 3 | `scenario_start` | per scenario × route × iteration | `scenario_id`, `api_route`, `system_prompt`, `user_prompt` |
| 4 | `token_delta` | streamed during generation | `scenario_id`, `text` (UI chunks) |
| 5 | `scenario_end` | when a scenario iteration completes | `metrics { ttft_ms, total_ms, usage_output_tokens, ... }`, `quality` |
| 6 | `metrics_update` | per scenario after its runs | `aggregate { scenario_id, api_route, runs[] }` |
| 7 | `contention_summary` | once, if contention guard enabled | `total_iterations_discarded`, `guard_effective`, `abort_reason?` |
| 8 | `run_finished` | once, last | `run_id` |

  Note: the completion event is named `scenario_end` in code (not `scenario_finished`), and `metrics_update` carries the per-scenario aggregate.

- **Errors are events, not exceptions.** The generator yields `{ type: "error", layer, code, message, partial? }` with `layer ∈ "upstream" | "downstream" | "orchestrator"` and keeps streaming where recoverable (e.g. a `429` or `upstream_exception` on one iteration continues to the next). Fatal conditions end the run two ways: some `return` immediately after yielding the error (`no_routes`, `load_failed`), while others set an internal `fatalStop` flag that breaks the scenario/route loops so the run still converges on the terminal `contention_summary` (when enabled) + `run_finished` (`contention_max_retries_exceeded`, `provider_or_model_unavailable`, between-iteration wait timeout). The route also has an outer `catch` that pushes a final `stream_failed` error so a mid-stream throw still reaches the client as a typed event.
- **Contention guard as interleaved events.** Idle-gating between iterations surfaces as first-class stream events (`contention_waiting`, `contention_resumed`, `iteration_discarded`) rather than blocking silently, and every non-early-abort path converges on a single terminal `contention_summary` before `run_finished` — a clean example of modelling long-running side-conditions as yielded events instead of hidden state. (The one exception is the `pre_bench` wait timeout, which emits its own inline `contention_summary` and `return`s without a `run_finished`.)

## 2. Multi-provider abstraction

A single benchmark harness can target many locally-hosted or remote LLM servers by separating three concerns: **detection**, **capability resolution**, and **dispatch**. `detectProvider()` (`apps/server/src/detect.ts`) probes a base URL through an ordered fallback chain, tags the endpoint with a `ProviderKind`, and attaches a `capabilities` object. Downstream, `resolveBenchApiRoutes()` (`packages/shared/src/bench-api-routes.ts`) turns those booleans into a concrete list of API routes, and `runBench()` (`apps/server/src/bench-runner.ts`) loops over that list, dispatching each route to the matching wire-format adapter (OpenAI chat vs. Anthropic messages). The key idea is that provider identity is decoupled from wire capability: identity picks list/lifecycle behavior, while capability picks the request/stream format.

### Detect → fallback chain

`detectProvider()` tries each list endpoint in order and returns on the first success; every attempt is appended to `steps[]` for diagnostics. If all three miss, it falls back to `provider: "manual"`.

- `${base}/api/v1/models` → `provider: "lm_studio"` (expects `{ models: [{ key, type, display_name, ... }] }`)
- `${base}/api/tags` → `provider: "ollama"` (expects `{ models: [{ name, model, size }] }`)
- `${base}/v1/models` → `provider: "openai_compatible"` (expects `{ data: [{ id }] }`)
- none matched → `provider: "manual"` with `models: []` and a computed `reachability` state (`ok` | `partial` | `unreachable`)

`base` is normalized first by `normalizeBaseUrl()`, which prepends `http://` if missing and strips a trailing OpenAI-style `/v1` suffix (via `stripOpenAiStyleV1Suffix()`) so the harness can consistently compose `base + /v1/...`.

```ts
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
// "lm_studio" | "ollama" | "openai_compatible" | "manual"

export async function detectProvider(
  rawBaseUrl: string,
  opts?: { fetchImpl?: FetchLike; apiKey?: string;
           manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] } },
): Promise<DetectResult>;
```

### Resolve → capability object

Each detected provider carries `capabilities: { openaiChat: boolean; anthropicMessages: boolean }`. LM Studio and Ollama use **fixed** capability constants (their fake-model probe returns misleading `400`/`404` codes, so probing is skipped); `openai_compatible` and `manual` are probed live by `probeCapabilities()`, which POSTs a dummy request to `/v1/chat/completions` and `/v1/messages` and calls `routeLikelyAvailable(status, body)` — treating `2xx`, non-404 `4xx`, or a `404` whose body starts with `{` as "route exists".

| Provider | Source of caps | `openaiChat` | `anthropicMessages` |
|---|---|---|---|
| `lm_studio` | `LM_STUDIO_COMPAT_CAPS` (fixed) | `true` | `true` |
| `ollama` | `OLLAMA_COMPAT_CAPS` (fixed) | `true` | `false` |
| `openai_compatible` | `probeCapabilities()` (live) | probed | probed |
| `manual` | `probeCapabilities()` (live) | probed | probed |

### Resolve → route intersection

`resolveBenchApiRoutes()` maps capability booleans to route names, then optionally intersects with a caller-supplied `restrictTo` (e.g. a perf-only mode that wants `["chat_completions"]`). If the intersection is empty, `restrictTo` is ignored and the full detected set is returned — a deliberate "never leave the user with zero routes" fallback.

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

### Dispatch → provider adapter

`makeBenchRunMeta()` stores the resolved routes on `meta.api_routes`. `runBench()` first guards on an empty list (yielding an `error` event with `code: "no_routes"`), then iterates `for (const api_route of meta.api_routes)` and branches per route:

- `api_route === "chat_completions"` → POST `${base}/v1/chat/completions` via `openAiChatPostWithUsage()`, consume with `consumeOpenAiChatStream()`
- `api_route === "messages"` → POST `${base}/v1/messages` with header `anthropic-version: 2023-06-01`, consume with `consumeAnthropicMessagesStream()`

Provider-specific lifecycle (model load/unload TTL) is gated separately on `ProviderKind`, not on capability: `providerSupportsLoadTtl()` (`packages/shared/src/provider-kind.ts`) returns `true` only for `lm_studio` (load payload `ttl`) and `ollama` (`keep_alive`), so `runBench()` applies TTL handling for exactly those two while leaving the shared route-dispatch path identical across all providers.

## 3. Streaming metrics extraction

Both provider adapters consume an SSE `ReadableStream` incrementally — `consumeOpenAiChatStream` splits the buffer on `\n` (per line), `consumeAnthropicMessagesStream` on `\n\n` (per event block) — and return a single flat metrics object instead of the raw text. The consumer samples `performance.now()` once, at the *first* content/reasoning/tool delta, to derive TTFT relative to an `origin` captured at HTTP request start, and it separates the model's output into three parallel channels (`text` / `assistantText` / `reasoningText`) so that reasoning tokens count toward throughput without polluting the graded answer. The reusable idea: do all measurement inside the stream reader (TTFT, token estimate, truncation flag, tool-call assembly, corruption guards) so callers get comparable, provider-agnostic numbers regardless of which vendor SSE dialect produced them. Source: `apps/server/src/openai-stream.ts`, `apps/server/src/anthropic-stream.ts`.

### TTFT via `performance.now()` at first delta

- `origin = opts?.requestStartedAt ?? performance.now()` — pass `requestStartedAt` from the HTTP send site so TTFT includes connection/queue latency, not just parse time.
- A single `markTtft()` closure sets `ttft = performance.now() - origin` only while `ttft === null`, so it latches on the first delta and is idempotent thereafter.
- What counts as "first token" is deliberate: OpenAI marks on `reasoning_content`, string `reasoning`, `content`, or `tool_calls`; Anthropic marks on `content_block_start`(tool_use), `input_json_delta`, `thinking_delta`, or a text delta. Pure metadata events (usage-only chunks, `message_delta`) do **not** mark TTFT.
- `totalMs = performance.now() - origin` is captured after the read loop ends. `ttftMs` stays `null` if no delta ever arrives.

### TPS via `usageOutputTokens ?? approxOutputTokens`

- Prefer the provider's own count. OpenAI reads it from the `stream_options.include_usage` trailer (`usage.completion_tokens`, else `usage.output_tokens`); Anthropic reads `usage.output_tokens` (the running total carried on the `message_delta` event) or `message.usage.output_tokens`. Either is stored in `usageOutputTokens`, left `null` when the server omits it (common on vLLM / LM Studio).
- `approxOutputTokens` is the fallback estimate, `Math.max(0, Math.ceil(outText.length / 4))` — the classic ~4-chars-per-token heuristic. A throughput consumer computes tokens/sec as `(usageOutputTokens ?? approxOutputTokens) / (totalMs / 1000)`.
- Both adapters make the estimate count reasoning tokens so the two providers are comparable: OpenAI's `outText` (= `combined`) already contains reasoning, whereas Anthropic keeps reasoning out of `text` and instead adds it back explicitly: `Math.ceil((reasoningText.length + outText.length) / 4)`.

### Reasoning-channel separation: `text` vs `assistantText` vs `reasoningText`

| Field | OpenAI source | Anthropic source | Purpose |
|---|---|---|---|
| `assistantText` | `delta.content` only | `content_block_delta` text only | Graded visible answer; tool-round history |
| `reasoningText` | `delta.reasoning_content` + string `delta.reasoning` | `thinking_delta` | Re-injected as reasoning history; excluded from grading |
| `text` | `combined` (reasoning + content, in arrival order) + `\n` + serialized `tool_calls` | content text + `\n` + serialized `tool_calls` (reasoning **not** included) | Throughput denominator / `output_text` base |

- Grading uses a helper that prefers the clean channel: `openAiBenchOutputText` returns `assistantText` when non-empty and falls back to `text` (guards the interleaved `reasoning_split` case where the final turn emits reasoning-only deltas).
- Live token UI uses `openAiLiveTokenStreamText` = `` `${reasoningText}${assistantText}` `` so reasoning is shown streamed but stays separable.

### Truncation detection

- OpenAI stores the last non-empty `choices[0].finish_reason` in `finishReason`; `"length"` means the `max_tokens` ceiling was hit (truncated). Anthropic stores `message_delta.delta.stop_reason` in `stopReason`; `"max_tokens"` is the truncation signal.
- Both fields can be `null` on OpenAI-compatible servers that omit them, so treat `null` as "unknown", not "clean stop". Note Anthropic tracks stream *completion* separately (`sawMessageDelta` from `message_stop`) from the *reason*.[^oai-compat][^anthropic-stream]

### `tool_call` merging by index

- Streamed tool calls arrive as fragments keyed by `index`; both adapters accumulate into a `Map<number, ...>`. OpenAI's `mergeToolCallDeltas` keys each fragment by `typeof p.index === "number" ? p.index : 0`, overwrites `id`/`type`/`name` when present, and **concatenates** `function.arguments` fragments. Anthropic seeds an entry on `content_block_start`(tool_use) — indexed by `j.index ?? 0` — and appends `input_json_delta.partial_json` into `inputJson`.
- On finalize, entries are sorted by index. Anthropic `JSON.parse`s each `inputJson` (falling back to `{}` on error) into `AnthropicToolUseOut.input`; missing ids are synthesized (`bench_tool_${index}` / `toolu_bench_${index}`).

### `repetitionLoopDetected` guard (OpenAI only)

- Opt-in via `opts.loopGuard === true`; otherwise skipped entirely so existing callers keep their behavior/overhead.
- Every time `contentOnly` grows by ≥ 512 chars, it runs `detectRepetitionLoop` (`apps/server/src/repetition-guard.ts`) — a conservative heuristic needing ≥ 600 chars and either a repeated trailing block or ≥ 6 near-identical trailing lines.
- On detection it sets `repetitionLoopDetected = true`, `break`s **before** the next `reader.read()` (so no in-flight read → no `AbortError`), then calls `reader.cancel()` to close the backend connection cleanly.

### `toolCallArgsCorrupted` detection (OpenAI only)

- Annotate-only signal (does not change grading) for the LM Studio engine-protocol regression (lmstudio-bug-tracker #1922) where streamed `arguments` come back concatenated, e.g. `{}{}` or `{"…"}{"…"}`.
- `firstBalancedJsonEnd` scans string/escape-aware for the end of the first balanced JSON value; `toolArgsLookCorrupted` flags the call when any non-whitespace remains after it. Empty strings, a single complete object, and truncated/incomplete JSON are treated as *not* corrupted (those get other labels).

### Metrics shapes

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

## 4. Memory-fit preflight & OOM guard

**Reference.** Before loading a model weight into RAM, this harness predicts whether it will actually fit and, if not, either skips the run or evicts other resident models — turning a hard OOM ("insufficient system resources") into a clean, logged decision. The predictor takes the model's raw `size_bytes`, inflates it by a runtime/KV overhead factor, and checks it against free memory minus a fixed OS safety reserve. Crucially, this gate is **LM Studio-centric**: the required-size signal and the eviction mechanism both come from LM Studio's local model API, so **other providers (hosted APIs, other local runtimes) have no equivalent preflight gate** — they simply run without this check. The core logic lives in `apps/server/src/memory-preflight.ts`, with the LM Studio-specific helpers in `apps/server/src/lmstudio.ts`.

### Tunable constants

Two constants define the safety margin (from `apps/server/src/memory-preflight.ts`):

```ts
/** runtime/KV overhead factor, calibrated to an observed 25.71→28.28GB (~+10%) load. */
export const FIT_OVERHEAD_FACTOR = 1.1;
/** headroom reserved for the OS and other processes (bytes). */
export const FIT_SAFETY_RESERVE_BYTES = 2 * 1024 ** 3; // 2 GiB
```

- `FIT_OVERHEAD_FACTOR` accounts for weights-on-disk understating live footprint (KV cache, runtime buffers). The `1.1` here was calibrated against a real observed load, not guessed — recalibrate it for your own runtime.
- `FIT_SAFETY_RESERVE_BYTES` keeps a fixed slab of RAM free so the machine doesn't thrash even when the model itself "fits."

### Where the numbers come from (LM Studio helpers)

Both inputs are pulled from LM Studio's `GET /api/v1/models` (falling back to `/api/v0/models`) response, parsed by `lmStudioListModels()`. Two exported helpers in `apps/server/src/lmstudio.ts` extract what preflight needs:

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

- Model keys are normalized with `baseKey()`, which applies `.replace(/:\d+$/, "")` to strip a trailing numeric `:<N>` suffix so a bench `modelId` matches LM Studio's listed `key`.
- `lmStudioModelSizeBytes()` reads the listed `size_bytes`; if that is absent, `preflightMemoryFit()` falls back to the `size_bytes` reported by `detect`, and only if both are missing does it treat the size as unknown.
- `lmStudioResidentInstances()` reads per-instance usage via the local `firstNumberField()` helper with an ordered key fallback (`ram_usage` → `ram` → `ram_bytes`, plus the `vram_usage` → `vram` → `vram_bytes` equivalents), mirroring the monitor-collect `numberField` convention. These instances are the RAM the harness can reclaim; each `instanceId` comes from `loaded_instances[].id` — the same value LM Studio's official unload body carries (`{ "instance_id": "…" }`, posted by `lmStudioUnload()`).

### The fit computation

`preflightMemoryFit()` reads free memory from a `SystemSnapshot` (`getSystemSnapshot()` → `os.freemem()` on the `freeMemBytes` field, injectable for tests) and computes:

```ts
const requiredWithOverhead = Math.ceil(required * FIT_OVERHEAD_FACTOR);
const willFit          = requiredWithOverhead <= free - FIT_SAFETY_RESERVE_BYTES;
const fitsAfterUnload  = requiredWithOverhead <= free + residentRam - FIT_SAFETY_RESERVE_BYTES;
```

Note `required_bytes` in the emitted event is the **raw** `size_bytes` (pre-overhead); the overhead is applied only inside the comparison.

### FitPolicy outcomes

`fitPolicy` is an optional enum — `FitPolicySchema = z.enum(["skip", "unload_other_models"]).optional()` (see `packages/shared/src/index.ts`). It never contains `"proceed"`; an absent policy means "predict-and-log only, never block." The returned `FitDecision.action` resolves as follows:

| Condition | `fitPolicy` | `action` | Effect |
|---|---|---|---|
| `required` unknown (no `size_bytes`) | any | `proceed` | Log-only, `reason: preflight_skipped` — never blocks (backward-compat) |
| `willFit` is true | any | `proceed` | Load proceeds normally |
| Won't fit, but `fitsAfterUnload` & residents exist | `unload_other_models` | `unload_other_models` | Returns `residentInstances` for the caller to evict, then load |
| Won't fit (or still won't after unload) | `skip` or `unload_other_models` | `skip` | Run is skipped instead of OOMing |
| Won't fit | *unset* | `proceed` | Emits a "prediction: may not fit" warning event but proceeds |

- The function **always** returns a `PreflightMemoryFitEvent` (fields: `model_id`, `required_bytes`, `free_bytes`, `resident_ram_bytes`, `will_fit`, `action`, `reason`, `size_source`) regardless of policy, so the prediction is observable even when it doesn't gate anything.
- `size_source` records provenance: `"list"` (LM Studio), `"detect"` (fallback), or `"unknown"`.
- Only `unload_other_models` populates `residentInstances` as an actionable eviction set; other outcomes return it empty or informational (the `skip` branch still passes `residents` through as informational).

**Reusable takeaway.** The pattern — `predict(size × overhead) vs (free − reserve)`, always emit a decision event, and gate only under an explicit opt-in policy while defaulting to non-blocking — transfers to any local-model runtime that can report a candidate's memory size and its resident set. The specifics here (`/api/v1/models`, `instance_id` unload) are LM Studio's; the preflight/OOM-guard shape is provider-agnostic.

## 5. Provider load/unload & TTL

**Reference.** Local model backends differ in *how* you tell them to hold a model in memory for a bounded window, so the harness gates this behind a single capability check, `providerSupportsLoadTtl(kind)`, and applies the TTL per-provider. LM Studio accepts a `ttl` (in **seconds**) directly on its load call, giving idle auto-eviction. Ollama uses `keep_alive`, but with a sharp caveat: its OpenAI-compatible `/v1/chat/completions` endpoint — the one the benchmark actually drives inference through — **ignores `keep_alive` and silently resets the model's lifetime to the default 5 minutes on every request** ([ollama#11458](https://github.com/ollama/ollama/issues/11458)). The reusable workaround is to apply the desired TTL out-of-band via Ollama's *native* API twice: once as a preload before the run, and once again after the run to re-assert the intended keep-alive.[^lms-rest][^ollama-api]

- **Capability gate** (`packages/shared/src/provider-kind.ts`): `providerSupportsLoadTtl(p)` returns `true` only for `"lm_studio"` and `"ollama"`. Callers short-circuit all TTL logic when it returns `false`.
- **LM Studio** (`apps/server/src/lmstudio.ts`): `lmStudioLoad(baseUrl, modelKey, { ttlSeconds })` posts `{ model, ttl }` to `/api/v1/models/load` (falling back to `/api/v0/...`). `ttl` is only included when `ttlSeconds` is finite and `> 0`, and is floored to an integer second count. This is a native LM Studio field, so no re-apply dance is needed.
- **Ollama** (`apps/server/src/ollama.ts`): `ollamaKeepAliveLoad(baseUrl, model, { ttlSeconds })` posts to the **native** `/api/generate` with an empty prompt (`prompt: ""`, `stream: false`) so the model loads into memory without generating (response `done_reason: "load"`). The TTL is sent as `keep_alive: "<seconds>s"` — an explicit Go duration string — to avoid numeric-vs-duration ambiguity.
- **The `/v1` reset workaround** (see `apps/server/src/bench-runner.ts`): the exact same `ollamaKeepAliveLoad` call is reused (1) as a preload *before* inference and (2) *after* the benchmark completes, because the intervening `/v1/chat/completions` calls will have reset the model back to the 5-minute default. The after-bench re-apply is best-effort.
- **Best-effort semantics**: `ollamaKeepAliveLoad` never throws — network/upstream failures return `{ ok: false, status: 0, body }` — so a flaky keep-alive can't abort a run. It uses a generous 120s timeout (`OLLAMA_LOAD_TIMEOUT_MS`) since a cold load of a large model can take tens of seconds.

| Provider | Function | Endpoint | TTL field / shape |
| --- | --- | --- | --- |
| `lm_studio` | `lmStudioLoad` | `POST /api/v1/models/load` | `{ model, ttl }` — `ttl` in **integer seconds**, omitted unless `> 0` |
| `ollama` | `ollamaKeepAliveLoad` | `POST /api/generate` (native) | `{ model, prompt: "", stream: false, keep_alive: "<sec>s" }` |
| `openai_compatible`, `manual` | — | — | unsupported; TTL ignored |

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

**Reusable takeaway for other projects:** when a backend exposes both a native API and an OpenAI-compat shim, don't assume lifetime/keep-alive hints on the compat endpoint are respected. Isolate the "hold the model resident" concern into one idempotent, best-effort function, gate it behind a provider-capability predicate, and bracket the actual workload with it (preload before, re-assert after) so the effective TTL is what you intended rather than the shim's silent default.

## 6. Contention / Pollution Guard

**Reference.** A benchmark that measures latency and throughput on a shared GPU is only trustworthy if no *other* inference runs concurrently — a foreign generation can inflate TTFT and depress tokens/sec, silently poisoning the numbers. The reusable technique here is a **multi-signal idle gate** that never trusts a single probe: it fuses GPU utilization (`nvidia-smi`), Prometheus `/metrics` request gauges (vLLM[^vllm-metrics] / llama.cpp[^llamacpp-server] / TGI[^tgi-metrics]), the `lms ps --json` activity view (LM Studio), and Ollama `expires_at` churn. The key structural insight is **two sampling modes** that avoid *self*-contention (our own load lighting up the GPU): an idle sampler (`sampleIdle`) used only when no request of ours is in-flight, and an in-flight sampler (`sampleInFlight`) used only *during* our streaming that ignores GPU util (which we ourselves cause) and instead counts request-queue deltas above our known contribution of 1. This is wired into three phases — a `pre_bench` gate, a `between_iterations` gate, and a background in-flight monitor that aborts and re-measures on detection. See `apps/server/src/contention-probe.ts` and its integration in `apps/server/src/bench-runner.ts`.

- **Signal reach (where each signal is valid).** GPU and `lms ps` are only valid on the server-local host (`isTargetOnServerHost(baseUrl)`); `lms ps` additionally requires `provider === "lm_studio"` + `isLmsCliEnabled()` + the CLI-active toggle. `/metrics` is a network endpoint, so remote targets (`openai_compatible` / `manual`) work too. For an unsupported server, `/metrics` fails once (non-OK or unparseable) and then latches to `metricsUnavailable`, so it is not re-polled.
- **Idle vs in-flight thresholds.** Idle mode treats `metrics.running >= 1 || metrics.waiting >= 1` as active and waits; in-flight mode subtracts our own single request, so it uses `metrics.running >= 2 || metrics.waiting >= 1` as the contention threshold.
- **`effective` (did the guard actually have an effect).** If `sampleIdle` observes any signal among GPU / metrics / lms that can judge "currently computing," `hasActiveSignal=true` and the gate promotes it to `effective`. Loaded inventory does not contribute to `effective`; only when no active signal is present at all does it fall back to the `inventory_only_no_active_signal` (another model is loaded) or `no_contention_signal_available` reason label.

The Prometheus[^prometheus-fmt] parser sums the gauges of all three engines (no match → `null` = unsupported server):

```ts
const RUNNING_METRICS = ["vllm:num_requests_running", "llamacpp:requests_processing", "tgi_batch_current_size"];
const WAITING_METRICS = ["vllm:num_requests_waiting", "llamacpp:requests_deferred", "tgi_queue_size"];
export function parsePrometheusRunningWaiting(text: string): { running: number; waiting: number } | null;
```

The three probe entry points and the config knobs (all clamped from UI input by `resolveContentionConfig`):

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

The signals mapped to the phase that consumes them:

| Signal | Source | Idle gate (`sampleIdle`) | In-flight monitor (`sampleInFlight`) |
|---|---|---|---|
| GPU utilization | `nvidia-smi` via `getGpuSnapshot()` | active if `maxUtil > gpuUtilThresholdPct` | **not used** (our own load) |
| Request gauges | Prometheus `/metrics` | `running≥1 \|\| waiting≥1` | `running≥2 \|\| waiting≥1` |
| LM Studio activity | `lms ps --json` | any `generating` or our `queued>0` | *foreign* model generating, or our `queued>0` |
| New model load | loaded-model inventory | not a trigger; only labels `inventory_only_no_active_signal` when no active signal | ID not in `baseline.loadedIds` → `new_model_loaded` |
| Ollama churn | `expires_at` per model | — | `expires_at` advanced past baseline → `expires_at_advanced` (same-model foreign request) |

**Gate loop mechanics.** `runIdleGate` is an async generator: the first sample being idle returns immediately (`waitedMs: 0`); a busy sample enters a poll loop that emits `contention_waiting` events (deduped — emitted on the first poll, on reason change, or every 5th poll) and only resumes after `requiredConsecutiveIdle` consecutive idle samples, emitting `contention_resumed`. Timeout and `totalWaitBudgetMs` are re-checked *inside* the loop on every poll (an entry-only check cannot catch overrun during sleep). On success it hands back a fresh `segmentBaseline()` for the in-flight monitor to diff against.

**In-flight monitor teardown race.** `startInflightMonitor` returns an **async** `stop()`. Its internal `sampleInFlight` is deliberately called *without* the teardown abort signal — so a positive detection in-flight is honored even when `stopRequested` is already set, rather than being swallowed by a `catch`. Only the *sleep* between polls is abortable (via a separate `AbortController`, `sleepCtrl`), letting teardown wake fast while never losing a detection. On detect it fires `onDetect(reasons)`, whose runner callback calls `contentionController.abort()`; the request itself listens on the combined `reqSignal = AbortSignal.any([controller.signal, contentionController.signal])` (request-timeout OR contention), so the abort tears down the in-flight request. The runner then discards that measured iteration and re-runs the same index (`iteration_discarded`), up to `maxRetriesPerIteration`.

**Terminal `contention_summary`.** Exactly one `contention_summary` is emitted per run (either inline on a pre-bench abort, or at STEP 7 for every other path), and persisted into `meta_json` via `updateRunMetaJson` (`apps/server/src/db/persist-stream.ts`):

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

- `guard_effective` / `gpu_signal_available` let a consumer distinguish "clean run, guard actively watching" from "guard ran but had no usable signal" — critical when publishing results across heterogeneous hosts.
- `abort_reason` is one of `pre_bench_wait_timeout`, `between_iteration_wait_timeout`, `total_wait_budget_exceeded`, or `contention_max_retries_exceeded` (absent on a clean finish; `contentionAbortReason` is `string | undefined`). A scenario aborted by `contention_max_retries_exceeded` has its aggregate suppressed as untrustworthy (`runs.length > 0 && contentionAbortReason !== "contention_max_retries_exceeded"`), while wait-timeout aborts keep the cleanly-completed runs that preceded them.

## 7. Stress ramp & backpressure

**Reference.** A stress run walks concurrency upward in discrete *stages* (`start → max` by `step`), and inside each stage it spins up `concurrency` async workers that fire streaming requests back-to-back for a fixed `durationMs` enqueue window, then drains in-flight requests. Workers never write results directly; they `push` typed events into a bounded in-memory queue and an outer async generator `yield`s them, so the whole run is a single `AsyncGenerator<StressStreamEvent>` that a transport (SSE/WebSocket) can pipe straight to a client. Backpressure is enforced by a high-water mark: when the queue fills, producers `await` a drain signal instead of allocating unboundedly. Each stage is reduced to a compact `StressStageResult` with p50/p95 latency + TTFT, `aggregate_tps`, `tps_per_user`, and `error_rate`, with a `tps_unreliable` flag when the sample is too small or too short to trust. This shape is reusable for any load harness that streams live progress while still emitting a clean per-stage summary. See `apps/server/src/stress-runner.ts` and `packages/shared/src/stress.ts`.

- **Ramp loop.** `for (let cc = meta.ramp.start; cc <= meta.ramp.max; cc += meta.ramp.step)` — one stage per concurrency level. `clampRamp()` bounds inputs to `start∈[1,256]`, `max=max(start,…,256)`, `step∈[1,64]`, `durationMs∈[100,600_000]` so a malformed request can't produce an infinite or degenerate ramp.
- **Worker pool.** Per stage, `concurrency` workers are launched into `workerPromises[]`. Each worker loops: check `externalSignal.aborted` and `performance.now() >= enqueueDeadline` (where `enqueueDeadline = stageStart + meta.ramp.durationMs`), then issue one streaming request, record a `WorkerRequestOutcome`, and repeat. A `401`/`403` makes that worker bail early (auth won't recover under load).
- **Enqueue window vs. drain.** `durationMs` only gates *new* request starts; requests already in flight are awaited after the deadline. The stage reports both phases: `enqueue_duration_ms` and `drain_ms` (plus total `duration_ms`).
- **Backpressure.** Two one-shot promise resolvers — `resolveWait` (consumer waits for events) and `resolveDrain` (producer waits for the queue to drain). This is the reusable core:

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

- **Race guard.** When the consumer parks on `resolveWait`, it re-checks `producerFinished || queue.length > 0` *inside* the promise executor and resolves immediately if a worker pushed or finished in the gap — avoiding a lost-wakeup deadlock.
- **Live ticks.** A `setInterval` (default `tickIntervalMs` 1000, floored at 250) emits `stress_stage_tick` with a running `aggregate_tps_so_far` and `succeeded_so_far` for live UI, independent of the final reduction.

**Per-stage aggregation.** After a stage drains, only successful outcomes feed the summary. `p50p95()` sorts the values and index-picks at `floor(q * length)` (nearest-rank, not interpolated) for both request `latency_ms` (from `totalMs`) and `ttft_ms` (from per-request `ttftMs`, omitted entirely if no TTFT was captured).

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

- **`aggregate_tps` + `tps_unreliable`.** Total output tokens over wall-clock stage seconds. Suppressed to `null` (and `tps_unreliable: true` added) when there are zero successes, the stage ran `< 3000 ms`, or fewer than `5` requests succeeded — small samples produce misleading throughput.
- **`tps_per_user`.** `aggregate_tps / concurrency` — the per-client share, which is what usually degrades as the ramp climbs.
- **`tps_source`.** `mergeTpsSources()` collapses per-request sources into `"usage" | "approx" | "mixed"`: `usage` when every request reported real token usage, `approx` when all fell back to `approxOutputTokens(text)`, else `mixed`. This tells the reader whether throughput is measured or estimated.
- **`error_rate`.** Failures over *attempts* (`requests_attempted - requests_succeeded`). A request counts as `ok` only if the stream completed (or produced non-empty text) *and* `output_tokens > 0`.

**Reusable stress-harness shape.** The contract lives in `packages/shared/src/stress.ts` and is provider-agnostic (the runner picks `chat_completions` vs `messages` per detected capabilities). Key shapes:

| Type | Purpose | Notable fields |
| --- | --- | --- |
| `StressRampConfig` | ramp inputs | `start`, `max`, `step`, `durationMs` |
| `StressStageResult` | per-stage summary | `concurrency`, `enqueue_duration_ms`, `drain_ms`, `aggregate_tps`, `tps_per_user`, `tps_unreliable?`, `latency_ms`, `ttft_ms?`, `error_rate`, `tps_source` |
| `StressStreamEvent` | live stream union | `run_started`, `model_loaded`, `stress_stage_started`, `stress_worker_request_start/token_delta/request_end`, `stress_stage_tick`, `stress_stage_finished`, `run_finished`, `error` |

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

Because the runner is a plain async generator, tests can drive it deterministically via `StressRunnerOptions` (`fetchImpl`, `signal`, `tickIntervalMs`, `maxRequestsPerWorker`) — the same seams a reuser would inject to mock the upstream or bound a worker's request count.

## 8. Multi-turn agent loop harness

**Reference.** A multi-turn agent loop harness drives a model across N tool-calling rounds without executing any real tools: every `tool_call` is answered from a canned "mock" response, so the harness can reproduce cross-turn failure modes that a single-shot function-calling probe cannot — empty-turn stalls, thinking that leaks into intermediate turns, and reasoning that burns the whole per-turn token budget before any visible answer. The core is a route-neutral pure reducer (`stepAgentLoop`) that consumes a route-normalized turn (`NormalizedTurn`), accumulates a `LoopState`, and returns a `StepDecision` of either "keep looping with these tool results" or "this is the final turn." Two thin route adapters (OpenAI `chat_completions` and Anthropic `messages`) build the `NormalizedTurn` and feed the same reducer, so metrics are computed identically regardless of wire format. The whole thing is defined declaratively by an `agentLoop` block on the scenario; its presence is what makes a scenario multi-turn. See `apps/server/src/agent-loop.ts` and the schema in `packages/shared/src/scenario-registry.ts`.

- **Mock dispatch (`pullMock`)**: for an ordinary `MockTool` the harness pops the next entry from a per-tool `responses` queue (a `cursor: Map<string,number>`), and repeats the last entry when the queue is drained if `repeatLast` is set. If a tool defines `argDispatch`, the response is instead selected by looking up `JSON.parse(args)[argKey]` in `cases`, so the model must copy an opaque id verbatim to get a hit — that is how argument fidelity is measured.
- **Route adapters just normalize**: `runAgentLoopOpenAi` / `runAgentLoopAnthropic` are async generators that stream `token_delta` events, build a `NormalizedTurn` (visible `content`, `reasoningText`, `toolCalls`, `usageOutputTokens`, `finishReason`), and append the assistant turn + tool results back onto the transcript before the next iteration.

The metric surface (verbatim shape from `apps/server/src/agent-loop.ts`):

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

- **`valid_tool_call_rate`** is a *turn* ratio, not a call ratio: a turn counts as valid if it has at least one tool call whose `name` is in the scenario's declared `def.tools` **and** whose `argsJson` passes `JSON.parse` (`jsonParses`). Divisor is `turnsExecuted`.
- **`tool_call_counts`** counts only calls the harness could match to a configured mock (undeclared tools excluded), and deliberately does **not** filter on argument validity — a sequence mock still "runs" and gets consumed even with corrupted args, so filtering would misreport a real retry as "didn't retry." Argument quality is measured separately by `valid_tool_call_rate` and `tool_arg_hits/attempts`.
- **`tool_arg_hits` / `tool_arg_attempts`** are `null` (not `0`) when the scenario has no `argDispatch` mock — `state.argDispatchConfigured` gates them so consumers can tell "not measured" from "measured, zero hits." Downstream fidelity = `hits / attempts`.
- **`intermediate_turn_leak`** fires only on tool-calling (non-final) turns, when `stripThinkingBlocks(content) !== content.trim()` — i.e. reasoning/channel markup bled into what should be clean intermediate content.

**Distinguishing the three `completion_reason` states.** This is the crux. `completed` and `stall` are both *final-turn* verdicts returned by `stepAgentLoop` when a turn arrives with **no tool calls**; `budget_exhausted` is returned by the outer loop and never by the reducer.

| `completion_reason` | Where decided | Trigger | `turns_to_completion` | `final_turn_output_tokens` |
| --- | --- | --- | --- | --- |
| `completed` | `stepAgentLoop` (final) | No tool calls **and** visible content non-empty | `state.turnsExecuted` | set (final turn usage) |
| `stall` | `stepAgentLoop` (final) | No tool calls **but** visible content empty (`empty_turn_loop:no_signal`) | `null` | set (may be 0) |
| `budget_exhausted` | outer generator | `for` loop ran out at `loop.maxTurns` (still requesting tools), or an upstream HTTP error | `null` | `null` (final turn never reached) |

- The practical tell is **who ended the loop**: on a `stall` the *model* voluntarily stopped calling tools but emitted nothing usable (it gave up inside its budget); on `budget_exhausted` the model kept asking for more tool rounds until the harness cut it off at `maxTurns`, so `final_turn_output_tokens` is `null` because a no-tool final turn was never reached.
- **`thinking_exhausted_budget` is orthogonal — it answers *why* a turn was empty, not *how the loop ended*.** It is a sticky boolean set whenever an empty turn ends with `finishReason === "length"` (OpenAI) / `"max_tokens"` (Anthropic), or — when the server omits `finishReason` — when `usageOutputTokens >= maxTokens`. It can co-occur with either `stall` or `budget_exhausted` and pinpoints the production `empty_turn_loop:no_signal` signature where a model over-reasoned in `reasoning_content` until it had no budget left to emit visible content.

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

The mock/loop shapes are declared in `packages/shared/src/scenario-registry.ts` (`AgentLoopSchema` with `maxTurns` 1–16, `mockTools`, `completion`; `MockToolSchema` with `responses`/`repeatLast`/`argDispatch`), and concrete scenarios live in `packages/shared/src/agent-loop-builtin.ts`.

## 9. Quality scoring & LLM-as-judge

**Reference.** Quality is scored per scenario by a single entrypoint `scoreScenario(id, output, ctx?)` (`apps/server/src/scenarios.ts`) that returns `{ pass, score?, reason?, judge_pending? }`. Most scenarios resolve deterministically with a **fast prefilter** (empty-output checks, regex/substring cue matching, JSON-shape validation, script detection) so scores are reproducible without any API key. Subjective vision scenarios (meme explanation, wireframe HTML) only run a prefilter, then defer to an **optional LLM-as-judge** call against the Anthropic Messages API, gated by the `LLM_JUDGE_ENABLED` env var. All internal rubric scores map to a shared `0 / 0.33 / 0.67 / 1` scale where **`score >= 0.67` (rubric >= 2) is a pass**. This section is a summary; the authoritative per-scenario rubric and runtime rules live in the app's `/profile` page and the repo `README.md`.

- **Rubric → score mapping** — single source `rubricToScore(n: 0 | 1 | 2 | 3)` in `packages/shared/src/scenarios-preview.ts`, reused by server, judge, and UI:

  | rubric | score | pass |
  |--------|-------|------|
  | 3 | `1` | true |
  | 2 | `0.67` | true |
  | 1 | `0.33` | false |
  | 0 | `0` | false |

- **Fast prefilter (deterministic, no API key)** — e.g. `scoreChatMinimal` fails on empty output; `scoreVisionMemeExplain` requires all 4 regex cues (`/[가-힣]/`, server/donkey/contrast cue regexes); `scoreVisionWireframe` requires an HTML fence + N semantic tags + required substring cues; structured scenarios validate via `extractFirstJsonObject` + Zod. `detectScript` classifies `ko | ja | latin | mixed | unknown` for language-fidelity labels.

- **`judge_pending` handoff** — when a prefilter passes but needs a judge, `scoreScenario` returns provisional `score: 0.33` + `judge_pending: true`. `apps/server/src/bench-runner.ts` calls the judge only when `isJudgeEnabled() && quality.judge_pending === true`, then **strips the internal flag before SSE/DB emit** (`const { judge_pending: _drop, ...rest } = quality`) so it never leaks downstream.

- **`stripThinkingBlocks(text)`** (`packages/shared/src/llm-profiles.ts`) — removes `<think>`-style reasoning spans and a Gemma orphan-thought prefix, then trims. Called before code/vision/text scoring so reasoning artifacts don't pollute the rubric; it also drives a local `channelTagLeak` check in `apps/server/src/bench-runner.ts` (`stripThinkingBlocks(visibleText) !== visibleText.trim()`) that flags residual `<think>`/`<|channel|>` tags in visible output (the sibling `emptyResponse` check is separate and does not use this helper).

- **LLM-as-judge call** — `runLlmJudge` (`apps/server/src/judge.ts`) POSTs to `https://api.anthropic.com/v1/messages` with `temperature: 0`, `max_tokens: 256`, a 30s abort timeout (`LLM_JUDGE_TIMEOUT_MS`), and **no retries** (`LLM_JUDGE_MAX_RETRIES` is `0`). Model defaults to `DEFAULT_LLM_JUDGE_MODEL` (`"claude-opus-4-7"`), overridable via `LLM_JUDGE_MODEL`; requires `ANTHROPIC_API_KEY`. Vision requests prepend a base64 `image` block; the judge is asked to reply JSON-only and the first JSON object is parsed out via `extractFirstJsonObject`.

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

- **Reusable pattern.** Keep a cheap deterministic prefilter as the default path and treat the LLM judge as an opt-in, fail-soft overlay: provisional-score + a `*_pending` flag, a hard env gate, a bounded single call (temp 0, timeout, no retry), and an explicit "capped/uncovered" caveat surfaced in aggregate scores (`packages/shared/src/scoring/quality-score.ts`) rather than silently dropped. See `/profile` and `README.md` for the full rubric catalog.

## 10. Run persistence & regression detection

**Reference.** Bench runs are persisted to a local SQLite file (Node's built-in `node:sqlite`[^node-sqlite] `DatabaseSync`, no external driver) so that history, scoreboards, and A/B comparison survive process restarts. A single connection is opened lazily and cached for the process lifetime; if the file can't be opened the harness degrades gracefully (history/persistence disabled, benchmarks still run). Live streaming events are folded into rows incrementally by a small state machine (`start` → `onEvent` → `finalize`), and regression detection is a **pure function** over two persisted run details, so it can be reused server-side or in tests without a DB. The reusable pattern: keep write helpers thin and typed per table, treat the DB as optional, and make the diff logic side-effect-free and threshold-driven.

### SQLite persistence

- Connection setup lives in `apps/server/src/db/database.ts`: `openBenchDatabase()` does `mkdirSync` on the parent dir, then `PRAGMA journal_mode = WAL` + `PRAGMA foreign_keys = ON`, then runs `migrate()`. On graceful shutdown, `closeProdBenchDatabase()` runs `PRAGMA wal_checkpoint(TRUNCATE)` before `db.close()`.
- Schema is idempotent: every table is `CREATE TABLE IF NOT EXISTS`, plus `schema_migrations` version rows and a single best-effort `ALTER TABLE bench_scenarios ADD COLUMN prompt_system_preview` guard (checked via `PRAGMA table_info`). All child tables use `FOREIGN KEY (run_id) ... ON DELETE CASCADE`, so deleting a run cleans up scenarios/logs/stages.
- Query-helper files under `apps/server/src/db/` (exact names):

| File | Role |
| --- | --- |
| `apps/server/src/db/database.ts` | Connection open/close/cache, `migrate()`, all row insert/upsert/finish/list helpers (`insertRun`, `upsertScenarioAggregate`, `finishRun`, `latestFinishedRunsByModels`, …) |
| `apps/server/src/db/run-queries.ts` | Read-side reconstruction: `benchResultFromDb()` / `benchResultDetailFromDb()` rehydrate a run (meta + per-scenario `runs` + prompt previews) |
| `apps/server/src/db/persist-stream.ts` | `BenchRunPersistence` — folds `StreamEvent`s into `bench_*` rows during a live bench |
| `apps/server/src/db/stress-persist-stream.ts` | `StressRunPersistence` — same pattern for stress runs (`stress_runs` / `stress_stages`) |

- Tables created by `migrate()` in `database.ts`:

| Table | Grain | Key columns |
| --- | --- | --- |
| `bench_runs` | one row per run | `run_id` PK, `status` (`running`/`ok`/`partial`/`error`), `meta_json`, `error_code`/`error_message` |
| `bench_scenarios` | run × scenario × route | PK `(run_id, scenario_id, api_route)`, `aggregate_json`, `prompt_preview`, `prompt_system_preview` |
| `bench_text_logs` | append-only log lines | PK `(run_id, seq)`, `ts`, `line` (truncated to 4000 chars) |
| `stress_runs` / `stress_stages` | stress run / per-concurrency stage | `stress_stages` PK `(run_id, stage_index)` |
| `custom_scenarios` | user-defined scenario defs | `id` PK, `def_json`, upserted |
| `schema_migrations` | version ledger | monotonically inserted `version` rows |

- Two write patterns worth copying: `upsertScenarioAggregate()` uses `ON CONFLICT ... DO UPDATE` with `COALESCE(excluded.x, bench_scenarios.x)` so a later event never nulls out an earlier prompt preview; `finishRun()` also `COALESCE`s `error_code`/`error_message` so a mid-run `markRunErrorPartial()` cause isn't erased at run end.

### persist-stream lifecycle (start → onEvent → finalize)

`BenchRunPersistence` (in `apps/server/src/db/persist-stream.ts`) is constructed with `DatabaseSync | null` — every method early-returns when the DB is absent, so callers never branch on persistence being enabled.

```ts
class BenchRunPersistence {
  constructor(private readonly db: DatabaseSync | null) {}
  start(meta: BenchRunMeta): void;   // INSERT bench_runs, status="running"
  onEvent(ev: StreamEvent): void;    // fold each event into rows + text log
  finalize(): void;                  // finishRun(status = hadError ? "partial" : "ok")
}
```

- `start(meta)` calls `insertRun()` with `status: "running"` (normalizing `base_url` by stripping trailing slashes via `meta.base_url.replace(/\/+$/, "")`) and resets in-memory state (`logSeq`, prompt caches, `hadError`).
- `onEvent(ev)` switches on `ev.type`:
  - `scenario_start` → caches `user_prompt` / `system_prompt` keyed by `` `${scenario_id}|${api_route}` `` (only for `chat_completions` / `messages`) so the later aggregate row gets the real dynamic prompt.
  - `metrics_update` → `upsertScenarioAggregate()` writing `aggregate_json = JSON.stringify(agg)` plus the cached (or static fallback) prompt previews.
  - `error` → sets `hadError = true` and `markRunErrorPartial()` (flips `running` → `partial`, records code/message).
  - `contention_summary` / `preflight_memory_fit` → `updateRunMetaJson()` shallow-merges the event (minus `type`) into `meta_json`, since these are only known once the run is underway.
  - Most events also append a human-readable line via `appendTextLog()`.
- `finalize()` calls `finishRun()` with `partial` if any error was seen, else `ok`, then clears state. Note the method is named `finalize()`, not `finish()`.

### Regression comparison (`/api/v1/compare`)

The route (`app.get(\`${prefix}/compare\`)` in `apps/server/src/catalog-routes.ts`, mounted on both `/api` and `/api/v1`) accepts either `runA`&`runB` or `modelA`&`modelB`&`baseUrl` (latest finished run per model via `latestFinishedRunsByModels()`), rehydrates both sides with `benchResultDetailFromDb()`, and calls the pure `computeCompare()` from `packages/shared/src/scoring/compare.ts`. Threshold overrides arrive as query params and are parsed leniently (`numQ`/`boolQ`).

- Runs are joined by `` `${id} ${api_route}` `` (the `joinKey` helper); only scenarios present with `runs.length > 0` on **both** sides are compared. Each side is reduced to `SideMetrics` and every metric is emitted as a `MetricDelta`:

```ts
type MetricDelta = { a: number|null; b: number|null; delta: number|null; pct: number|null };
// delta = b - a  (null if either side null); pct = (b - a) / a (null if a is 0/null)
```

- Per-scenario deltas emitted: `ttft_p50`, `ttft_p95` (nearest-rank percentiles), `tps_per_user` (mean of per-run TPS), `tps_aggregate` (Σtokens / Σseconds), `quality` (mean score), `empty_turn_rate`, `channel_tag_leak`.
- Regression signal types (`RegressionKind`) and the exact rules — direction matters, and note TPS uses the **aggregate** metric while TTFT uses **p95 only**:

| `RegressionKind` | Threshold key (default) | Fires when |
| --- | --- | --- |
| `quality_drop` | `qualityDropAbs` (0.05) | `a.quality - b.quality > qualityDropAbs` (absolute drop) |
| `tps_regression` | `tpsRegressionPct` (0.15) | `b.tps_aggregate < a.tps_aggregate * (1 - tpsRegressionPct)` |
| `ttft_regression` | `ttftRegressionPct` (0.25) | `b.ttft_p95 > a.ttft_p95 * (1 + ttftRegressionPct)` |
| `new_empty_turns` | `flagNewEmptyTurns` (true) | `a.empty_turn_rate === 0 && b.empty_turn_rate > 0` |

- A scenario's `regression` boolean is `regressions.length > 0`; the top-level `summary` rolls up `regression`, the union `regressions`, `scenarios_regressed`, and `scenarios_compared`. Defaults are declared once on `CompareThresholdsSchema` (Zod `.default(...)`) and applied via `CompareThresholdsSchema.parse(thresholdsInput ?? {})`, so an empty override object still yields the canonical thresholds — a clean way to keep API defaults and validation in one place.

## 11. Provider Gotchas

When you drive a local **LM Studio** backend, two failure modes can silently poison scores without ever throwing an HTTP error, and both depend on the specific app build / GGUF template rather than on your harness. Treat the two docs below as canonical: keep them as the single source of truth and link to them rather than duplicating their content, because the version timelines and root-cause analysis drift as LM Studio ships new engine builds. In-app, every affected result row is marked with a `⚠` badge in `apps/web/src/components/ResultsTable.tsx`; the badge tooltip tells the operator to open the row, and the row's detail drawer (`apps/web/src/components/ScenarioDetailDrawer.tsx`) plus the table legend carry the deep-link to `/profile#lmstudio-host` for operator-facing remediation. The reusable pattern here is **annotate-only detection**: flag the corruption on the run record, keep the pass/fail verdict untouched, and route the human to a versioned fix page.

- **Engine-protocol regressions (tool-arg corruption + reasoning leak).** Symptom: with *"Use LM Studio Engine Protocol"* on (builds ~0.4.14–0.4.18), streamed `tool_calls[].function.arguments` come back concatenated like `{}{}{}`[^lms-1922] so downstream `JSON.parse` fails and tool scenarios score a silent 0; separately, reasoning replays into the response `content` instead of `reasoning_content` and pollutes graded text. Workaround: pin LM Studio **0.4.19+** (both fixed) or turn the option off. Detected as the `⚠` badges **`tool_call_args_corrupted`** and **`reasoning_leaked_into_content`**. Doc: [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) · in-app: `/profile#lmstudio-host`.
- **Jinja template crashes (Anthropic `/v1/messages` + `tools`).** Symptom: only on the Anthropic messages route with tools, the model's built-in Jinja `chat_template` renders against an OpenAI-shaped assumption, hits an `UndefinedValue`, and the run finishes empty (`Response finished but empty`); the same model's OpenAI `/v1/chat/completions` route often renders fine. Workaround: re-download a fixed GGUF and/or update LM Studio, or apply the host-side template-override scripts (`scripts/fix-nemotron-lmstudio-template.sh`, `scripts/fix-gemma4-lmstudio-template.sh`, run with `--dry-run` first). Doc: [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) · in-app: `/profile#lmstudio-host`.

The two badges map to distinct detection sites, so keep them separate when you reuse the pattern:

| Badge flag | Emitted at | Signature it catches |
|---|---|---|
| `tool_call_args_corrupted` | `apps/server/src/bench-runner.ts` (aggregated from the `toolCallArgsCorrupted` metric computed during stream merge in `apps/server/src/openai-stream.ts`) | Merged tool-call arguments where a complete JSON is followed by another (`{}{}`) |
| `reasoning_leaked_into_content` | `apps/server/src/bench-runner.ts` | On the `chat_completions` route, thinking-block markers survive in `content` when the separate reasoning channel is empty |

Both flags are optional booleans on the run schema in `packages/shared/src/index.ts` (each declared `z.boolean().optional()`), and `apps/web/src/components/ResultsTable.tsx` renders the `⚠` next to the scenario when either is set:

```ts
// apps/web/src/components/ResultsTable.tsx
const corrupted = r.tool_call_args_corrupted === true;
// channel_tag_leak_detected is the generalized (route-agnostic) signal;
// fall back to the legacy reasoning_leaked_into_content for older runs.
const leaked =
  r.channel_tag_leak_detected === true ||
  r.reasoning_leaked_into_content === true;
```

Reusable takeaway: when a provider can corrupt output while still returning `200 OK`, **annotate the run instead of failing it** — attach a named boolean per signature, leave scoring intact, badge it in the results UI, and point the operator at a single versioned remediation page (here `/profile#lmstudio-host`) so they fix the environment rather than the harness.

## 12. How to reuse (checklist)

**Reference (for engineers of other projects).** Each technique in this harness lives behind one small, mostly-pure entry module you can lift in isolation — most take a `fetchImpl` and/or a `signal`, return plain data or an `AsyncGenerator`, and avoid framework glue. Use the "want X? start here" map below to jump straight to the file and the exported symbol that carries the pattern, read that one function's signature and doc-comment first, then follow its imports only if you need the collaborators. The streaming, detection, and compare cores have no dependency on the HTTP layer or SQLite, so they port cleanly into a different server or a CLI.

- Most entry functions take `fetchImpl?: typeof fetch` (for test injection / proxy swapping) and `signal?: AbortSignal` (for cancellation).
- The streaming, aggregation, and compare cores are pure logic independent of HTTP routing and SQLite, so they port directly to another server or CLI.
- `performance.now()`-based timing is anchored to the "HTTP send moment" by passing `requestStartedAt` (capture this value on the outside to include retries and queue wait).

| Want this… | Start here (repo-relative) | Entry symbol |
|---|---|---|
| Streaming metrics (TTFT/TPS, tool-call merge, truncation/loop flags) | `apps/server/src/openai-stream.ts` (Anthropic twin: `apps/server/src/anthropic-stream.ts`) | `consumeOpenAiChatStream()` |
| Provider abstraction (auto-detect + capability probe) | `apps/server/src/detect.ts` | `detectProvider()` |
| Contention guard (don't benchmark a busy GPU) | `apps/server/src/contention-probe.ts` | `makeContentionProbe()`, `runIdleGate()` |
| Load/stress ramp (concurrency sweep, backpressured event stream) | `apps/server/src/stress-runner.ts` | `runStress()` |
| Multi-turn agent loop (mock-tool harness, per-turn metrics) | `apps/server/src/agent-loop.ts` | `runAgentLoopOpenAi()` / `runAgentLoopAnthropic()` |
| Persistence + regression diff | `apps/server/src/db/` + `packages/shared/src/scoring/compare.ts` | `tryOpenProdBenchDatabase()`, `BenchRunPersistence`, `computeCompare()` |

**Streaming metrics — `openai-stream.ts`.** Copy `consumeOpenAiChatStream` for a single SSE reader that yields one flat metrics object; the doc-comments on each field are the spec.

```ts
export async function consumeOpenAiChatStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
  opts?: { onDelta?: (d: OpenAiStreamDelta) => void; loopGuard?: boolean; requestStartedAt?: number },
): Promise<OpenAiStreamMetrics>; // { ttftMs, totalMs, text, assistantText, reasoningText, toolCalls,
                                 //   streamCompleted, approxOutputTokens, usageOutputTokens, finishReason,
                                 //   repetitionLoopDetected, toolCallArgsCorrupted }
```

- TTFT is stamped by `markTtft()` on the **first** content / `reasoning_content` / tool-call delta, relative to `requestStartedAt ?? performance.now()`.
- The stream returns two token counts: `usageOutputTokens` — provider usage from `usage.completion_tokens` (else `usage.output_tokens`), which needs `stream_options.include_usage`, otherwise `null` — and `approxOutputTokens`, an always-computed `text.length / 4` estimate. Callers prefer usage and fall back to the `/ 4` approximation, so TPS is honest about its source (`tps_source: "usage" | "approx"`).
- Annotate-only signals (`finishReason === "length"` for truncation, `toolCallArgsCorrupted` for the concatenated-`{}{}` runtime bug) never change scoring; they just label results.

**Provider abstraction — `detect.ts`.** `detectProvider(rawBaseUrl, opts)` normalizes the base URL, then probes native list endpoints in order (LM Studio `/api/v1/models` → Ollama `/api/tags` → OpenAI `/v1/models`). LM Studio and Ollama hits get fixed `capabilities` (`LM_STUDIO_COMPAT_CAPS` / `OLLAMA_COMPAT_CAPS`); the OpenAI-compatible and `manual` fall-throughs call `probeCapabilities`, which POSTs a throwaway `probe-model` to `/v1/chat/completions` and `/v1/messages`. The returned `capabilities: { openaiChat, anthropicMessages }` is what every downstream runner uses to pick a route (`pickRoute()` in `stress-runner.ts`, `resolveBenchApiRoutes()` in the bench runner), so you get one detection result instead of scattered per-call branching.

- The route-availability heuristic `routeLikelyAvailable(status, body)` treats a bad-model `4xx` (or `404` with a JSON body) as "route exists" — steal it to tell "endpoint absent" apart from "endpoint present, my request was wrong".

**Contention guard — `contention-probe.ts`.** The reusable idea is two **separate sampling modes** so your own load doesn't read as contention: `sampleIdle()` (call only when you have nothing in flight; trusts GPU util + `/metrics` + `lms ps`) vs `sampleInFlight(baseline)` (during your request; ignores GPU noise, watches `running>=2 / waiting>=1`, model-load churn, and Ollama `expires_at` advance). Drive it with `runIdleGate()`, an `AsyncGenerator<StreamEvent, GateResult>` that waits for `requiredConsecutiveIdle` clean polls before proceeding, and `startInflightMonitor()` for background detection. `parsePrometheusRunningWaiting()` is a standalone vLLM/llama.cpp/TGI gauge parser you can grab on its own.

**Load/stress ramp — `stress-runner.ts`.** `runStress()` sweeps concurrency from `ramp.start` to `ramp.max` by `ramp.step`, running `concurrency` workers that re-fire requests until `durationMs` elapses. Worth copying: a bounded producer/consumer queue (`QUEUE_HIGH_WATER = 256` with `awaitDrainIfFull`) that streams per-request events without unbounded memory, plus the **reliability gate** — `tps_unreliable` is set (and `aggregate_tps` nulled) when a stage has `< 5` successes, ran `< 3000ms`, or had zero successes.

**Multi-turn agent loop — `agent-loop.ts`.** A mock-tool harness that feeds canned tool results (`pullMock`, with optional `argDispatch` for opaque-id fidelity) so you can measure multi-turn failure modes a single shot hides. The route-neutral core `stepAgentLoop(turn, def, loop, state, cursor, maxTokens)` is pure (no I/O; folds each turn into the passed-in `state`), and `finalize()` renders that `state` into `AgentLoopMetrics` — `empty_turn_count`, `valid_tool_call_rate`, `intermediate_turn_leak`, `thinking_exhausted_budget`, `tool_arg_hits`/`tool_arg_attempts`, `final_turn_output_tokens`, `completion_reason` — reusable independent of transport.

**Persistence + regression — `db/` + `compare.ts`.** `tryOpenProdBenchDatabase()` opens `node:sqlite` (`DatabaseSync`, WAL, FK on) and returns `null` instead of throwing when the file is unopenable, so the bench keeps running with history disabled; `BenchRunPersistence` / `StressRunPersistence` consume the same SSE event stream (`start`/`onEvent`/`finalize`) and write it through. For regression gating, `computeCompare()` is a pure `(detailA, detailB, thresholds) => CompareResponse` that joins by `(scenario, api_route)` and emits per-scenario deltas.

```ts
export const CompareThresholdsSchema = z.object({
  qualityDropAbs:    z.number().default(0.05),  // abs quality drop → regression
  tpsRegressionPct:  z.number().default(0.15),  // aggregate TPS drop fraction
  ttftRegressionPct: z.number().default(0.25),  // TTFT p95 increase fraction
  flagNewEmptyTurns: z.boolean().default(true), // empty turns newly appearing in B
});
```

- Wire it into CI headlessly via the `llm-bench-compare` CLI (`apps/mcp/src/compare-cli.ts`, `--fail-on-regression` / `--webhook`); the thresholds are Zod-validated so callers can override any subset.

---

## Appendix A. Glossary

Terms used across this document, grouped by the section that explains them in depth. Code identifiers stay in English; each group heading links back to its main section.

### Metrics — [§3](#3-streaming-metrics-extraction)

| Term | Definition |
|---|---|
| TTFT | Time To First Token — ms from request send to the first content / `reasoning_content` / tool-call delta. |
| TPS | Tokens Per Second — output tokens ÷ elapsed. `aggregate_tps` sums a stage; `tps_per_user` = aggregate ÷ concurrency. |
| `approxOutputTokens` | Fallback token estimate (~len/4) used when the server omits a usage count. |
| p50 / p95 | Median / 95th-percentile latency (or TTFT) within a stage. |
| warmup vs measured | Warmup runs prime caches and are discarded; measured runs feed metrics. |
| truncation | Output cut at the token cap — `finish_reason:"length"` (OpenAI) / `stop_reason:"max_tokens"` (Anthropic). |

### Orchestration — [§1](#1-architecture--event-model)

| Term | Definition |
|---|---|
| SSE | Server-Sent Events — one-way `text/event-stream` of `data:` frames. |
| `AsyncGenerator` event model | `runBench` *yields* typed events; each consumer chooses its own transport. |
| discriminated union | `StreamEvent` union keyed on `type` for exhaustive narrowing. |
| persist-stream lifecycle | `start → onEvent → finalize` folds live events into DB rows. |

### Provider — [§2](#2-multi-provider-abstraction) · [§5](#5-provider-loadunload--ttl)

| Term | Definition |
|---|---|
| `ProviderKind` | `lm_studio` / `ollama` / `openai_compatible` / `manual`. |
| capability | `{ openaiChat, anthropicMessages }` — which wire routes a server supports. |
| API route | `chat_completions` (OpenAI) or `messages` (Anthropic). |
| TTL / `keep_alive` | Bounded model residency — LM Studio load `ttl` (seconds) vs Ollama `keep_alive`. |
| preload | A native-API call that loads a model before measuring. |
| resident instance | A model already loaded in the backend (`lmStudioResidentInstances`). |
| memory-fit preflight | Predicts RAM fit before load to avoid OOM (`FitPolicy`). |

### Guards — [§4](#4-memory-fit-preflight--oom-guard) · [§6](#6-contention--pollution-guard)

| Term | Definition |
|---|---|
| contention / pollution | Foreign concurrent inference that inflates TTFT and depresses TPS. |
| idle gate | `pre_bench` / `between_iterations` / in-flight phases requiring N consecutive idle polls. |
| `sampleIdle` vs `sampleInFlight` | Two sampling modes so our own load is not misread as contention. |
| repetition loop | Runaway repeated output, detected and aborted. |
| tool-arg corruption | Streamed tool arguments concatenated like `{}{}{}` (LM Studio engine bug). |
| reasoning leak | Reasoning replayed into the visible `content` channel. |

### Stress & Agent — [§7](#7-stress-ramp--backpressure) · [§8](#8-multi-turn-agent-loop-harness)

| Term | Definition |
|---|---|
| ramp | Concurrency sweep `start → max` by `step`, each held for `durationMs`. |
| worker pool | N concurrent workers re-firing requests within a stage. |
| backpressure | Bounded producer/consumer queue (`QUEUE_HIGH_WATER`, `awaitDrainIfFull`). |
| `tps_unreliable` | Stage flagged (and `aggregate_tps` nulled) on <5 successes, <3s, or 0 output. |
| agent loop / mock tool | Multi-turn loop fed canned tool results to expose failures a single shot hides. |
| empty turn | A turn that produced no visible content. |
| stall vs `budget_exhausted` | Loop end reason — no progress vs token budget used up. |
| thinking / reasoning channel | The separate reasoning stream, kept apart from visible content. |

### Scoring & Regression — [§9](#9-quality-scoring--llm-as-judge) · [§10](#10-run-persistence--regression-detection)

| Term | Definition |
|---|---|
| rubric | Score scale `0 / 0.33 / 0.67 / 1`; pass is `score >= 0.67`. |
| prefilter | Deterministic checks (empty/regex/JSON-shape/script) run before any judge. |
| LLM-as-judge | Optional Anthropic-Messages grading, gated by `LLM_JUDGE_ENABLED`. |
| `stripThinkingBlocks` | Removes inline reasoning before grading and UI display. |
| regression thresholds | `qualityDropAbs` · `tpsRegressionPct` · `ttftRegressionPct` · `flagNewEmptyTurns`. |
| WAL | SQLite write-ahead logging mode used by the run DB. |

## Appendix B. References

External sources are cited as footnotes at the exact spots they back up in the body; they collect into the numbered list at the end of this page (each with a `↩` back-link). Internal references are listed below.

- [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) — Canonical diagnosis and remediation for LM Studio engine-protocol regressions (tool-arg corruption, reasoning leak).
- [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) — Jinja template crashes on the Anthropic `/v1/messages` + tools route, and template overrides.
- [`LLM_PROFILE.md`](LLM_PROFILE.md) — Per-model-family sampling, context, and runtime rules.
- [`README.md`](README.md) — Project overview and the "Harness Know-How" section.
- Web UI: `/profile` (per-family rules, `#lmstudio-host` host setup) · `/scenarios` (scenario catalog) tabs.

[^mcp-spec]: [Model Context Protocol — Specification](https://modelcontextprotocol.io/specification) — Tool and transport spec exposed by the MCP server (`apps/mcp`).
[^oai-compat]: [LM Studio — OpenAI-compatible Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) — `/v1/chat/completions` SSE delta (`choices[].delta`) format. (OpenAI's official docs block bot access, so this verifiable compatible spec is used instead.)
[^anthropic-stream]: [Anthropic — Messages streaming](https://docs.anthropic.com/en/api/messages-streaming) — `/v1/messages` SSE event (`content_block_delta` / `thinking_delta` / `message_delta`) format.
[^lms-rest]: [LM Studio — REST API](https://lmstudio.ai/docs/developer/rest) — Model load/unload and specifying `ttl` (seconds) at load time.
[^ollama-api]: [Ollama — API](https://docs.ollama.com/api) — Setting model residency time via `keep_alive` (native `/api/generate` / `/api/chat`).
[^vllm-metrics]: [vLLM — Production metrics](https://docs.vllm.ai/en/latest/usage/metrics.html) — `vllm:num_requests_running` / `num_requests_waiting` gauges.
[^llamacpp-server]: [llama.cpp — server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — `/metrics` Prometheus exposition (request-processing gauges).
[^tgi-metrics]: [Hugging Face TGI — Metrics](https://huggingface.co/docs/text-generation-inference/en/reference/metrics) — Batch and queue gauges.
[^prometheus-fmt]: [Prometheus — Exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) — `/metrics` text parsing format.
[^node-sqlite]: [Node.js — `node:sqlite`](https://nodejs.org/api/sqlite.html) — Built-in `DatabaseSync` with no external driver.
[^lms-1922]: [LM Studio bug-tracker #1922](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1922) — Streaming `tool_calls` argument corruption in the engine-protocol runtime.
