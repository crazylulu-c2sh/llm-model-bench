# LLM_PROFILE (모델별 파라미터·수치)

## gemma4

| 항목 | 값 |
|------|-----|
| contextNativeMax | 262144 |
| contextRecommendedStart | 32768 |
| recommendedMaxTokens.default | 4096 |
| recommendedMaxTokens.complex | 8192 |
| promptRules.gemmaThinkToken | true |
| promptRules.stripThinkingFromAssistantHistory | true |

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

| preset | temperature | top_p |
|--------|---------------|-------|
| default | 1.0 | 1.0 |
| thinking_general | 1.0 | 1.0 |
| thinking_coding | 0.6 | 0.95 |
| nonthinking_general | 1.0 | 1.0 |
| tool_call | 0.6 | 0.95 |

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

| preset | temperature | top_p | min_p | repetition_penalty |
|--------|---------------|-------|-------|---------------------|
| default | 1.0 | 0.95 | 0.01 | 1.0 |
| thinking_general | 1.0 | 0.95 | 0.01 | 1.0 |
| thinking_coding | 1.0 | 0.95 | 0.01 | 1.0 |
| nonthinking_general | 1.0 | 0.95 | 0.01 | 1.0 |
| tool_call | 0.7 | 1.0 | 0.01 | 1.0 |

---

## unknown (정의 없음 시 폴백)

| 항목 | 값 |
|------|-----|
| recommendedMaxTokens.default | 512 |
| recommendedMaxTokens.complex | 2048 |

| 필드 | 값 |
|------|-----|
| temperature | 0.2 |
| top_p | 1.0 |
