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
| recommendedMaxTokens.complex | 262144 |
| reasoning_effort (미지정 시) | low |
| promptRules.stripThinkingFromAssistantHistory | true |
| 모달리티 | 텍스트 + 이미지 + 영상 (27B 네이티브 멀티모달) |

`reasoning_effort`는 백엔드마다 읽는 위치가 달라 **두 경로 모두**에 실립니다 — 최상위 필드는 Ollama의 OpenAI 호환 라우트가, `chat_template_kwargs`는 LM Studio·llama.cpp가 읽습니다. 단계는 `xhigh` · `medium` · `low` · `none`이며 **모델카드 기본은 `xhigh`**입니다. 간단한 질문에도 사고 토큰이 2만+로 폭주해 타임아웃·오염 가드 재시도를 유발하므로 하네스 기본은 `low`로 낮췄습니다.

```json
{"reasoning_effort":"low","chat_template_kwargs":{"reasoning_effort":"low"}}
```

thinkingIntent `off` 시(최상위 `reasoning_effort`도 `"none"`):

```json
{"chat_template_kwargs":{"enable_thinking":false,"reasoning_effort":"none"}}
```

preserveThinking `true` 시 `chat_template_kwargs`에 병합:

```json
{"chat_template_kwargs":{"preserve_thinking":true}}
```

> **max_tokens 주의**: 위 권장값은 모델카드 그대로(사고 262144 / 최종 응답 131072)입니다. 실제 요청 `max_tokens`는 사용자 값·프로파일 값·비전 floor 중 **최댓값**이 쓰이므로, 컨텍스트를 짧게 띄운 백엔드(vLLM `--max-model-len` 등)에서는 UI `max_tokens`로 명시해 낮추세요. llama.cpp·LM Studio는 대개 컨텍스트에 맞춰 클램프합니다.

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
