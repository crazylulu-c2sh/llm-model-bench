# llm-model-bench

내부망 로컬 LLM(LM Studio, Ollama, OpenAI 호환) 벤치마크 UI + API. `POST /v1/chat/completions` 및 `POST /v1/messages`(Anthropic 호환) 스트리밍으로 TTFT/TPS 등을 측정합니다.

## 구성

| 패키지 | 설명 |
|--------|------|
| [`apps/web`](apps/web) | React + Vite UI |
| [`apps/server`](apps/server) | Hono API(`/api` + 버전드 `/api/v1` + OpenAPI), 벤치 오케스트레이션, SQLite 런 저장 |
| [`apps/mcp`](apps/mcp) | AI 에이전트용 MCP 서버(stdio + streamable-HTTP) — 벤치 API 프록시 |
| [`packages/shared`](packages/shared) | 공유 타입·스키마·스코어링 (`pnpm install` 시 `postinstall`로 빌드) |

## 요구 사항

- Node.js 24.x (LTS) — 저장소는 [`.nvmrc`](.nvmrc) / `package.json` `volta`로 정확 패치 버전을 고정합니다. nvm/fnm/Volta 중 하나가 있으면 디렉터리 진입 시 자동 활성화됩니다. (`engine-strict=true`라 다른 메이저에선 `pnpm install`이 실패)
- pnpm 11+ (저장소는 `packageManager` 필드에 고정 버전 명시)

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

- 벤치 UI 설정(Base URL, 하이라이트 등)은 브라우저 `localStorage`에 저장됩니다. API 키는 기본적으로 `sessionStorage`만 쓰고, 디스크(`localStorage`) 저장은 체크박스로 명시 동의할 때만 합니다.
- 「벤치 대상 외 모델 언로드」는 **LM Studio**에서만 동작하며, 감지 API로 알려진 모델 ID에 한해 unload를 시도합니다(목록 밖에 로드된 모델은 제어하지 못함).
- 「모델 로드 TTL(초)」은 로드 시 유휴 후 자동 언로드되도록 TTL을 겁니다. **지원 백엔드에서만** 적용되고 그 외(openai_compatible·manual)는 무시됩니다. 비우면 미적용(기존 동작). **LM Studio**는 load 요청 `ttl`(초)로, **Ollama**는 네이티브 `/api/generate` `keep_alive`로 적용합니다. Ollama는 벤치 추론이 나가는 OpenAI 호환 `/v1/chat/completions`가 `keep_alive`를 무시하고 매 요청 기본 5분으로 리셋하므로([ollama#11458](https://github.com/ollama/ollama/issues/11458)), 시작 시 preload + **벤치 종료 후 지정 TTL 재적용**으로 유지 시간을 확정합니다.
- `translate_nist_fips197_pdf_tools` 시나리오는 [`apps/web/public/nist.fips.197.pdf`](apps/web/public/nist.fips.197.pdf)를 브라우저 origin 기준 URL로 가져오도록 설계되어 있습니다. 벤치 실행 시 UI가 `publicAssetsOrigin`을 함께 보냅니다.

## 빌드·실행(프로덕션에 가깝게)

```bash
pnpm build
```

- API: `pnpm --filter @llm-bench/server start` — `PORT`는 미지정 시 **20080**입니다(`pnpm dev`는 `dev-ports.json`의 값으로 `PORT`를 넣음).
- UI: `pnpm --filter @llm-bench/web build` 후 `dist/`를 정적 호스팅하거나, 개발 서버와 동일하게 API를 쓰려면 `VITE_API_URL`을 API 베이스로 맞춘 뒤 `vite preview` 등으로 띄웁니다.

## Provider 모니터링 · lms CLI

`/provider-monitor` 탭(헤더의 **프로바이더 모니터**) + StressPage 안 미니 위젯은 동일 머신에서 띄운 LM Studio/Ollama의 **로드된 모델·시스템 RAM·loadavg·GPU 사용량**을 5초 주기로 폴링합니다. LM Studio의 경우 `lms` CLI가 설치돼 있고 `ENABLE_LMS_CLI=1`이면 모델 **load/unload**·**lms log stream**도 같은 페이지에서 다룰 수 있습니다.

### 활성 조건 (3중 게이트)

1. **클라이언트 IP가 loopback** (`127.0.0.0/8`/`::1`/`::ffff:127.x`): CLI 라우트(load/unload/log-stream)는 비-loopback이면 **403 hard fail**. snapshot/availability는 200을 주되 `system`/`gpu`는 `null` + `remoteLoopback:false` 필드를 채워 UI가 graceful disable하도록 함.
2. **`baseUrl` hostname이 loopback** (`localhost`/`127.0.0.0/8`/`::1`/`0.0.0.0`): system/gpu/CLI 활성 조건. 비-loopback이면 system/gpu는 비활성, provider HTTP만 시도.
3. **`ENABLE_LMS_CLI=1` ENV**: `lms` CLI 호출에만 필요. snapshot의 HTTP 경로는 ENV 없이도 동작. **CLI 경로(`lms ps` fallback 포함)는 위 1·2가 동시 충족되어야만 실행** — 비-loopback 클라이언트의 snapshot에서는 `lms ps` fallback도 발동되지 않음.

### 새 API 표

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/monitor/snapshot` | `{baseUrl, provider, apiKey?}` → 시스템/GPU/로드된 모델 (soft-fail) |
| GET | `/api/monitor/lms/availability` | `lms` 바이너리 가용 여부 + ENV/loopback 플래그 |
| POST | `/api/monitor/lms/load` | `{baseUrl, model}` → `lms load <model>` (hard 403) |
| POST | `/api/monitor/lms/unload` | `{baseUrl, model}` → `lms unload <model>` (hard 403) |
| POST | `/api/monitor/lms/native/{list,load,unload}` | `{baseUrl, model?, apiKey?}` → LM Studio **네이티브 REST**(`/api/v1/models{,/load,/unload}`) 프록시(원격-안전, CLI 무관). loopback은 항상 허용, 원격은 `STRICT_LOCALHOST=0` + 유효 `BENCH_API_KEYS` 키 필요 |
| GET | `/api/monitor/lms/log-stream` | `?baseUrl=...` → `lms log stream` SSE proxy (1:1 lock, 409 busy) |

### 보안 메모

- 모델 ID는 `^[A-Za-z0-9._\-/:]+$` ASCII만 허용 — 한글·이모지·shell metachar 차단(v1 단순화)
- `execFile`만 사용(shell 미경유) + `lms` 하위 명령은 allowlist(`ps`/`server status`/`load`/`unload`/`log stream`)
- `load` 120s timeout, `unload` 15s, `ps`/`availability` 등 5s
- 라우트는 body·apiKey·baseUrl을 로그에 남기지 않음
- `baseUrl` 파라미터는 **localhost 검증용**일 뿐 CLI 인자로 전달되지 않음 — 실제 `lms`는 항상 서버 호스트의 LM Studio를 제어
- **원격-안전 네이티브 프록시(`/monitor/lms/native/*`)**: `lms` CLI 대신 LM Studio 자체 REST(`/api/v1/models{,/load,/unload}`)로 포워딩하므로 원격 호스트 관리가 가능. 게이트는 loopback **또는** (`STRICT_LOCALHOST=0` **그리고** 유효한 `BENCH_API_KEYS` 키) — 키 없이 `STRICT_LOCALHOST=0`이면 401, 기본(미설정/`1`)은 `403 remote_not_loopback`으로 잠금. LM Studio 오류(bad instance_id·도달 불가)는 `502`로 상위 status·본문을 그대로 노출. CLI 경로(`lms/load`·`lms/unload`)는 **손대지 않고** 로컬 기본으로 유지. `apiKey`는 URL이 아닌 body로 받아 로그·쿼리스트링 누출을 방지

### Docker Compose 동작 매트릭스

Compose API 이미지(`node:24-bookworm-slim`)에는 `nvidia-smi`·`lms`가 들어있지 않고, 브라우저 → nginx → API 컨테이너 경유 시 **클라이언트 IP가 docker bridge IP**(`172.x.x.x`)라 loopback이 아님.

- snapshot/availability: **200 soft-fail** (`system`/`gpu`는 null, provider HTTP는 시도)
- load/unload/log-stream: **403 hard fail**
- 즉 Compose에서는 **provider HTTP 정보 카드만 동작** — system/gpu/CLI는 차단됨이 정상
- Compose에서 host의 LM Studio/Ollama에 닿으려면 baseUrl을 `http://host.docker.internal:1234`(Ollama: `:11434`)로 두고, 호스트가 Linux면 `docker-compose.yml`의 `api` 서비스에 `extra_hosts: ["host.docker.internal:host-gateway"]`를 추가하거나 호스트 LAN IP를 직접 사용
- 풀 기능(GPU/CLI)은 **단일 호스트 PM2** 또는 **`pnpm dev`로 같은 머신**에서만 활성

### `pnpm dev`(Vite proxy) 보안 주의

Vite가 기본 `host:true`라 LAN 사용자가 `http://<dev-host>:21xxx`로 접속해도 API 입장의 클라이언트는 Vite proxy(127.0.0.1)로 보입니다 — **loopback 게이트 우회 가능**. 서버 시작 시 `ENABLE_LMS_CLI=1`이면 stderr에 경고를 1회 출력합니다. 권장: (a) Vite `host:false`, (b) 방화벽으로 dev 포트 차단, (c) `ENABLE_LMS_CLI`는 운영 머신에서만 사용. `ENABLE_LMS_CLI`가 비어 있으면 경고 출력도 없습니다(CLI 호출이 차단되므로).

### 비스코프(v2)

`lms load` 진행도 SSE / log stream fan-out N:N / Metal GPU / 모델 캐시 디렉토리 디스크 사용량 / `lms ls` + prompt-driven 모델 선택 / 원격 API용 escape hatch(`TRUST_PROXY_FOR_LOOPBACK`) / nvidia-smi 백그라운드 데몬 / NVML 네이티브 바인딩 / load/unload 서버 mutex / snapshot SSRF throttle / 위젯용 경량 snapshot(`?fields=`) / Compose 자동 host.docker.internal UI 안내.

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

1. 서버에 Node 24.x·pnpm·PM2 설치 후 저장소 클론.
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

또는 한줄인 경우
```bash
git pull && pnpm install && pnpm build && pm2 reload ecosystem.config.cjs
```

`reload`는 무중단에 가깝게 프로세스를 교체합니다. 환경을 바꿨다면 `pm2 delete llm-bench` 후 다시 `pm2 start ecosystem.config.cjs`를 쓰거나 `pm2 reload ecosystem.config.cjs --update-env`로 반영합니다. 부팅 시 자동 기동은 `pm2 startup` + `pm2 save`입니다.

### 트러블슈팅

- **SQLite 사용 불가 토스트가 뜬다**: API가 DB 파일을 열지 못한 상태입니다. 파일 경로(`BENCH_DB_PATH` 또는 `apps/server/data/bench.sqlite`)·권한(쓰기 가능)·잠금(`*-wal`/`*-shm` 사이드카가 다른 프로세스에 잡혀 있지 않은지)을 확인하세요. 원인을 해소한 뒤에도 토스트가 계속 보이면 **API 프로세스를 재시작**해야 합니다 (열기 결과를 프로세스 생애 동안 캐시).
- **`node:sqlite` 안정성**: Node 24에서 플래그 없이 동작하지만 stability는 아직 RC(`ExperimentalWarning` 출력). 동작은 안정적이나 Node 마이너 업그레이드 시 API 미세 변경 가능성을 인지하세요. Node 메이저 핀(`.nvmrc`/`engines`)으로 가드합니다.

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
| POST | `/api/stress/stream` | 프로바이더 stress 벤치 실행, **SSE**로 stage·worker 이벤트 |
| GET | `/api/stress/runs` | stress 런 목록(필터: `workload_id`/`status`/`model_id`/`base_url`, cursor: `before`+`before_id`, `limit`≤200) |
| GET | `/api/stress/runs/:runId` | stress 런 상세(meta + stages) |
| DELETE | `/api/stress/runs/:runId` | stress 런 + 단계 결과 영구 삭제 (FK CASCADE) |
| POST | `/api/monitor/snapshot` | provider 모니터 스냅샷(시스템/GPU/로드된 모델) — 클라이언트가 비-loopback이면 soft-fail |
| GET | `/api/monitor/lms/availability` | `lms` 바이너리 가용 여부 + ENV/loopback 플래그 |
| POST | `/api/monitor/lms/load` | LM Studio 모델 로드 (`lms load`) — loopback + ENV 필요 (hard 403) |
| POST | `/api/monitor/lms/unload` | LM Studio 모델 언로드 (`lms unload`) — 동일 |
| POST | `/api/monitor/lms/native/{list,load,unload}` | LM Studio 네이티브 REST 프록시(원격-안전, CLI 무관) — loopback 또는 `STRICT_LOCALHOST=0`+유효 `BENCH_API_KEYS` 키. LM Studio 오류는 502로 상위 status·본문 노출 |
| GET | `/api/monitor/lms/log-stream` | `lms log stream` SSE proxy — 1:1 lock (409 busy) |

SQLite를 열 수 없을 때는 벤치 스트림은 진행되나 디스크 저장·히스토리 API가 비활성화될 수 있습니다. 응답에 `sqlite_available` / `sqlite_error` 등이 포함됩니다.

## AI 에이전트 연동 (API v1 · MCP)

AI 에이전트가 이 서비스를 프로그래밍적으로 쓸 수 있도록 **버전드 API(`/api/v1`)** + **OpenAPI 문서** + **MCP 서버**(`apps/mcp`, `@llm-bench/mcp`)를 제공합니다.

- **버전드 표면**: 위 모든 라우트가 `/api/v1/*`에도 동일하게 제공됩니다. 웹 UI 호환을 위해 레거시 `/api/*`도 유지됩니다. 에이전트/외부 클라이언트는 **`/api/v1`을 사용**하세요.
- **에이전트용 신규 엔드포인트**:

  | 메서드 | 경로 | 설명 |
  |--------|------|------|
  | GET | `/api/v1/scenarios?set=public\|default\|vision\|agent\|custom\|all` | 시나리오 카탈로그(메타·프롬프트 포함, DB 무관). `set=agent`=멀티턴 **agent_loop**(mock-tool 하네스), `set=custom`=사용자 등록 시나리오 |
  | POST | `/api/v1/scenarios` | **#83 커스텀 시나리오 등록**(system·user·tools·sampling·api_route·judge 루브릭). zod 검증 실패 시 4xx+필드 에러. 등록 후 built-in과 동일하게 `/bench/stream`·`/runs`·`/scoreboard`로 흐름. 도구는 mock-only |
  | DELETE | `/api/v1/scenarios/:id` | 커스텀 시나리오 삭제(레지스트리+DB) |
  | GET | `/api/v1/catalog` | 시나리오 + 프로파일 + 스트레스 워크로드 한 번에 |
  | GET | `/api/v1/scoreboard?baseUrl=&modelIds=&task=coding\|vision\|tools\|structured\|chat\|agent` | 저장된 최신 런 기반 **서버 사이드 랭킹**(품질·속도). 응답의 `leaks[]`(모델×라우트 누수/정체, agent 제외)와 `agent_metrics[]`(#105 멀티턴 에이전트 능력: 완료율·과업 벽시계·인자 충실도·출력 효율) 포함 — "X에 어떤 모델이 최고?" |
  | GET | `/api/v1/compare?runA=&runB=` (또는 `modelA=&modelB=&baseUrl=`) | **#84 회귀 diff** — per-scenario TTFT p50/p95·TPS·품질·정체/누수 델타 + `regression` 플래그(임계 override: `qualityDropAbs`·`tpsRegressionPct`·`ttftRegressionPct`·`flagNewEmptyTurns`). 헤드리스 게이트는 `llm-bench-compare` CLI(`--fail-on-regression`·`--webhook`) |
  | GET | `/api/v1/openapi.json` | OpenAPI 3.1 스펙(Zod 스키마에서 생성) |
  | GET | `/api/v1/docs` | 자립형(오프라인) API 레퍼런스 |

- **인증(opt-in)**: `BENCH_API_KEYS`(콤마 리스트)를 설정하면 `/api/*`에 인증이 켜집니다. 자격증명은 **`Authorization: Bearer <key>`** 또는 **`x-api-key: <key>`** 헤더. 미설정 시 인증 없음(현행 UX). `/api/health`·`OPTIONS`·루프백은 면제(`BENCH_TRUST_LOOPBACK=0`으로 루프백 면제 해제). 리버스 프록시 뒤(도커/nginx)에서는 `BENCH_TRUST_PROXY=1`로 `X-Forwarded-For`/`X-Real-IP`를 신뢰해야 웹 UI가 401 없이 통과합니다.
- **두 종류의 키(혼동 금지)**: **provider `apiKey`**(요청 body, 벤치 대상 LLM 인증)와 **bench 서버 키**(`BENCH_API_KEYS`, 헤더, 이 API 인증)는 별개입니다. MCP는 후자를 `Authorization` 헤더로 보내고, 전자는 도구 인자로 받아 body에 실어 전달합니다.

### MCP 서버

벤치 API를 프록시하는 얇은 MCP 서버로 **stdio**(데스크톱 클라이언트가 spawn)와 **streamable-HTTP**(원격) 트랜스포트를 모두 지원합니다. 도구: `list_scenarios`, `list_capabilities`, `detect_provider`, `run_bench`, `run_stress`, `compare_models`, `list_runs`, `get_run`, `monitor_snapshot`, `health`.

- 순서: `detect_provider`(먼저) → `run_bench`. `run_bench`는 `detect`를 넘기지 않으면 내부적으로 감지합니다. 진행은 MCP progress 알림으로 전달되고, `run_bench`는 token 스트림을 버린 **compact 요약**(시나리오별 TTFT/TPS/품질 + 랭킹 롤업)을 반환합니다.
- `/bench/stream`은 클라이언트 abort 후에도 서버에서 끝까지 실행되므로, 타임아웃 시 `run_bench`는 `GET /api/v1/runs/{runId}`로 결과를 회수하고 `serverKeepsRunning: true`를 표시합니다.

**stdio (Claude Desktop / Claude Code `.mcp.json`)**

```jsonc
{
  "mcpServers": {
    "llm-bench": {
      "command": "node",
      "args": ["/path/to/llm-model-bench/apps/mcp/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "BENCH_API_URL": "http://127.0.0.1:20080",
        "BENCH_API_KEY": "<선택: bench 서버 키>"
      }
    }
  }
}
```

**streamable-HTTP** — 서버 기동: `MCP_TRANSPORT=http MCP_PORT=20090 BENCH_API_URL=http://127.0.0.1:20080 node apps/mcp/dist/index.js`

```jsonc
{
  "mcpServers": {
    "llm-bench": {
      "type": "http",
      "url": "http://127.0.0.1:20090/mcp",
      "headers": { "Authorization": "Bearer <MCP_HTTP_TOKEN(설정 시)>" }
    }
  }
}
```

로컬 개발은 `DEV_WITH_MCP=1 pnpm dev`로 서버·웹과 함께 MCP(http, 기본 포트 22090)를 띄울 수 있습니다.

**MCP 환경 변수**

| 변수 | 설명 |
|------|------|
| `BENCH_API_URL` | 프록시할 벤치 API base (기본 `http://127.0.0.1:20080`) |
| `BENCH_API_VERSION` | 버전 접두 (기본 `/api/v1`) |
| `BENCH_API_KEY` | bench 서버 인증 키 → `Authorization: Bearer`로 전송 |
| `MCP_TRANSPORT` | `stdio`(기본) \| `http` (CLI `--stdio`/`--http`로 override) |
| `MCP_HTTP_HOST` / `MCP_PORT` | http 바인드 (기본 `127.0.0.1` / `20090`) |
| `MCP_HTTP_TOKEN` | http 엔드포인트(agent→MCP) bearer. 비루프백 노출 시 필수 |
| `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS` | DNS-rebinding 방어(Host/Origin 허용 목록) |
| `BENCH_HTTP_TIMEOUT_MS` | run_bench/run_stress 타임아웃(기본 900000) |

**프로바이더 통계 CSV 익스포트 컬럼** (총 26): `run_id`, `created_at`, `finished_at`, `base_url`, `provider`, `model_id`, `workload_id`, `status`, `stage_index`, `concurrency`, `duration_ms`, `enqueue_duration_ms`, `drain_ms`, `requests_attempted`, `requests_succeeded`, `output_tokens_total`, `aggregate_tps`, `tps_per_user`, `tps_unreliable`, `p50_ms`, `p95_ms`, **`ttft_p50`**, **`ttft_p95`**, `error_rate`, `tps_source`, `script_match_rate`. `p50_ms`/`p95_ms`는 총 요청 지연, `ttft_p50`/`ttft_p95`는 첫 토큰 도착 지연(stress_long_context* 등 prefill 워크로드에서만 채워짐). **인덱스 기반 외부 파서는 v1.x 업데이트로 깨질 수 있음** (`p95_ms` 뒤에 2 컬럼 신규 삽입).

## 비전 벤치 시나리오 (v1)

10개 시나리오(OCR / 카운팅 / 차트 / 밈 / 와이어프레임 × ChatGPT·Gemini 변형) — 기본 실행에서는 **opt-in**입니다.

- **자산**: `apps/web/public/vision/*.jpg` (원본은 `docs/vision_bench/`). 갱신: `pnpm prepare:vision` (1280px JPEG 변환 — OCR q92, 나머지 q88).
- **이미지 전달**: loopback/사설망 origin은 자동 base64 인라인(`data:image/jpeg;base64,...`), 공개 origin은 URL. `apps/server/src/vision-assets.ts` 단일 모듈.
- **채점 스케일**: 비전 시나리오는 0~3 루브릭 → `score ∈ {0, 0.33, 0.67, 1}`, pass는 `score >= 0.67`. 텍스트 시나리오는 대부분 0/1 이진 — *평균 score를 텍스트·비전 섞어 비교하면 해석이 어긋납니다.* pass rate 비교는 가능, raw score 평균 비교는 주의하세요.
- **LLM-as-Judge**: `LLM_JUDGE_ENABLED=1` + `ANTHROPIC_API_KEY` 설정 시 meme/wireframe 시나리오를 0~3으로 채점. 비활성 시 prefilter 통과 = rubric 1(pass: false). judge 실패(timeout/parse/network)는 rubric 0.
- **비용 안내**: 비전 + judge 조합은 judge 호출 비용이 `모델 수 × judge 대상 시나리오 수`로 누적됩니다. 비교 평가 외에는 작은 모델 집합으로 시작하세요. warmup 단계는 텍스트 시나리오만 실행됩니다.
- **비전 미지원 모델**: 400/거부 시 결과는 `pass: false, score: 0`로 기록됩니다.
- **max_tokens 정책 (v1.3+)**: 비전 시나리오는 종류별 *floor*가 적용됩니다 — chart/OCR/counting 2048, meme 1024, wireframe 4096. 사용자가 UI에서 `max_tokens` 또는 프로파일 `max_tokens`로 더 큰 값을 설정하면 그 값이 우선합니다 (reasoning 모델용으로 4096+ 권장). `BenchRequest.max_tokens`·`profileMaxTokens`·비전 default 세 source 중 가장 큰 값이 실제 호출에 사용됩니다.
- **잘림 라벨링**: upstream이 `finish_reason: "length"` (OpenAI 호환) 또는 `stop_reason: "max_tokens"` (Anthropic)을 돌려주면 `quality.reason`에 `truncated_at_max_tokens=N | ...` prefix가 붙어 결과 표·드로어에서 잘림을 인지할 수 있습니다. 일부 LM Studio/vLLM 빌드는 `finish_reason`을 보내지 않아 prefix 없이 출력만 잘린 채 기록될 수 있습니다.
- **reasoning 제어 (Gemma 4 · Qwen 3.5/3.6 · Nemotron 3)**: 프로파일의 "사고(thinking) 의도 = 끄기"는 요청에 `extra_body.chat_template_kwargs.enable_thinking: false`로 실립니다. reasoning trace가 길어 위 max_tokens floor에서도 잘림이 잦은 모델은 thinking off + 잘림 라벨링으로 같이 진단하세요. LM Studio 백엔드가 `chat_template_kwargs`를 그대로 vLLM에 전달해야 효력이 발생합니다.
- **사고 블록 strip**: 채점·UI는 `stripThinkingBlocks`로 인라인 추론(Gemma channel, Qwen redacted, GLM 닫는 태그만 등)을 제거합니다. 패턴·패밀리별 노트는 웹 [`/profile`](/profile)([`#thinking-block-strip`](/profile#thinking-block-strip), [`#lmstudio-host`](/profile#lmstudio-host)) 또는 `LLM_PROFILE.md`를 참고하세요.
- **LM Studio 트러블슈팅**: 구버전 자산(`.webp`)으로 실행하면 `'url' field must be a base64 encoded image.` 400을 받습니다. `pnpm prepare:vision`을 한 번 실행해 JPEG로 재생성한 뒤 서버를 재시작하세요(메모리 캐시 무효화).
- **LM Studio Jinja 템플릿 크래시 (Anthropic `/v1/messages` + tools)**: 특정 모델(`nvidia/nemotron-3-nano*`, `google/gemma-4-*`)은 도구 시나리오의 `messages` 라우트에서 `Error rendering prompt with jinja template`로 응답이 비어 실패합니다. 원인·진단·해결(호스트에서 도는 템플릿 오버라이드 스크립트 [`scripts/fix-nemotron-lmstudio-template.sh`](scripts/fix-nemotron-lmstudio-template.sh) / [`scripts/fix-gemma4-lmstudio-template.sh`](scripts/fix-gemma4-lmstudio-template.sh))은 [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) 및 웹 [`/profile#lmstudio-host`](/profile#lmstudio-host) 참고.
- **LM Studio 엔진 프로토콜 회귀 (도구 인자 손상·추론 누수)**: `Use LM Studio Engine Protocol`이 켜진 0.4.14~0.4.18 베타 런타임은 스트리밍 `tool_calls` 인자를 손상시키거나(#1922) 추론을 응답 content로 누수시킵니다(0.4.19에서 수정). 결과 표·상세에 ⚠ 배지(`tool_call_args_corrupted`·`reasoning_leaked_into_content`)로 감지되며, **LM Studio를 0.4.19+로 올리거나** 옵션을 끄고 재측정하세요. 상세: [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) 및 웹 [`/profile#lmstudio-host`](/profile#lmstudio-host).

## 테스트

```bash
pnpm test
```

`@llm-bench/server`, `@llm-bench/shared`, `@llm-bench/web`(monitor-polling/persisted-settings/tps-tier/stress-export) — vitest. E2E는 [`tests/e2e/`](tests/e2e/)에서 Playwright로 실행합니다.

## 환경 변수 (서버)

| 변수 | 설명 |
|------|------|
| `PORT` | API·(설정 시) 정적 UI 리스닝 포트(기본 **20080**, `pnpm dev`에서는 `dev-ports.json`/`DEV_SERVER_PORT`가 우선) |
| `BENCH_DB_PATH` | SQLite 파일 경로(미지정 시 `data/bench.sqlite`, **프로세스 cwd** 기준) |
| `WEB_DIST_PATH` | Vite 빌드 출력 디렉터리(`index.html` 포함). 설정 시 같은 프로세스에서 `/`·`/assets/*` 등을 서빙하고, 그 외 GET은 SPA용으로 `index.html`을 돌려줍니다(**프로세스 cwd** 기준 상대 경로 가능) |
| `ENABLE_LMS_CLI` | `1`일 때만 `lms` CLI 호출 활성 (load/unload/log-stream + snapshot의 `lms ps` fallback). 기본 off. 활성 시 서버 시작 시 stderr 경고 출력 |
| `LMS_BIN` | `lms` 바이너리 경로 (기본 `lms`, PATH 검색) |
| `LLM_JUDGE_ENABLED` | `1`/`true`일 때만 비전 시나리오의 LLM-as-Judge(`vision_meme_explain_*` / `vision_wireframe_html_*`) 호출. 기본 off — prefilter 통과 시 rubric 1(`pass: false`)로 기록 |
| `LLM_JUDGE_MODEL` | judge 모델 ID (기본 `claude-opus-4-7`) |
| `ANTHROPIC_API_KEY` | judge 호출에 필요(현재 Anthropic Messages만 지원) |
| `BENCH_API_KEYS` | 콤마 리스트. 설정 시 `/api/*` 인증 활성(`Authorization: Bearer` / `x-api-key`). 미설정 시 인증 없음 |
| `BENCH_TRUST_LOOPBACK` | `0`이면 루프백 면제 해제(엄격 잠금). 기본 `1` |
| `STRICT_LOCALHOST` | `0`이면 원격 클라이언트가 유효한 `BENCH_API_KEYS` 키로 네이티브 LM Studio 모델 관리(`/monitor/lms/native/{list,load,unload}`)를 쓸 수 있음. 기본(미설정/`1`)은 loopback 전용(비-loopback은 `403 remote_not_loopback`). `0`으로 열려면 `BENCH_API_KEYS` 설정 필수(없으면 401) |
| `BENCH_TRUST_PROXY` | `1`이면 신원 판정에 `X-Forwarded-For`/`X-Real-IP`(마지막 hop) 신뢰 — 리버스 프록시 뒤에서만 켤 것. 기본 off |
| `BENCH_CORS_ORIGINS` | 콤마 리스트. CORS 허용 origin(기본 `*`) |

인증은 **opt-in**입니다(위 `BENCH_API_KEYS`). 이 키는 벤치 대상 provider `apiKey`(요청 body)와 별개이며, 미들웨어는 헤더만 읽고 업스트림으로 포워딩하지 않습니다.

## 하네스 노하우

벤치/스트레스 하네스의 설계·기법(멀티 프로바이더 추상화, 스트리밍 TTFT/TPS 측정, contention 가드, memory-fit preflight, agent loop, stress ramp, 회귀 비교 등)을 다른 프로젝트가 참고할 수 있게 한/영 병기로 정리한 문서가 [`docs/harness-knowhow.md`](docs/harness-knowhow.md)에 있습니다. 웹 UI에서는 헤더의 **하네스** 탭(`/harness`)으로도 볼 수 있습니다.

## 디자인

UI 토큰·톤은 루트 [`DESIGN.md`](DESIGN.md)를 따릅니다.

## 라이선스

- 본 프로젝트 코드는 [MIT](LICENSE) 라이선스를 따릅니다.
- 번역 시나리오에 포함된 PDF 등 제3자 리소스는 각 원저작물의 권리/배포 조건을 따를 수 있으므로, 배포 시 별도 확인이 필요합니다.
