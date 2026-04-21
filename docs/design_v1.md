# 내부 네트워크의 로컬 LLM 프로바이더 (LM Studio, Ollama, vLLM) 등에서 서빙하는 LLM 모델들을 벤치마크하는 프로젝트를 만드는 플랜

## API 참고

### LM Studio API

- Overview : https://lmstudio.ai/docs/developer/rest 
- Load a model : https://lmstudio.ai/docs/developer/rest/load 
- Unload a model : https://lmstudio.ai/docs/developer/rest/unload 

### Ollama API

- Overview : https://docs.ollama.com/api 
https://github.com/ollama/ollama/blob/main/docs/api.md 

## 벤치마크 플랜

- 정확한 벤치를 위해 가능하면 load/unload API를 사용하여 1개 모델만 로딩된 상태에서 테스트

### 측정 요소

#### 성능 지표

로딩 시간, TTFT (Time To First Token), TPOT (Time Per Output Token) 등 수치로 표현 가능한 지표

#### 품질 지표

- 단순 응답(채팅) 테스트
  - hello
  - ping/pong
- 코딩 테스트
  - 언어는 ts/js 와 파이썬 한정
  - 정렬 알고리즘 작성
- 번역 테스트
  - 원본: 영어로 작성된 [CONX 백서](docs/CONX_Whitepaper_v2.0.1.pdf)
  - 한국어, 일본어, 중국어-간체, 중국어-번체로 각각 번역 후 다시 영어로 번역

## UI / UX

- LLM 프로바이저 base url 입력
  - 자동으로 프로바이더 런타임 타입 감지 및 모델 목록 불러오기
- 벤치 대상 목록 다중선택
- 측정 요소 미리보기 및 시각화

## 기타

- 웹페이지 포트는 충돌이 없도록 20000만번대에서 랜덤으로.

마지막으로 부족한게 있으면 추천해줘.
