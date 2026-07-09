# LM Studio 엔진 프로토콜 회귀 (도구 인자 손상 · 추론 누수)

LM Studio의 **Developer → Runtime Settings → "Use LM Studio Engine Protocol"** 옵션(신규 분리형 llama.cpp 런타임)을 켠 채로 벤치를 돌리면, 일부 빌드에서 **도구 사용이 조용히 실패**하거나 **사고(reasoning) 블록이 응답 본문으로 새어 들어와** 채점이 오염될 수 있다. 이 문서는 원인·증상·조치와, 이 repo가 그걸 **감지·경고**하는 방식을 정리한다.

관련 문서: 도구 시나리오의 `messages` 라우트가 빈 응답으로 끝나는 별개 이슈는 [`lmstudio-jinja-template-crashes.md`](lmstudio-jinja-template-crashes.md) 참고.

---

## 1. "Use LM Studio Engine Protocol"이란

llama.cpp 추론 엔진을 앱 본체에서 분리해, **엔진 업데이트를 앱 릴리스와 독립적으로 더 자주** 내보내기 위한 신규 통합 아키텍처다. UI 설명: *"Supported for llama.cpp. Uses the new integration architecture to enable more frequent engine updates."*

타임라인(대략):

| 버전 | 상태 |
|---|---|
| 0.4.14 (2026-05) | 엔진 프로토콜 beta 도입 |
| 0.4.15 | beta 2 |
| 0.4.17 | **기본 off**(베타 업그레이드 사용자 포함) |
| 0.4.19 (2026-07) | **[STABLE] 기본 on** — 아래 회귀들이 수정됨 |

단순 배관 변경이 아니라, 이 경로가 **Jinja 템플릿을 덮어쓰거나 reasoning 모드를 강제**하는 등 프롬프트 템플릿·출력 후처리 동작을 실제로 바꾼 정황이 보고됐다.

---

## 2. 두 회귀 (사용자 증상과 일치)

### 2.1 도구 인자 손상 (tool_call arguments corruption)

- [bug-tracker #1922](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1922): 엔진 프로토콜 런타임 + 스트리밍 + `tools`에서 OpenAI 호환 `/v1/chat/completions`의 `tool_calls[].function.arguments`가 **`{}{}{}`처럼 연결·손상**되어 나온다. **공식 워크어라운드가 "이 옵션 끄기".**
- 이 repo에서의 영향: 스트림 소비자([openai-stream.ts](../apps/server/src/openai-stream.ts))가 델타 인자를 문자열로 이어붙이므로, 손상된 인자는 그대로 합쳐져 [`executeBenchTool`](../apps/server/src/tooling/bench-tools.ts)의 `JSON.parse`가 실패 → 도구 시나리오(`translate_nist_fips197_pdf_tools` 등)가 **조용히 0점**.

### 2.2 추론 누수 (reasoning replayed as content)

- [0.4.19 changelog](https://lmstudio.ai/changelog/lmstudio-v0.4.19): "reasoning이 non-reasoning content로 재생되던 버그"를 이 버전에서 수정. 그 전엔 추론이 `reasoning_content` 대신 본문 `content`로 새어 들어온다.
- 관련: [#1592](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1592)(툴 파서가 `<think>` 내부까지 스캔해 오탐), [#1602](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1602)(`reasoning_content`만 차고 `content`는 빈 채 `finish=stop`).
- 이 repo에서의 영향: 누수된 추론이 `assistantText`에 섞여 채점 텍스트를 오염시킨다. 대부분의 채점 경로는 `stripThinkingBlocks`로 방어하지만, 태그가 붙은 누수만 잡을 수 있다(§4 한계).

---

## 3. 권장 설정 (재현성)

1. **1차 방어 = 업그레이드.** LM Studio를 **0.4.19+ 로 핀**하면 프로토콜을 켠 채로도 위 두 회귀가 수정된 상태다. 구버전을 고정해야 하면 **엔진 프로토콜을 끈다**.
2. Developer의 **"When applicable, separate reasoning_content and content in API responses"**를 켠다 — 추론 모델의 `reasoning_content` 분리 신뢰도가 올라간다.
3. **재현성:** 런 노트에 LM Studio 앱 버전 + llama.cpp 런타임 버전을 기록한다(엔진 프로토콜 on/off 상태는 API로 노출되지 않으므로 증상 감지에 의존).

---

## 4. 이 repo의 감지·경고

하니스가 두 시그니처를 **런 단위 플래그로 감지**해 경고한다(점수/pass·fail 판정은 바꾸지 않는 annotate-only):

| 플래그 | 감지 위치 | 의미 |
|---|---|---|
| `tool_call_args_corrupted` | [openai-stream.ts](../apps/server/src/openai-stream.ts) | 병합된 tool_call 인자가 완결 JSON 뒤에 또 다른 JSON이 이어붙은 연결 손상(`{}{}`) |
| `reasoning_leaked_into_content` | [bench-runner.ts](../apps/server/src/bench-runner.ts) | chat 라우트에서 분리 채널 추론이 전혀 없는데 본문에 사고 블록 마커가 있음 |

UI: 결과 표(시나리오 옆)와 상세 드로어에 <kbd>⚠</kbd> 배지 + **행동 권고**(0.4.19+ 업그레이드 / 옵션 끄고 재측정, 웹 `/profile#lmstudio-host` 링크)가 뜬다.

**채점 강화:** 추론 누수 대비로, raw 문자열을 채점하던 [`toolWeatherOutputPass`](../apps/server/src/scenarios.ts)·`scoreChatTimeCalendar`가 이제 판정 전 `stripThinkingBlocks`를 적용한다 → 누수된 사고 블록 안의 정답/도구 시그니처를 더 이상 통과로 인정하지 않는다(과거 결과와 직접 비교 시 주의).

**한계:** 감지·채점 강화 모두 `stripThinkingBlocks`가 인식하는 **태그가 붙은** 누수(`<think>`, Gemma `<|channel>thought` 등)에 대한 best-effort다. 태그 없이 순수 프로즈로 추론만 채워지는 누수(#1602류)는 잡지 못하므로, **0.4.19+ 업그레이드가 1차 방어**임을 다시 강조한다.

---

## 5. 참고 자료

- 설정·타임라인: https://lmstudio.ai/changelog/lmstudio-v0.4.15 · https://lmstudio.ai/changelog/lmstudio-v0.4.17 · https://lmstudio.ai/changelog/lmstudio-v0.4.19
- 도구 인자 손상: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1922
- 추론 누수/파싱: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1592 · https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1602
- 도구 호출(OpenAI 호환): https://lmstudio.ai/docs/developer/openai-compat/tools
- reasoning_content 분리·gpt-oss reasoning 필드: https://lmstudio.ai/docs/developer/api-changelog
