# LM Studio Jinja 프롬프트 템플릿 크래시 (Anthropic `/v1/messages` + tools)

LM Studio 백엔드로 벤치를 돌릴 때, **Anthropic 호환 `POST /v1/messages` 경로 + `tools`** 조합에서만
모델 프롬프트 템플릿 렌더가 깨지면서 응답이 빈 채로 끝나는 계열의 버그를 정리한다.
같은 모델이라도 OpenAI 호환 `POST /v1/chat/completions` 경로는 정상 렌더되는 경우가 많아 원인 파악이 헷갈린다.

대상 시나리오: `tool_weather`, `translate_nist_fips197_pdf_tools` 등 **도구 스키마가 붙는 시나리오의 `messages` 라우트**.

이 repo는 호스트(LM Studio 머신)에서 실행하는 **템플릿 오버라이드 패치 스크립트** 두 개를 제공한다.

- [`scripts/fix-nemotron-lmstudio-template.sh`](../scripts/fix-nemotron-lmstudio-template.sh) — `nvidia/nemotron-3-nano*`
- [`scripts/fix-gemma4-lmstudio-template.sh`](../scripts/fix-gemma4-lmstudio-template.sh) — `google/gemma-4-*` (unsloth/lmstudio-community 양자화 포함)

---

## 1. 증상 (로그에서 보이는 것)

LM Studio 로그에 다음 줄이 뜨고, 해당 런의 응답이 비어서(`Response finished but empty`) 기록된다.

| 모델 계열 | 에러 문구 |
|---|---|
| `nvidia/nemotron-3-nano*` | `Error rendering prompt with jinja template: "Cannot apply filter "string" to type: UndefinedValue"` |
| `google/gemma-4-*` | `Error rendering prompt with jinja template: "Cannot call something that is not a function: got UndefinedValue"` |

공통점:

- **Anthropic `/v1/messages` + `tools`** 경로에서만 터진다. 같은 모델의 OpenAI `/v1/chat/completions` 경로는 (모델에 따라) 정상.
- **모델 결함도, 벤치 버그도 아니다.** 모델 GGUF에 내장된 Jinja chat 템플릿이 가정한 입력 형태와,
  LM Studio가 Anthropic 요청을 그 템플릿에 먹일 때 만들어 주는 형태가 어긋나는 게 원인이다.
- 동반되는 무해한 경고:
  `No valid custom reasoning fields found ... Reasoning setting 'off' cannot be converted to any custom KVs.`
  이건 LM Studio **자체의** reasoning 토글이 GGUF 메타데이터에 매핑할 KV가 없다는 경고일 뿐,
  벤치가 system 프롬프트에 넣는 인밴드 `<|think|>` 토큰과는 별개이고 크래시 원인이 아니다.

---

## 2. 근본 원인

### 2.1 공통 메커니즘

LM Studio는 매 요청마다 모델 GGUF의 `tokenizer.chat_template`(Jinja)로 프롬프트 문자열을 빌드한다.
이 렌더는 **생성 시작 전**에 일어나므로, 실패하면 토큰이 한 개도 안 나오고 빈 응답으로 끝난다.

- OpenAI `/v1/chat/completions`: `messages[].content`가 평문 문자열, `tools`가 OpenAI 형태
  (`{type:"function", function:{name, description, parameters}}`), 도구 결과가 별도 `role:"tool"` 메시지.
  대부분의 모델 템플릿이 **바로 이 형태를 가정**해서 작성돼 있어 잘 렌더된다.
- Anthropic `/v1/messages`: `tools`가 평면 형태(`{name, description, input_schema}`),
  도구 결과가 user 메시지의 `tool_result` content block, system이 top-level 필드.
  LM Studio가 이를 템플릿용으로 변환하는데, 빌드/모델에 따라 위 OpenAI 형태를 **완전히 재현하지 못한다**.
  그러면 템플릿이 기대한 키가 `UndefinedValue`가 되고, 그 위에서 일어나는 연산이 터진다.

### 2.2 Nemotron — 필터를 undefined에 적용 (`Cannot apply filter "string"`)

`nemotron-3-nano*` 템플릿은 `message.content`(또는 파생 `content`, tool 관련 extra-key)에
`| string` / `| trim`을 적용한다. Anthropic 경로에서 그 값이 null/undefined가 되는 턴
(예: tool 결과 피드백 턴)에 필터가 undefined에 걸려 크래시한다.

수정: 필터 앞 또는 content 대입/concat 지점에 `| default('', true)`를 끼워 null을 빈 문자열로 흘린다.
단, **`tool_call.arguments` 같은 곳에 무차별 `| string`을 넣으면 `false`/`0` 같은 falsy 인자가 `""`로 깨지므로**
대상 지점만 정밀하게 가드한다. (스크립트 주석 참고.)

### 2.3 Gemma 4 — undefined를 호출 (`Cannot call something that is not a function`)

Gemma 4의 `chat_template.jinja`(매크로 5개, ~290줄)는 **철저히 OpenAI Chat-Completions 형태**를 가정한다.
검증은 verbatim 템플릿을 받아서 했다 (출처는 아래 §5).

- 도구 정의: `format_function_declaration(tool_data)`가 `tool_data['function']['name'|'description'|'parameters']`를
  읽고 `'response' in tool_data['function']`을 검사한다 → **Anthropic 평면 tools `{name, description, input_schema}`**
  에서는 `tool_data['function']`이 `UndefinedValue`.
- 도구 결과: `message.get('tool_calls')`로 분기한 뒤 뒤따르는 `role:"tool"` 메시지를 스캔하며
  `follow.get('content')` / `follow.get('tool_call_id')` / `tc.get('id')`를 호출한다 → Anthropic은
  도구 결과를 `role:"tool"`이 아니라 user 메시지의 `tool_result` 블록으로 보내므로 스캔이 안 맞는다.
- 추론 채널: 매 메시지에서 `message.get('reasoning') or message.get('reasoning_content')`를 호출하고,
  model 턴 본문은 `strip_thinking(content)` 안에서 `text.split('<channel|>')`를 호출한다.

`"Cannot call something that is not a function: got UndefinedValue"`는 minja(LM Studio의 Jinja 엔진)에서
**호출식의 피호출자가 undefined**일 때 나는 에러다. 즉 `x.method(...)`나 매크로 호출에서 `x.method`가 `UndefinedValue`.
가장 유력한 발화 지점은 두 가지이며, 둘 다 같은 뿌리(OpenAI-shape 가정 vs Anthropic 입력)다.

1. **`.get()` 메서드 호출** — `message.get('reasoning')` 등. minja 빌드가 dict `.get()`을 지원하지 않거나
   수신자가 mapping이 아니면 `message.get`이 `UndefinedValue`가 되어 즉시 터진다. 첫 user 메시지에서 바로 발생 →
   빈 응답과 일치.
2. **평면 tools에서 `tool_data['function']` 인덱싱/`| upper` 연쇄** — 도구 배열이 존재하기만 해도 system 블록에서 발생.
   `value['type'] | upper`가 undefined에 걸리는 형제 증상(`Cannot apply filter "upper" to UndefinedValue`)도 같은 뿌리다
   (lmstudio-bug-tracker #1749).

> 정확히 어느 호출이 먼저 터지는지는 **이 LM Studio 빌드의 Anthropic→템플릿 변환기 동작 + 해당 GGUF의 템플릿 바이트**에
> 달려 있다. [`scripts/fix-gemma4-lmstudio-template.sh`](../scripts/fix-gemma4-lmstudio-template.sh)는 위 두 경로를
> **모두** 가드한다 (아래 §4).

---

## 3. 진단 절차

1. LM Studio 로그에서 `Error rendering prompt with jinja template` 줄을 찾고, 바로 위 `POST /v1/messages` 요청 body의
   `model` / `tools` 유무를 확인한다.
2. 같은 모델로 OpenAI 경로(`/v1/chat/completions`) + tools가 정상인지 비교한다. **messages만 깨지면** 이 문서의 케이스다.
3. 어느 시나리오인지 본다 — `tools`에 `fetch_url`/`fetch_pdf_text`가 있으면 `translate_nist_fips197_pdf_tools`,
   `get_weather`면 `tool_weather`.
   (시나리오 도구 정의는 [`apps/server/src/scenarios.ts`](../apps/server/src/scenarios.ts), 프로파일/샘플링은
   [`packages/shared/src/llm-profiles.ts`](../packages/shared/src/llm-profiles.ts)의 `gemma4`.)

---

## 4. 해결책 (우선순위)

| # | 방법 | repo 코드 변경 | 비고 |
|---|---|---|---|
| 1 | **LM Studio Jinja 템플릿 오버라이드** (아래 스크립트) | 없음(LM Studio 설정만) | 가장 확실. 호스트에서 실행 |
| 2 | **수정된 GGUF 재다운로드** — `lmstudio-community`/공식 또는 unsloth re-push | 없음 | Gemma 4 출시 첫날 양자화는 템플릿이 깨진 채 풀린 사례가 있음(#1749/#1927) |
| 3 | **LM Studio 업데이트** | 없음 | 최신 llama.cpp/minja는 Anthropic content를 OpenAI 형태로 재구성 + 빌트인 보강. ②와 병행 권장 |
| 4 | (최후) 해당 모델만 `messages` 경로 비활성 → `chat`로 폴백 | 설정 변경 필요 | 실패 경로 자체를 우회 |

순수 운영(코드/설정 무수정) 관점에선 **②+③**(GGUF 재다운로드 + LM Studio 업데이트)이 가장 깔끔하다.
②/③로도 안 풀리거나 특정 양자화를 고정해야 하면 **①** 템플릿 오버라이드를 쓴다.

### 4.1 스크립트 동작 (공통)

두 스크립트 모두 모델별로:

1. `~/.lmstudio/.internal/user-concrete-model-default-config/<id>.json`을 찾는다.
2. 현재 Jinja 템플릿을 얻는다 — 기존 `llm.prediction.promptTemplate` 오버라이드 재사용(버전 안전),
   없으면 GGUF의 `tokenizer.chat_template`에서 추출(python `gguf` 필요).
3. **멱등(idempotent)** 패치를 적용하고, 규칙별 치환 수 + diff를 출력한다.
4. 백업 후 `llm.prediction.promptTemplate` 오버라이드로 다시 쓴다.
5. **LM Studio에서 모델 UNLOAD 후 RELOAD** (설정은 로드 시점에 읽힘).

`--dry-run`(쓰기 없이 diff만), `--force`, `--legacy-schema` 플래그 지원. **반드시 `--dry-run`으로 diff를 먼저 검토**한다.

```bash
# LM Studio가 도는 호스트(예: Spark 박스)에서, repo 안이 아니라!
./scripts/fix-gemma4-lmstudio-template.sh --dry-run        # diff만
./scripts/fix-gemma4-lmstudio-template.sh                  # 기본 모델 패치
./scripts/fix-gemma4-lmstudio-template.sh google/gemma-4-12b-it   # 특정 모델
```

### 4.2 Gemma 4 스크립트가 적용하는 가드 4종

| 가드 | 대상 | 효과 |
|---|---|---|
| 평면 tools 정규화 | `format_function_declaration` 진입부 | Anthropic `{name, description, input_schema}`를 `{function:{name, description, parameters}}`로 감싸 매크로 본문이 그대로 동작 |
| `.get('k')` → `['k']` | 모든 dict `.get` 호출 | minja `.get()` 미지원/비-mapping 수신자에 대한 의존 제거 (의미 동일: 없는 키 → undefined) |
| `\| upper` → `\| default('') \| upper` | 타입 문자열 `\| upper` | undefined 타입에 필터가 걸리는 #1749 형제 증상 방지 |
| `strip_thinking(text)` 인자 가드 | 매크로 진입부 `text \| default('', true)` | null `text`에 `.split()` 호출 방지 |

각 가드는 멱등이며(두 번 돌려도 0건), OpenAI 형태로 이미 변환된 입력에는 무해하다.

검증(verbatim 템플릿을 Jinja2로 렌더한 proxy 테스트):

- Anthropic 평면 tools 첫 턴 — 원본은 `'dict object' has no attribute 'function'`로 실패, **패치본은 정상 렌더**.
- OpenAI 형태 tools / 도구 결과 피드백 턴 — 원본·패치본 출력이 **바이트 동일**(정상 경로 무해).
- 패치는 멱등(재실행 시 0건).

> Jinja2와 LM Studio의 minja는 undefined 의미가 완전히 같지 않으므로(minja는 접근엔 관대하나 filter/call에 더 엄격),
> 위 proxy 통과 후에도 **반드시 §4.3 verify curl**로 실기기에서 확인한다. **Gemma 4 템플릿은 신규·복잡하므로 diff 검토는 필수.**

### 4.3 검증

UNLOAD+RELOAD 후, 도구가 붙은 첫 턴과 도구 결과 피드백 턴 두 가지를 호출해 200 + 정상 응답(에러 문구 없음)인지 본다.
(curl 예시는 각 스크립트의 "Next steps" 출력에 포함돼 있다.) 그 다음 벤치를 재실행하면 해당 tool 시나리오의 `messages` 행이 통과해야 한다.

복구: 백업이 `<config>.bak.<timestamp>`에 있으니 되돌리려면 cp 후 RELOAD.

---

## 5. 참고 자료

- Gemma 4 chat 템플릿(verbatim): `https://huggingface.co/google/gemma-4-12B-it` → `chat_template.jinja`
  (별도 파일에 있으며 `tokenizer_config.json`에 없음 — transformers #45205)
- Gemma 4 day-one 도구 템플릿 버그: lmstudio-bug-tracker #1749 (`Cannot apply filter "upper" to UndefinedValue`), #1927
- llama.cpp의 Anthropic Messages API 처리(내부적으로 OpenAI로 변환): `huggingface.co/blog/ggml-org/anthropic-messages-api-in-llamacpp`
- minja(Google) chat-template 폴리필: `github.com/google/minja`

## 6. 관련 코드

- 시나리오/도구 정의: [`apps/server/src/scenarios.ts`](../apps/server/src/scenarios.ts) (`translateToolsAnthropic`, `tool_weather`)
- 프로파일·샘플링·`<|think|>` 규칙: [`packages/shared/src/llm-profiles.ts`](../packages/shared/src/llm-profiles.ts) (`gemma4`)
- Anthropic 요청 빌드 + think 토큰 주입: [`apps/server/src/bench-runner.ts`](../apps/server/src/bench-runner.ts) (`prepareAnthropicScenario`)
</content>
</invoke>
