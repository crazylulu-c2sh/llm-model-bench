# LLM 엔진의 chat template 교체하는 방법

모델의 chat template(프롬프트 템플릿)은 **엔진이 요청을 프롬프트 문자열로 렌더할 때** 쓰는 Jinja 코드다.
GGUF의 `tokenizer.chat_template` 메타데이터나 HF 리포지토리의 `chat_template.jinja`에 들어 있고,
**렌더는 생성 시작 전에 일어나므로 여기서 실패하면 토큰이 한 개도 안 나오고 빈 응답으로 끝난다.**

이 문서는 "그 템플릿을 엔진별로 어떻게 바꾸는가"만 다룬다.
LM Studio에서 실제로 관측된 크래시의 원인·진단·전용 패치 스크립트는
[`lmstudio-jinja-template-crashes.md`](lmstudio-jinja-template-crashes.md)를 참고.

> ⚠️ **벤치 유효성 주의.** 템플릿을 바꾸면 같은 모델·같은 시나리오라도 **모델에 들어가는 프롬프트가 달라진다.**
> 스톡 모델끼리 비교하던 결과와 교체 후 결과를 같은 표에서 비교하면 안 된다.
> 벤치 목적이라면 **최소 패치**(문제되는 지점만)를 권하고, 커뮤니티 범용 수정 템플릿처럼
> 프롬프트 구성 자체가 달라지는 것은 트러블슈팅용으로만 쓴다.

---

## 1. 먼저 — 템플릿을 안 고치고 푸는 방법

교체는 마지막 수단이다. 순서대로 시도한다.

1. **엔진 업데이트** — llama.cpp/minja는 템플릿 호환성이 자주 개선된다. LM Studio도 런타임을 올리면
   과거에 깨지던 템플릿이 그대로 동작하는 경우가 많다.
2. **정리된 GGUF 재다운로드** — `lmstudio-community/*`는 프롬프트 템플릿이 손질된 재배포본인 경우가 많다.
   공식/`unsloth` 리포지토리도 출시 직후 템플릿 버그를 사후 수정(re-push)한다.
3. 그래도 안 되면 아래 교체.

---

## 2. 엔진별 교체 방법

| 엔진 | 방법 | 템플릿 포맷 |
|---|---|---|
| **LM Studio** | My Models(`Ctrl/⌘+3`) → 모델의 ⚙️ → **Prompt Template**에 Jinja 붙여넣기. 되돌리기는 옆 휴지통 아이콘 | Jinja |
| **llama.cpp** | `llama-server --jinja --chat-template-file <파일>` | Jinja |
| **vLLM** | `vllm serve <model> --chat-template <파일 또는 문자열>` | Jinja |
| **Ollama** | Modelfile의 `TEMPLATE` — ⚠️ **Go 템플릿. Jinja를 그대로 붙여넣으면 안 된다** | **Go** |

### 2.1 LM Studio

UI가 가장 간단하다. `My Models` → 대상 모델의 ⚙️ → `Prompt Template`에 Jinja를 넣고 저장한다.
템플릿 입력란이 안 보이면 사이드바를 우클릭해 **"Always Show Prompt Template"** 을 켠다.
prefix/suffix 방식으로도 쓸 수 있지만, 도구·추론이 있는 모델은 Jinja를 써야 한다.

파일로 다루고 싶다면 오버라이드는 여기에 저장된다.

```
~/.lmstudio/.internal/user-concrete-model-default-config/<publisher>/<model>.json
  └ .operation.fields[]  ·  key = "llm.prediction.promptTemplate"
```

이 저장소의 패치 스크립트(`scripts/fix-*-lmstudio-template.sh`)가 쓰는 곳도 같은 필드다.
스크립트는 기존 오버라이드가 있으면 **그 필드만 제자리에서** 바꾸고(버전 안전), 없으면 GGUF에서 템플릿을 뽑아 주입한다.

**설정은 모델 로드 시점에 읽힌다 — 바꾼 뒤 반드시 UNLOAD → RELOAD 한다.**

### 2.2 llama.cpp

```bash
llama-server -m model.gguf --jinja --chat-template-file ./chat_template.jinja
```

`--jinja` 없이는 내장 템플릿 이름 매칭으로 떨어지므로 **두 플래그를 같이** 쓴다.
`llama-cli`도 같은 플래그를 받는다.

### 2.3 vLLM

```bash
vllm serve Qwen/Qwen3.8-27B --chat-template ./chat_template.jinja
```

파일 경로 대신 템플릿 문자열을 직접 줘도 된다. 엔진이 감지한 content 형태를 바꿔야 하면
`--chat-template-content-format`을 함께 쓴다. 영구 적용은 모델 디렉터리의
`tokenizer_config.json` 안 `chat_template` 값을 바꾸는 방법도 있다.

### 2.4 Ollama — ⚠️ 포맷이 다르다

Ollama의 `TEMPLATE`은 **Jinja가 아니라 Go 템플릿**이다. HF에서 받은 `chat_template.jinja`를
Modelfile에 그대로 붙여넣으면 동작하지 않는다.

```dockerfile
FROM qwen3.8:27b
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ range .Messages }}<|im_start|>{{ .Role }}
{{ .Content }}<|im_end|>
{{ end }}<|im_start|>assistant
"""
```

```bash
ollama create my-qwen38 -f ./Modelfile
```

Jinja 템플릿을 Go로 옮겨야 한다면 수작업하거나 `@huggingface/ollama-utils`의
`convertJinjaToGoTemplate` 같은 변환기를 쓴다. Ollama가 레지스트리에서 받은 템플릿이
잘못된 사례도 보고돼 있어, 먼저 `ollama show --modelfile <model>`로 현재 템플릿을 확인하는 게 좋다.

---

## 3. 원본 템플릿 구하기

패치는 **현재 쓰고 있는 템플릿**에서 출발해야 한다. 양자화 리포지토리마다 템플릿이 다를 수 있다.

```bash
# (a) 실제 로드 중인 GGUF에서 뽑기 — 가장 정확
python3 -c "
from gguf import GGUFReader
r = GGUFReader('model.gguf')
f = r.fields['tokenizer.chat_template']
print(bytes(f.parts[f.data[0]]).decode())
"

# (b) HF 원본
curl -sSL https://huggingface.co/<org>/<model>/raw/main/chat_template.jinja

# (c) Ollama가 현재 쓰는 것
ollama show --modelfile <model>
```

`scripts/fix-*-lmstudio-template.sh`는 (a)를 자동으로 한다(`python3 -m pip install --user gguf` 필요).

---

## 4. 검증과 되돌리기

1. **정적 렌더 테스트** — 패치 전/후 템플릿을 python Jinja2로 렌더해 비교한다.
   문제 케이스는 통과하고, **정상 케이스는 출력이 바이트 동일**해야 한다(무해성 확인).
2. **실기 확인** — Jinja2와 minja(llama.cpp·LM Studio)는 undefined 의미가 달라 정적 테스트만으론 부족하다.
   엔진에 적용하고 UNLOAD/RELOAD 후 실제 요청을 보낸다. 200 + 정상 응답이면 해결.
3. **되돌리기** — LM Studio는 Prompt Template 옆 휴지통 아이콘, 또는 스크립트가 남긴
   `<config>.bak.<timestamp>`를 `cp`로 복구. llama.cpp/vLLM은 플래그를 빼면 되고, Ollama는 원본 모델을 다시 쓴다.

---

## 5. 사례: Qwen3.8은 현재 교체가 필요 없다

Qwen3.8 공식 템플릿은 `reasoning_effort`가 `xhigh`·`medium`·`low`가 아니면 예외를 던진다.

```jinja
{%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
{{ raise_exception('Unexpected reasoning effort ...') }}
```

이건 **템플릿을 고치지 않고 클라이언트에서 해결했다** —
[`packages/shared/src/llm-profiles.ts`](../packages/shared/src/llm-profiles.ts)의 `qwen38TemplateEffort`가
템플릿에 싣기 전에 값을 클램프하고, 사고 끄기는 `enable_thinking: false`로 표현한다.

LM Studio에서 Qwen3.8-27B를 5개 런(bf16 · q4_k_xl · q8_k_xl · unsloth q8_0 + 초기 런) 돌린 결과
**템플릿 렌더 실패는 0건**이었다. 도구 시나리오의 Anthropic `messages` 라우트 —
gemma-4·nemotron이 깨지는 바로 그 경로 — 도 정상 렌더됐다.

> 이 측정은 **템플릿 오버라이드를 적용하지 않은 스톡 상태**에서 나왔다. 즉 "패치해서 고쳐진 것"이 아니라
> **애초에 패치가 필요 없다**는 뜻이다. 같은 호스트의 `gemma-4-12b-it@q4_k_xl`·`@q8_k_xl`는
> 같은 스톡 상태에서 같은 시나리오가 3/3 미완료(`stream_completed=false`)로 실패한다 —
> [`lmstudio-jinja-template-crashes.md`](lmstudio-jinja-template-crashes.md)의 알려진 버그가 그대로 재현되는 것이며,
> 그쪽은 패치 스크립트를 돌리면 된다.

> 교체는 **관측된 실패가 있을 때만** 한다. 예방 목적의 선제 교체는 벤치 비교 가능성만 잃는다.
