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

## 배포 (Docker Compose)

저장소 루트의 [`docker-compose.yml`](docker-compose.yml)은 **API(Node)** 와 **UI(nginx)** 두 서비스를 올립니다. UI는 빌드 시점의 정적 파일을 이미지에 넣고, 브라우저가 쓰는 `/api/*`는 nginx가 같은 Compose 네트워크의 API 컨테이너(`PORT=20080`)로 넘깁니다. 벤치 SSE를 위해 nginx에서 `proxy_buffering` 등을 끈 설정은 [`docker/nginx/default.conf`](docker/nginx/default.conf)를 참고하면 됩니다.

```bash
docker-compose up -d --build
```

- 기본 접속: **http://localhost:8080** (웹). API는 호스트에 직접 노출하지 않고, 웹과 동일 오리진의 `/api`로만 쓰는 구성입니다.
- SQLite: 볼륨 `bench_data`가 API 컨테이너의 `/data`에 마운트되며, 기본 `BENCH_DB_PATH=/data/bench.sqlite`입니다.
- 포트·환경을 바꾸려면 `docker-compose.yml`의 `web.ports`·`api.environment`를 수정합니다.
- 이미지 빌드는 루트 [`Dockerfile`](Dockerfile)의 멀티 스테이지(`target: api` / `target: web`)를 사용합니다.

### Docker Compose: 배포 후 업데이트

저장소를 갱신한 뒤 이미지를 다시 빌드하고 컨테이너를 재기동합니다.

```bash
git pull
docker-compose build
docker-compose up -d
```

의존성·네이티브 모듈 문제를 의심할 때만 `--no-cache`를 붙여 전체 재빌드합니다. 오래된 로컬 이미지를 정리하려면 `docker image prune`(필요 시 `-a`)를 사용합니다. DB 볼륨은 기본 설정에서 유지되므로 `docker-compose down`만으로는 named volume `bench_data`가 삭제되지 않습니다(볼륨까지 지우려면 `docker-compose down -v`).

## 배포 (PM2)

[`ecosystem.config.cjs`](ecosystem.config.cjs)는 **앱 하나(`llm-bench`)** 만 켭니다. 서버가 `WEB_DIST_PATH`로 지정한 Vite `dist`를 같은 포트에서 함께 서빙하므로, Nginx 없이 **http://호스트:PORT/** 로 UI·`/api`가 모두 동작합니다.

1. 서버에 Node 20+·pnpm·PM2 설치 후 저장소 클론.
2. `pnpm install` → `pnpm build`(**웹 `dist`가 반드시 있어야** UI가 열립니다).
3. 루트에서:

```bash
pm2 start ecosystem.config.cjs
```

기본 포트는 **20080**이며, DB는 `apps/server/data/bench.sqlite`입니다. `WEB_DIST_PATH`를 비우면 API만 제공(루트는 404)하므로, 그때는 Nginx 등으로 `dist`와 `/api`를 나눠 서빙하면 됩니다.

### PM2: 배포 후 업데이트

```bash
git pull
pnpm install
pnpm build
pm2 reload ecosystem.config.cjs
```

`reload`는 무중단에 가깝게 프로세스를 교체합니다. 환경을 바꿨다면 `pm2 delete llm-bench` 후 다시 `pm2 start ecosystem.config.cjs`를 쓰거나 `pm2 reload ecosystem.config.cjs --update-env`로 반영합니다. 부팅 시 자동 기동은 `pm2 startup` + `pm2 save`입니다.

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
| `PORT` | API·(설정 시) 정적 UI 리스닝 포트(기본 **20080**, `pnpm dev`에서는 `dev-ports.json`/`DEV_SERVER_PORT`가 우선) |
| `BENCH_DB_PATH` | SQLite 파일 경로(미지정 시 `data/bench.sqlite`, **프로세스 cwd** 기준) |
| `WEB_DIST_PATH` | Vite 빌드 출력 디렉터리(`index.html` 포함). 설정 시 같은 프로세스에서 `/`·`/assets/*` 등을 서빙하고, 그 외 GET은 SPA용으로 `index.html`을 돌려줍니다(**프로세스 cwd** 기준 상대 경로 가능) |

API 키는 UI에서 세션 동안만 전달하거나, 서버 실행 환경의 표준 헤더 규칙에 맞춰 확장할 수 있습니다.

## 디자인

UI 토큰·톤은 루트 [`DESIGN.md`](DESIGN.md)를 따릅니다.

## 라이선스

- 본 프로젝트 코드는 [MIT](LICENSE) 라이선스를 따릅니다.
- 번역 시나리오에 포함된 PDF 등 제3자 리소스는 각 원저작물의 권리/배포 조건을 따를 수 있으므로, 배포 시 별도 확인이 필요합니다.
