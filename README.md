# llm-model-bench

내부망 로컬 LLM(LM Studio, Ollama, OpenAI 호환) 벤치마크 UI + API. `POST /v1/chat/completions` 및 `POST /v1/messages`(Anthropic 호환) 스트리밍으로 TTFT/TPOT 등을 측정합니다.

## 구성

| 패키지 | 설명 |
|--------|------|
| [`apps/web`](apps/web) | React + Vite UI |
| [`apps/server`](apps/server) | Hono API, 벤치 오케스트레이션, SQLite 런 저장 |
| [`packages/shared`](packages/shared) | 공유 타입·스키마 (`pnpm install` 시 `postinstall`로 빌드) |

## 요구 사항

- Node.js 20+
- pnpm 10+ (저장소는 `packageManager` 필드에 고정 버전 명시)

## 개발

```bash
pnpm install
pnpm dev
```

- `pnpm dev`는 루트 [`scripts/dev.mjs`](scripts/dev.mjs)가 **서버·웹을 동시에** 띄웁니다.
- 포트는 [`scripts/dev-ports.json`](scripts/dev-ports.json)의 `serverPort`(20000–20999)·`vitePort`(21000–21999)에 고정됩니다. 충돌 시 이 파일만 바꾸면 됩니다.
- 한 번에 덮어쓰려면 `DEV_SERVER_PORT`·`VITE_DEV_PORT`를 함께 지정합니다.
- 웹은 Vite 프록시로 `/api`를 로컬 API(`VITE_API_URL`)로 넘깁니다.

### UI·동작 메모

- 벤치 UI 설정(Base URL, 병렬/하이라이트 등)은 브라우저 `localStorage`에 저장됩니다. API 키는 기본적으로 `sessionStorage`만 쓰고, 디스크(`localStorage`) 저장은 체크박스로 명시 동의할 때만 합니다.
- 「벤치 대상 외 모델 언로드」는 **LM Studio**에서만 동작하며, 감지 API로 알려진 모델 ID에 한해 unload를 시도합니다(목록 밖에 로드된 모델은 제어하지 못함).
- `translate_nist_fips197_pdf_tools` 시나리오는 [`apps/web/public/nist.fips.197.pdf`](apps/web/public/nist.fips.197.pdf)를 브라우저 origin 기준 URL로 가져오도록 설계되어 있습니다. 벤치 실행 시 UI가 `publicAssetsOrigin`을 함께 보냅니다.

## 빌드·실행(프로덕션에 가깝게)

```bash
pnpm build
```

- API: `pnpm --filter @llm-bench/server start` — `PORT`는 미지정 시 **20080**입니다(`pnpm dev`는 `dev-ports.json`의 값으로 `PORT`를 넣음).
- UI: `pnpm --filter @llm-bench/web build` 후 `dist/`를 정적 호스팅하거나, 개발 서버와 동일하게 API를 쓰려면 `VITE_API_URL`을 API 베이스로 맞춘 뒤 `vite preview` 등으로 띄웁니다.

## 서버 API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스 체크 |
| POST | `/api/detect` | Base URL 기준 프로바이더·모델 감지 |
| POST | `/api/bench/stream` | 벤치 실행, **SSE**(`text/event-stream`)로 스트림 이벤트 |
| GET | `/api/runs` | 최근 런 목록(SQLite 사용 시) |
| GET | `/api/runs/:runId` | 단일 런 상세 |
| GET | `/api/runs/latest-by-model` | baseUrl·modelIds별 최신 완료 런 |
| GET | `/api/stats/model-latest` | 모델별 최신 완료 런 요약(통계 UI용) |

SQLite를 열 수 없을 때는 벤치 스트림은 진행되나 디스크 저장·히스토리 API가 비활성화될 수 있습니다. 응답에 `sqlite_available` / `sqlite_error` 등이 포함됩니다.

## 테스트

```bash
pnpm test
```

(`@llm-bench/server`, `@llm-bench/shared` 위주; 웹 패키지는 현재 스크립트만 통과 처리)

## 환경 변수 (서버)

| 변수 | 설명 |
|------|------|
| `PORT` | API 리스닝 포트(기본 **20080**, `pnpm dev`에서는 `dev-ports.json`/`DEV_SERVER_PORT`가 우선) |
| `BENCH_DB_PATH` | SQLite 파일 경로(미지정 시 `data/bench.sqlite`, **프로세스 cwd** 기준) |

API 키는 UI에서 세션 동안만 전달하거나, 서버 실행 환경의 표준 헤더 규칙에 맞춰 확장할 수 있습니다.

## 디자인

UI 토큰·톤은 루트 [`DESIGN.md`](DESIGN.md)를 따릅니다.

## 라이선스

- 본 프로젝트 코드는 [MIT](LICENSE) 라이선스를 따릅니다.
- 번역 시나리오에 포함된 PDF 등 제3자 리소스는 각 원저작물의 권리/배포 조건을 따를 수 있으므로, 배포 시 별도 확인이 필요합니다.
