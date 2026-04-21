# llm-model-bench

내부망 로컬 LLM(LM Studio, Ollama, OpenAI 호환) 벤치마크 UI + API. `POST /v1/chat/completions` 및 `POST /v1/messages`(Anthropic 호환) 스트리밍으로 TTFT/TPOT을 측정합니다.

## 요구 사항

- Node.js 20+
- pnpm 10+

## 개발

```bash
pnpm install
pnpm dev
```

- 개발용 포트는 **저장소에 고정**되어 있습니다: [`scripts/dev-ports.json`](scripts/dev-ports.json)의 `serverPort`(기본 20000–20999)·`vitePort`(21000–21999). 매 실행마다 바뀌지 않으며, 충돌 시 이 파일만 수정하면 됩니다.
- 한 번에 덮어쓰려면 환경변수 `DEV_SERVER_PORT`·`VITE_DEV_PORT`를 함께 지정할 수 있습니다.
- UI는 Vite 프록시로 `/api`를 로컬 서버에 전달합니다.
- 벤치 UI 설정(Base URL, 병렬/하이라이트 등)은 브라우저 `localStorage`에 저장되며, API 키는 기본적으로 `sessionStorage`만 쓰고 디스크(`localStorage`) 저장은 체크박스로 명시 동의할 때만 합니다.
- 「벤치 대상 외 모델 언로드」는 **LM Studio**에서만 동작하며, 감지 API로 알려진 모델 ID에 한해 unload를 시도합니다(목록 밖에 로드된 모델은 제어하지 못함).
- `translate_bitcoin_pdf_tools` 시나리오는 [`apps/web/public/bitcoin.pdf`](apps/web/public/bitcoin.pdf)를 브라우저 origin 기준 URL로 가져오도록 설계되어 있습니다. 벤치 실행 시 UI가 `publicAssetsOrigin`을 함께 보냅니다.

## 테스트

```bash
pnpm test
```

## 환경 변수 (서버)

- `PORT`: API 서버 포트 (기본 `20080` 단독 실행 시).

API 키는 UI에서 세션 동안만 전달하거나, 서버 실행 환경의 표준 헤더 규칙에 맞춰 확장할 수 있습니다.
