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
- 번역·툴 통합 테스트 (`translate_nist_fips197_pdf_tools`)
  - 원본: 웹 UI `public`에 둔 [NIST FIPS 197 PDF](apps/web/public/nist.fips.197.pdf)를 Vite가 `/nist.fips.197.pdf`로 서빙
  - 벤치 서버가 `fetch_url` / `fetch_pdf_text` 도구를 실행(SSRF 방지로 해당 origin의 `/nist.fips.197.pdf`만 허용)하고, UI는 `publicAssetsOrigin`(보통 `window.location.origin`)을 벤치 API에 전달
  - 모델은 PDF 본문을 툴로 읽은 뒤 **한국어 1000자 이내**로 요약·번역

## UI / UX

- LLM 프로바이저 base url 입력
  - 자동으로 프로바이더 런타임 타입 감지 및 모델 목록 불러오기
- 벤치 대상 목록 다중선택
- 측정 요소 미리보기 및 시각화

## 기타

- 웹페이지 포트는 충돌이 없도록 20000만번대에서 랜덤으로.

마지막으로 부족한게 있으면 추천해줘.
