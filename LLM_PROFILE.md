# LLM_PROFILE (모델별 파라미터·수치)

웹 UI 상세: `/profile` · `/profile#thinking-block-strip` · `/profile#lmstudio-host`

## 사고 블록 인식·제거

단일 출처: `packages/shared/src/llm-profiles.ts`의 `stripThinkingBlocks` / `partitionThinkingBlocks`.

| 인라인 패턴 | 대표 모델 |
|-------------|-----------|
| `<think>…</think>` | Qwen 3.5/3.6/3.8 |
| 시작부 `…</think>` (여는 태그 없음) | GLM-4.7-Flash, Nemotron 30B |
| `<\|think\|>…<\|end_of_thought\|>` 등 | Qwen think 토큰 |
| `<\|channel>thought\n…<channel\|>` | Gemma 4 (공식, QAT 포함) |
| `<\|channel\|>thought…<channel\|>` | LM Studio 변형 |
| `<\|channel>thought\n` 접두 (닫는 태그 없음) | Gemma 4 사고 OFF — 2차 peel |

`reasoning_content` / `thinking_delta` / MiniMax `reasoning_split`는 스트림에서 추론을 분리합니다. 위 regex는 `chat_completions` 합본·파서 미설정 시 폴백입니다.

LM Studio 호스트(Reasoning Parsing·템플릿 스크립트): `/profile#lmstudio-host` 참고.

---

## gemma4

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 |
| contextRecommendedStart | 32768 |
| recommendedMaxTokens.default | 4096 |
| recommendedMaxTokens.complex | 8192 |
| promptRules.gemmaThinkToken | true |
| promptRules.stripThinkingFromAssistantHistory | true |

thinkingIntent `off` 시 `extra_body` (LM Studio/vLLM이 `chat_template_kwargs` 전달 시):

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

런타임: 사고 ON 시 system 앞 `<|think|>`. 채널 `<|channel>thought\n` … `<channel|>`. LM Studio 설정은 `/profile#lmstudio-host`.

| preset | temperature | top_p | top_k |
|--------|---------------|-------|-------|
| default | 1.0 | 0.95 | 64 |
| thinking_general | 1.0 | 0.95 | 64 |
| thinking_coding | 1.0 | 0.95 | 64 |
| nonthinking_general | 1.0 | 0.95 | 64 |
| tool_call | 1.0 | 0.95 | 64 |

---

## qwen3.5

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 |
| contextRecommendedStart | 131072 |
| recommendedMaxTokens.default | 32768 |
| recommendedMaxTokens.complex | 81920 |
| promptRules.stripThinkingFromAssistantHistory | true |

thinkingIntent `off` 시 `extra_body`:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

| preset | temperature | top_p | top_k | min_p | presence_penalty | repetition_penalty |
|--------|---------------|-------|-------|-------|-------------------|---------------------|
| default | 1.0 | 0.95 | 20 | 0.0 | 1.5 | 1.0 |
| thinking_general | 1.0 | 0.95 | 20 | 0.0 | 1.5 | 1.0 |
| thinking_coding | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |
| nonthinking_general | 0.7 | 0.8 | 20 | 0.0 | 1.5 | 1.0 |
| tool_call | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |

---

## qwen3.6

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 |
| contextRecommendedStart | 131072 |
| recommendedMaxTokens.default | 32768 |
| recommendedMaxTokens.complex | 81920 |
| promptRules.stripThinkingFromAssistantHistory | true |

thinkingIntent `off` 시 `extra_body`:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

preserveThinking `true` 시 `extra_body`에 추가:

```json
{"chat_template_kwargs":{"preserve_thinking":true}}
```

| preset | temperature | top_p | top_k | min_p | presence_penalty | repetition_penalty |
|--------|---------------|-------|-------|-------|-------------------|---------------------|
| default | 1.0 | 0.95 | 20 | 0.0 | 1.5 | 1.0 |
| thinking_general | 1.0 | 0.95 | 20 | 0.0 | 1.5 | 1.0 |
| thinking_coding | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |
| nonthinking_general | 0.7 | 0.8 | 20 | 0.0 | 1.5 | 1.0 |
| tool_call | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |

---

## qwen3.8

`Qwen3.8` 정확 매칭 외에, **아직 정의가 없는 Qwen 신버전**(`qwen3.9`·`qwen4`·`qwen4.1` 등)도 `fallbackMatch`로 이 정의에 폴백합니다. 구버전(`Qwen3-8B`·`Qwen2.5`·`Qwen-7B`)은 대상이 아닙니다 — 대시 뒤 파라미터 수를 버전으로 오인하지 않도록 구분자 없이 붙는 숫자만 버전으로 봅니다. 폴백으로 해석돼도 `profile_id`는 `qwen38`로 기록됩니다.

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 (YaRN로 ~1000000) |
| contextRecommendedStart | 131072 |
| recommendedMaxTokens.default | 131072 |
| recommendedMaxTokens.complex | 81920 (모델카드 값은 262144 — 런타임 기본값으로는 쓰지 않음, #144) |
| reasoning_effort (미지정 시) | low |
| promptRules.stripThinkingFromAssistantHistory | true |
| 모달리티 | 텍스트 + 이미지 + 영상 (27B 네이티브 멀티모달) |

`reasoning_effort`는 **두 경로 모두**(최상위 필드 + `chat_template_kwargs`)에 실립니다. 어느 경로가 실제로 읽히는지는 백엔드 종류가 아니라 **빌드/임베드 템플릿에 달려 있습니다** — MLX에서는 최상위 필드가 먹고 템플릿 kwargs가 무효인 실측이 있는 반면, 같은 스택의 다른 GGUF 빌드에서는 정반대이거나 어느 경로도 안 먹는 사례가 관측됐습니다(#144·#182). 하네스는 어느 쪽이 유효한지 알 수 없으므로 두 경로 모두 방어적으로(belt-and-suspenders) 보냅니다. **모델카드 기본은 `xhigh`**지만 간단한 질문에도 사고 토큰이 2만+로 폭주해 타임아웃·오염 가드 재시도를 유발하므로 하네스 기본은 `low`입니다.

> ⚠️ **공식 `chat_template.jinja`가 받는 값은 `xhigh` · `medium` · `low` 뿐입니다.** 그 외 값이 오면 템플릿이 곧바로 예외를 던져 프롬프트 렌더링 자체가 실패합니다.
>
> ```jinja
> {%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
> {{ raise_exception('Unexpected reasoning effort ... Supported types are xhigh (default), medium, and low.') }}
> ```
>
> 그래서 `resolveBenchProfile`이 템플릿에 싣기 전에 `qwen38TemplateEffort`로 클램프합니다 — `high`·`max` → `xhigh`, `minimal` → `low`, 미지정·`none` → `low`. 사고 끄기는 effort가 아니라 `enable_thinking`으로 표현합니다.

```json
{"reasoning_effort":"low","chat_template_kwargs":{"reasoning_effort":"low","preserve_thinking":false}}
```

thinkingIntent `off` 시 — 최상위 `reasoning_effort`는 `"none"`(Ollama가 think=false로 읽음), **템플릿에는 effort를 싣지 않습니다**(공식 템플릿이 거부):

```json
{"chat_template_kwargs":{"enable_thinking":false,"preserve_thinking":false}}
```

`preserve_thinking`은 템플릿 기본이 `true`(미지정 시)라, 끄려면 `false`를 명시해야 합니다 — 항상 명시적 boolean으로 보냅니다:

```json
{"chat_template_kwargs":{"preserve_thinking":true}}
```

| 항목 | 확인된 값 (공식 `tokenizer_config.json` / `chat_template.jinja` 실측) |
|------|------|
| eos_token | `<\|im_end\|>` — `stopSequences` 근거 |
| 사고 블록 | `<think>\n` … `\n</think>` — 기존 strip 패턴이 커버 |
| reasoning_effort 허용값 | `xhigh` · `medium` · `low` (그 외 `raise_exception`) |
| enable_thinking | 템플릿이 직접 분기 (`is false` 경로 존재) |
| preserve_thinking | 미지정 시 `true` |

### qwen3.8 실측 (LM Studio · Qwen3.8-27B · 5개 런: bf16 · q4_k_xl · q8_k_xl · unsloth q8_0 + 초기 런)

- **템플릿 렌더 실패 0건** — **템플릿 오버라이드를 적용하지 않은 스톡 상태**에서의 측정입니다. 도구 시나리오의 Anthropic `messages` 라우트 — gemma-4·nemotron이 깨지는 바로 그 경로 — 도 정상 렌더됐고, 하드 실패(`stream_completed=false`)도 0건. 즉 패치해서 고쳐진 게 아니라 **애초에 [템플릿 교체](docs/chat-template-override.md)가 필요 없습니다.**
- **실행 시간이 깁니다.** `reasoning_effort: low`에서도 `chat_completions` 단일 시나리오가 최장 **약 15분(894초)**, 런 전체 115~175분이었습니다. 지배 항은 `max_tokens` 자체가 아니라 사고량·양자화 대역폭입니다(#144·#182) — 같은 effort를 보내도 GGUF 빌드별로 실제 사고량이 최대 4.3배 갈리는 사례가 관측됐습니다(#182). 더 짧게 돌려야 하면 UI `max_tokens`를 낮추세요.
- **`agent_loop_chain_v1`이 `stall`로 일관 재현되던 문제는 프롬프트 모호성이 원인이었고 수정됐습니다(#143)** — 예산이 아니라, 모델이 실제 조회 주제를 몰라 되물어야 한다고 오판하는 구조였습니다. `agent_loop` 시나리오는 애초에 UI `max_tokens`로 짧게 만들 수 없습니다 — per-turn 예산은 시나리오 자체가 정하고 request > scenario > profile 순으로 해석되어 UI 값보다 항상 우선합니다.
- 참고: `messages` 라우트의 `reasoning_chars`가 0인 것은 Qwen3.8 고유 현상이 아니라 **모든 모델 공통**(라우트 차원 특성)입니다.
- **같은 `reasoning_effort`를 보내도 GGUF 빌드별로 실제 사고량이 최대 4.3배까지 갈립니다(#182).** `max_tokens=262144`·`reasoning_effort=low`·`temperature=1`·`profile=qwen38/thinking_general`로 전부 고정한 6개 런의 `chat_completions` 평균 `reasoning_chars`가 863~3,722자로 관측됐고, 양자화 등급과 단조 관계가 아니었습니다(같은 Q4_K_M 두 빌드가 양 끝에 위치). effort가 실제로 템플릿에 반영되는지는 하네스가 보장할 수 없는 빌드별 성질이라, 벤치가 재는 것이 "지정한 effort에서의 성능"이 아니라 "각 빌드 템플릿 기본값에서의 성능"일 수 있습니다. `usage.completion_tokens_details.reasoning_tokens`(#182에서 적재 시작)를 지정 effort와 대조하면 사후에 감지할 수 있습니다.

> **max_tokens 주의**: 위 표의 `recommendedMaxTokens.complex`는 모델카드 원값(262144)이 아니라 런타임 기본값(81920)입니다 — 모델카드 값을 그대로 쓴다고 성능이 개선되지 않고 `messages` 라우트의 `thinking.budget_tokens`만 커지기 때문입니다(#144). 실제 요청 `max_tokens`는 **`request > scenario > profile > max(vision floor, recommended)`** 순으로 해석됩니다(`resolveEffectiveMaxTokens`, `packages/shared/src/max-tokens.ts`) — 시나리오 자체가 상한을 정의하면(agent_loop 등) UI 값도 그걸 못 덮습니다. 컨텍스트를 더 짧게 띄운 백엔드(vLLM `--max-model-len` 등)에서는 UI `max_tokens`로 명시해 낮추세요.

| preset | temperature | top_p | top_k | min_p | presence_penalty | repetition_penalty |
|--------|---------------|-------|-------|-------|-------------------|---------------------|
| default | 1.0 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |
| thinking_general | 1.0 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |
| thinking_coding | 1.0 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |
| nonthinking_general | 0.7 | 0.8 | 20 | 0.0 | 1.5 | 1.0 |
| tool_call | 1.0 | 0.95 | 20 | 0.0 | 0.0 | 1.0 |

> qwen3.5/3.6과 달리 thinking 계열 `presence_penalty`가 **0.0**입니다(모델카드 기준). Qwen3.8은 코딩/일반 thinking을 구분하지 않아 `thinking_coding`·`tool_call`도 같은 값을 씁니다.

---

## gpt_oss

| 항목 | 값 |
|------|-----|
| contextNativeMax | 131072 |
| contextRecommendedStart | 16384 |
| recommendedMaxTokens.default | 4096 |
| recommendedMaxTokens.complex | 8192 |
| reasoning_effort (미지정 시) | medium |
| promptRules.stripThinkingFromAssistantHistory | false |

| preset | temperature | top_p | top_k | min_p |
|--------|---------------|-------|-------|-------|
| default | 1.0 | 1.0 | 0 | 0.0 |
| thinking_general | 1.0 | 1.0 | 0 | 0.0 |
| thinking_coding | 1.0 | 1.0 | 0 | 0.0 |
| nonthinking_general | 1.0 | 1.0 | 0 | 0.0 |
| tool_call | 1.0 | 1.0 | 0 | 0.0 |

---

## minimax

모델 id에 `minimax`(대소문자 무관)가 포함되면 이 패밀리로 추론됩니다(M2.7 등 MiniMax 전 계열).

| 항목 | 값 |
|------|-----|
| profile version | 2 |
| contextNativeMax | 200000 |
| contextRecommendedStart | 32768 |
| recommendedMaxTokens.default | 4096 |
| recommendedMaxTokens.complex | 8192 |
| promptRules.stripThinkingFromAssistantHistory | false |

| preset | temperature | top_p | top_k | min_p |
|--------|---------------|-------|-------|-------|
| default | 1.0 | 0.95 | 40 | 0.01 |
| thinking_general | 1.0 | 0.95 | 40 | 0.01 |
| thinking_coding | 1.0 | 0.95 | 40 | 0.01 |
| nonthinking_general | 1.0 | 0.95 | 40 | 0.01 |
| tool_call | 1.0 | 0.95 | 40 | 0.01 |

---

## nemotron3

| 항목 | 값 |
|------|-----|
| contextNativeMax | 1000000 |
| contextRecommendedStart | 262144 |
| recommendedMaxTokens.default | 8192 |
| recommendedMaxTokens.complex | 32768 |
| promptRules.stripThinkingFromAssistantHistory | true |

thinkingIntent `off` 시 `extra_body`:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

런타임: Nano 등 인라인 `<think>`. Super/30B는 `reasoning`/`reasoning_content` 분리 + 닫는 태그만 본문 케이스.

| preset | temperature | top_p | top_k |
|--------|---------------|-------|-------|
| default | 0.6 | 0.95 | — |
| thinking_general | 0.6 | 0.95 | — |
| thinking_coding | 0.6 | 0.95 | — |
| nonthinking_general | 0.2 | — | 1 |
| tool_call | 0.6 | 0.95 | — |

---

## qwen3_coder_next

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 |
| contextRecommendedStart | 32768 |
| recommendedMaxTokens.default | 8192 |
| recommendedMaxTokens.complex | 16384 |
| promptRules.stripThinkingFromAssistantHistory | false |

| preset | temperature | top_p | top_k | min_p |
|--------|---------------|-------|-------|-------|
| default | 1.0 | 0.95 | 40 | 0.01 |
| thinking_general | 1.0 | 0.95 | 40 | 0.01 |
| thinking_coding | 1.0 | 0.95 | 40 | 0.01 |
| nonthinking_general | 1.0 | 0.95 | 40 | 0.01 |
| tool_call | 1.0 | 0.95 | 40 | 0.01 |

---

## glm4.7_flash

| 항목 | 값 |
|------|-----|
| contextNativeMax | 202752 |
| contextRecommendedStart | 32768 |
| recommendedMaxTokens.default | 4096 |
| recommendedMaxTokens.complex | 8192 |
| promptRules.stripThinkingFromAssistantHistory | false |

런타임: generation prompt에 여는 `<think>`가 삽입되어 스트림에는 닫는 `</think>`만 올 수 있음 (`stripThinkingBlocks`가 처리).

| preset | temperature | top_p | min_p | repetition_penalty |
|--------|---------------|-------|-------|---------------------|
| default | 1.0 | 0.95 | 0.01 | 1.0 |
| thinking_general | 1.0 | 0.95 | 0.01 | 1.0 |
| thinking_coding | 1.0 | 0.95 | 0.01 | 1.0 |
| nonthinking_general | 1.0 | 0.95 | 0.01 | 1.0 |
| tool_call | 0.7 | 1.0 | 0.01 | 1.0 |

---

## unknown (정의 없음 시 폴백)

`inferLlmProfileFamily`는 2패스입니다 — ① 정의 배열 순서대로 `match` 정규식, ② 그래도 없으면 같은 순서로 `fallbackMatch`. 현재 `fallbackMatch`를 가진 정의는 [`qwen3.8`](#qwen38) 하나뿐이며, **한 계보에서 폴백을 갖는 정의는 최신 하나여야 합니다**(qwen3.9를 추가하면 qwen3.8에서 옮길 것 — `packages/shared/src/llm-profiles.fallback.test.ts`가 보유 목록을 고정합니다). 두 패스 모두 실패했을 때만 아래 값이 쓰입니다.

| 항목 | 값 |
|------|-----|
| recommendedMaxTokens.default | 512 |
| recommendedMaxTokens.complex | 2048 |

| 필드 | 값 |
|------|-----|
| temperature | 0.2 |
| top_p | 1.0 |
