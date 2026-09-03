import { z } from "zod";
import {
  BaseUrlNameInputSchema,
  BenchQueueSnapshotSchema,
  BenchQueueStartBodySchema,
  BenchQueueStreamEventSchema,
  BenchResultSchema,
  BenchRunMetaSchema,
  BenchStreamBodySchema,
  CompareResponseSchema,
  CustomScenarioInputSchema,
  DetectBodySchema,
  DetectResultSchema,
  MonitorSnapshotResponseSchema,
  ScenarioCatalogResponseSchema,
  ScoreboardResponseSchema,
  StressRampConfigSchema,
  StressStreamBodySchema,
  StreamEventSchema,
} from "@llm-bench/shared";

/**
 * 옵션 (c): 기존 @llm-bench/shared Zod 스키마에서 OpenAPI 3.1 문서를 직접 생성한다.
 * Zod 4의 native `z.toJSONSchema()`를 쓰므로 런타임 신규 의존성이 없고, 라우트를 새 DSL로
 * 다시 쓸 필요도 없다. `paths`는 ~15개라 수기 작성, `components.schemas`만 스키마에서 변환한다.
 */

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete js.$schema; // OpenAPI components는 per-schema $schema를 원치 않음
  return js;
}

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(schemaName: string, description: string) {
  return {
    description,
    content: { "application/json": { schema: ref(schemaName) } },
  };
}

/**
 * SSE 응답 표현 — OpenAPI에 스트리밍 네이티브 모델이 없으므로 body는 string으로 두고,
 * 이벤트 payload 스키마는 `x-sse-event-schema`로 컴포넌트를 참조한다(에이전트가 파싱 가능).
 */
function sseResponse(eventSchemaName: string, description: string) {
  return {
    description,
    content: {
      "text/event-stream": {
        schema: {
          type: "string",
          description: `SSE 프레임: 각 이벤트는 \`data: <json>\\n\\n\`. <json>은 ${eventSchemaName}.`,
        },
        "x-sse-event-schema": ref(eventSchemaName),
      },
    },
  };
}

const badRequest = { description: "잘못된 요청(Zod 검증 실패 등)" };

let cached: object | null = null;

export function buildOpenApiSpec(): object {
  if (cached) return cached;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "llm-model-bench API",
      version: "v1",
      description:
        "로컬/사내망 LLM(LM Studio·Ollama·OpenAI 호환) 벤치마킹 서비스의 안정 API 표면(v1).\n\n" +
        "주의: 여기서 말하는 `apiKey`(요청 body)는 **벤치 대상 provider(LLM)** 인증용이며, " +
        "이 API 자체의 인증(opt-in)은 `Authorization: Bearer` / `x-api-key` 헤더(`BENCH_API_KEYS`)로 별개다. " +
        "`/bench/stream`은 클라이언트 abort를 무시하고 서버에서 끝까지 실행된다(결과는 `GET /runs/{runId}`로 회수). " +
        "여러 모델은 `/bench/stream` 반복 호출이 아니라 서버 소유 큐(`POST /bench/queue`)로 돌린다 — " +
        "런 단위 pause/resume/stop은 큐가 아니라 **그 모델 하나**에만 걸린다.",
    },
    servers: [{ url: "/api/v1", description: "버전드 안정 표면" }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    tags: [
      { name: "discovery", description: "provider·모델·시나리오 탐색" },
      { name: "bench", description: "벤치·스트레스 실행(SSE)" },
      { name: "results", description: "저장된 런·스코어보드" },
      { name: "monitor", description: "시스템·GPU·로드된 모델" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["discovery"],
          summary: "라이브니스",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
      "/detect": {
        post: {
          tags: ["discovery"],
          summary: "provider 감지 + 모델 목록(먼저 실행)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("DetectBody") } },
          },
          responses: {
            "200": jsonResponse("DetectResult", "감지된 provider·모델·capability"),
            "400": badRequest,
          },
        },
      },
      "/scenarios": {
        get: {
          tags: ["discovery"],
          summary: "시나리오 카탈로그",
          parameters: [
            {
              name: "set",
              in: "query",
              schema: { type: "string", enum: ["public", "default", "vision", "agent", "custom", "all"] },
              description: "기본 public. agent=멀티턴 agent_loop, custom=사용자 등록 시나리오",
            },
          ],
          responses: { "200": jsonResponse("ScenarioCatalogResponse", "시나리오 서술 목록") },
        },
        post: {
          tags: ["discovery"],
          summary: "#83 커스텀 시나리오 등록(system·user·tools·sampling·api_route·judge 루브릭)",
          description:
            "zod 검증(CustomScenarioInput) 실패 시 400 + 필드 에러. 등록 후 built-in과 동일하게 /bench/stream·/runs·/scoreboard로 흐른다. 도구는 mock-only(agent_loop면 모든 선언 도구에 mock 필요).",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScenarioInput" } } } },
          responses: {
            "201": { description: "등록된 시나리오 descriptor" },
            "400": badRequest,
            "409": { description: "too_many_custom_scenarios" },
          },
        },
      },
      "/scenarios/{id}": {
        delete: {
          tags: ["discovery"],
          summary: "#83 커스텀 시나리오 삭제",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" }, "404": { description: "not_found" } },
        },
      },
      "/catalog": {
        get: {
          tags: ["discovery"],
          summary: "시나리오 + 프로파일 + 스트레스 워크로드",
          responses: { "200": { description: "capabilities 한 번에" } },
        },
      },
      "/scoreboard": {
        get: {
          tags: ["results"],
          summary: "서버 사이드 랭킹(품질·속도) — '어떤 모델이 X에 최고?'",
          parameters: [
            { name: "baseUrl", in: "query", required: true, schema: { type: "string" } },
            {
              name: "modelIds",
              in: "query",
              schema: { type: "string" },
              description: "콤마 목록. 생략 시 이 baseUrl의 모든 최신 런",
            },
            {
              name: "task",
              in: "query",
              schema: { type: "string", enum: ["coding", "vision", "tools", "structured", "chat", "agent"] },
              description: "시나리오 필터",
            },
          ],
          responses: {
            "200": jsonResponse(
              "ScoreboardResponse",
              "랭킹된 모델 행 + 모델×라우트 누수/정체 지표(leaks[]: thinking_leak_ratio·empty_turn_rate·channel_tag_leak)",
            ),
            "400": badRequest,
          },
        },
      },
      "/compare": {
        get: {
          tags: ["results"],
          summary: "#84 런/모델 회귀 diff — per-scenario TTFT p50/p95·TPS·품질·정체/누수 델타 + regression 플래그",
          description:
            "runA&runB(명시) 또는 modelA&modelB&baseUrl(각 최신 런 해석). 임계 override: qualityDropAbs·tpsRegressionPct·ttftRegressionPct·flagNewEmptyTurns.",
          parameters: [
            { name: "runA", in: "query", schema: { type: "string" } },
            { name: "runB", in: "query", schema: { type: "string" } },
            { name: "modelA", in: "query", schema: { type: "string" } },
            { name: "modelB", in: "query", schema: { type: "string" } },
            { name: "baseUrl", in: "query", schema: { type: "string" } },
            { name: "qualityDropAbs", in: "query", schema: { type: "number" } },
            { name: "tpsRegressionPct", in: "query", schema: { type: "number" } },
            { name: "ttftRegressionPct", in: "query", schema: { type: "number" } },
            { name: "flagNewEmptyTurns", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": jsonResponse("CompareResponse", "per-scenario 델타 + regression 요약"),
            "400": badRequest,
            "404": { description: "run_not_found" },
          },
        },
      },
      "/bench/stream": {
        post: {
          tags: ["bench"],
          summary: "모델 1건 벤치 실행(SSE). 클라이언트 abort 무시 — 서버에서 끝까지 실행",
          description:
            "여러 모델을 순차로 돌리려면 이 엔드포인트를 반복 호출하지 말고 `POST /bench/queue`를 써라 — " +
            "큐가 서버 소유라 탭을 닫아도 끝까지 진행되고, 큐↔단발이 서로를 막아 같은 GPU에서 겹치지 않는다. " +
            "다만 **`/bench/stream` 두 건이 동시에 도는 것은 막지 않는다**(MCP의 타임아웃 후 재호출 흐름을 " +
            "유지하기 위해 남겨 둔 한계) — 단발끼리 겹치지 않게 하는 건 호출자 책임이다.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("BenchStreamBody") } },
          },
          responses: {
            "200": sseResponse("StreamEvent", "StreamEvent SSE 스트림"),
            "400": badRequest,
            "409": {
              description:
                "queue_active — 같은 baseUrl에서 서버 소유 벤치 큐가 실행 중이라 거부됐다. " +
                "겹쳐 돌면 에러가 아니라 조용한 측정 오염이 되므로, 큐가 끝나길 기다리거나 " +
                "`POST /bench/queue/{queueId}/stop`으로 큐를 정지한 뒤 다시 시도하라. " +
                "락 키는 정규화된 **`detect.baseUrl`**(실제 추론 대상)이다 — `bench.baseUrl`이 아니므로 " +
                "그쪽만 바꿔서는 락을 피할 수 없다. " +
                "반대로 활성 *단발* 런은 이 엔드포인트를 막지 않는다: `/bench/stream` 두 건의 동시 실행은 " +
                "여전히 허용된다(MCP의 타임아웃 후 재호출 흐름을 유지하기 위한 의도된 한계).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["error", "base_url", "queue_id"],
                    properties: {
                      error: { type: "string", const: "queue_active" },
                      message: { type: "string" },
                      base_url: { type: "string" },
                      queue_id: { type: "string" },
                      model_id: {
                        type: ["string", "null"],
                        description:
                          "큐가 지금 실행 중인 모델. 모델 경계·일시정지 중이면 null이다 — " +
                          "직전에 끝난 모델을 현재로 보고하지 않는다.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/bench/{runId}/pause": {
        post: {
          tags: ["bench"],
          summary: "실행 중인 벤치 런을 일시정지(다음 이터레이션 체크포인트에서 반영)",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 런" },
          },
        },
      },
      "/bench/{runId}/resume": {
        post: {
          tags: ["bench"],
          summary: "일시정지된 벤치 런을 재개 — 큐 실행 중이면 이 모델의 pause만 푼다",
          description:
            "**큐 실행 중에는 이 모델의 pause만 풀리고 큐는 다음 모델 경계에서 다시 멈춘다** — " +
            "큐가 일시정지 상태인 한 모델 하나를 재개해도 큐 전체는 재개되지 않는다. " +
            "큐 재개는 `POST /bench/queue/{queueId}/resume`.",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 런" },
          },
        },
      },
      "/bench/{runId}/stop": {
        post: {
          tags: ["bench"],
          summary: "실행 중인 벤치 런을 긴급 정지(진행 중 요청 포함 즉시 중단, 재개 불가). " +
            "HTTP 연결 종료(새로고침 등)와 무관한 명시적 컨트롤 — 연결이 끊겨도 런은 계속 실행되므로, " +
            "정지하려면 반드시 이 엔드포인트를 호출해야 한다.",
          description:
            "**큐 실행 중에는 이 모델만 취소되고 큐는 다음 모델로 진행한다** — 모델 하나를 버리고 " +
            "나머지를 계속 돌리고 싶을 때만 쓴다. 큐 전체 정지는 `POST /bench/queue/{queueId}/stop`.",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 런" },
          },
        },
      },
      "/bench/running": {
        get: {
          tags: ["bench"],
          summary: "현재 서버에서 진행 중인 벤치 런 + 큐 목록(새로고침 후 재연결 대상 탐색용). " +
            "baseUrl 쿼리로 좁힐 수 있다.",
          description:
            "응답은 `{ runs, queues }` 두 축이다. `runs`는 지금 실행 중인 런만 담지만, " +
            "`queues`에는 TTL(30분) 안에 **완료된 큐도 포함**된다 — 마지막 모델이 끝난 직후 새로고침한 탭도 " +
            "모델별 `run_id` 목록을 받아야 결과를 DB에서 복원할 수 있기 때문이다. " +
            "정렬은 실행 중 큐가 항상 앞(created_at 내림차순), 그 뒤에 완료 큐(finished_at 내림차순)다. " +
            "큐의 status로 재연결(`/bench/queue/{queueId}/reconnect`)과 DB 복원 중 무엇을 할지 갈라라.",
          parameters: [{ name: "baseUrl", in: "query", schema: { type: "string" } }],
          responses: {
            "200": {
              description:
                "{ runs: [{ run_id, base_url, model_id, provider, started_at, paused, plan?, queue_id? }], " +
                "queues: BenchQueueSnapshot[] }",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["runs", "queues"],
                    properties: {
                      runs: { type: "array", items: { type: "object" } },
                      queues: { type: "array", items: ref("BenchQueueSnapshot") },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/bench/{runId}/reconnect": {
        get: {
          tags: ["bench"],
          summary: "진행 중인 벤치 런에 재구독(SSE). /bench/stream과 달리 새 런을 시작하지 않고 " +
            "기존 런의 라이브 이벤트를 받는다 — 연결 즉시 지금까지의 버퍼링된 이벤트를 replay한다.",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": sseResponse("StreamEvent", "StreamEvent SSE 스트림(버퍼링된 replay + 라이브)"),
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 런" },
          },
        },
      },
      "/bench/queue": {
        post: {
          tags: ["bench"],
          summary: "여러 모델을 서버가 순차 실행하는 큐를 시작(SSE). 클라이언트는 구독자일 뿐",
          description:
            "`/bench/stream`을 모델마다 반복 호출하는 대신 이걸 쓴다: 큐를 **서버가 소유**하므로 " +
            "탭을 닫거나 새로고침해도 끝까지 진행된다. " +
            "직렬 실행 락은 정규화된 **`detect.baseUrl`**(실제 추론 대상, `bench.baseUrl`이 아니다)을 키로 " +
            "**양방향**으로 걸린다 — 활성 큐가 있으면 새 큐도 `/bench/stream`도 409고, " +
            "**같은 baseUrl에 진행 중인 단발 `/bench/stream` 런이 있어도 거부된다: " +
            "큐 시작은 그 백엔드가 완전히 비었을 때만 허용한다.** " +
            "막히지 않는 조합은 하나뿐이다 — `/bench/stream` 두 건의 동시 실행(MCP의 타임아웃 후 " +
            "재호출 흐름을 유지하기 위해 남겨 둔 한계). " +
            "`bench`는 큐 전체가 공유하는 **의도**이며 `modelId`가 없다 — reasoning effort 두 칸" +
            "(`reasoningEffort`=gpt-oss 계열, `qwen38ReasoningEffort`=Qwen3.8 계열)을 함께 보내면 " +
            "서버가 모델마다 해석한다. 연결이 끊겨도 큐는 계속 돌므로, " +
            "`GET /bench/queue/{queueId}/reconnect`로 다시 붙고 정지는 반드시 stop 엔드포인트로 하라.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("BenchQueueStartBody") } },
          },
          responses: {
            "200": sseResponse(
              "BenchQueueStreamEvent",
              "BenchQueueStreamEvent SSE 스트림 — 모델별 StreamEvent 전부 + 큐 레벨 이벤트" +
                "(queue_started/queue_model_started/queue_model_finished/queue_paused/queue_resumed/queue_finished)",
            ),
            "400": badRequest,
            "409": {
              description:
                "사유가 두 가지이고 본문의 `error`로 갈린다. " +
                "**queue_active** — 같은 baseUrl에 이미 활성 큐가 있다. 본문 `{ error, queue }`의 " +
                "queue는 BenchQueueSnapshot이라 그 queue_id로 바로 재구독(`GET /bench/queue/{queueId}/reconnect`)하면 된다. " +
                "**run_active** — 같은 baseUrl에서 진행 중인 단발 `/bench/stream` 런이 있다(큐 시작은 그 백엔드가 " +
                "완전히 비었을 때만 허용한다). 아직 `run_started`를 내지 않은 런(감지·프리플라이트·모델 로드 중)도 " +
                "점유로 세므로, 그 구간에는 `run_id`·`model_id`가 null이다. run_id가 있으면 그것으로 " +
                "`GET /bench/{runId}/reconnect` 재구독하거나 `POST /bench/{runId}/stop`으로 세운 뒤 다시 시도하라. " +
                "두 검사 모두 락 키가 정규화된 **`detect.baseUrl`**(실제 추론 대상)이다 — `bench.baseUrl`이 아니므로 " +
                "그쪽만 바꿔서는 락을 피할 수 없다.",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      {
                        title: "queue_active",
                        description: "같은 baseUrl에 활성 큐가 있음",
                        type: "object",
                        required: ["error", "queue"],
                        properties: {
                          error: { type: "string", const: "queue_active" },
                          queue: ref("BenchQueueSnapshot"),
                        },
                      },
                      {
                        title: "run_active",
                        description: "같은 baseUrl에 진행 중인 단발 /bench/stream 런이 있음",
                        type: "object",
                        // run_started 전(감지·모델 로드 중)에 점유가 잡히면 아직 run_id가 없다.
                        required: ["error", "base_url", "run_id", "model_id"],
                        properties: {
                          error: { type: "string", const: "run_active" },
                          message: { type: "string" },
                          base_url: { type: "string" },
                          run_id: {
                            type: ["string", "null"],
                            description: "점유 중인 단발 런의 id. run_started 전이면 null",
                          },
                          model_id: {
                            type: ["string", "null"],
                            description: "그 런이 돌고 있는 모델. run_started 전이면 null",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/bench/queue/{queueId}": {
        get: {
          tags: ["bench"],
          summary: "큐 스냅샷(진행 인덱스·모델별 status·run_id·계획) 조회",
          description:
            "SSE 없이 현재 상태만 본다. 완료된 큐도 TTL(30분) 안에는 남아 있어, `status`가 finished/cancelled면 " +
            "재구독 대신 모델별 `run_id`로 `GET /runs/{runId}` 복원 경로를 타면 된다.",
          parameters: [{ name: "queueId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": jsonResponse("BenchQueueSnapshot", "큐 스냅샷"),
            "404": { description: "not_found — 존재하지 않거나 TTL(30분)이 지나 정리된 큐" },
          },
        },
      },
      "/bench/queue/{queueId}/reconnect": {
        get: {
          tags: ["bench"],
          summary: "진행 중인 큐에 재구독(SSE). 새 큐를 시작하지 않고 기존 큐의 라이브 이벤트를 받는다 — " +
            "연결 즉시 지금까지의 버퍼링된 이벤트를 replay한다.",
          description:
            "완료된 큐는 404다 — 클라이언트는 `GET /bench/queue/{queueId}` 스냅샷의 status를 보고 애초에 " +
            "여기로 오지 않고 DB 복원 경로를 탄다.",
          parameters: [{ name: "queueId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": sseResponse(
              "BenchQueueStreamEvent",
              "BenchQueueStreamEvent SSE 스트림(버퍼링된 replay + 라이브)",
            ),
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 큐" },
          },
        },
      },
      "/bench/queue/{queueId}/pause": {
        post: {
          tags: ["bench"],
          summary: "큐를 일시정지 — 진행 중인 모델은 이터레이션 체크포인트에서, 그 뒤로는 모델 경계에서 멈춘다",
          parameters: [{ name: "queueId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 큐" },
          },
        },
      },
      "/bench/queue/{queueId}/resume": {
        post: {
          tags: ["bench"],
          summary: "일시정지된 큐를 재개(진행 중이던 모델의 런도 함께 풀린다)",
          parameters: [{ name: "queueId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 큐" },
          },
        },
      },
      "/bench/queue/{queueId}/stop": {
        post: {
          tags: ["bench"],
          summary: "큐 전체를 긴급 정지 — 진행 중인 모델을 즉시 중단하고 남은 모델은 cancelled 처리(재개 불가). " +
            "HTTP 연결 종료(새로고침 등)와 무관한 명시적 컨트롤 — 연결이 끊겨도 큐는 계속 실행되므로, " +
            "정지하려면 반드시 이 엔드포인트를 호출해야 한다.",
          description:
            "모델 하나만 버리고 큐는 계속 돌리려면 대신 `POST /bench/{runId}/stop`을 쓴다.",
          parameters: [{ name: "queueId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ ok: true }" },
            "404": { description: "not_found — 존재하지 않거나 이미 종료된 큐" },
          },
        },
      },
      "/stress/stream": {
        post: {
          tags: ["bench"],
          summary: "프로바이더 스트레스(동시성 램프) 실행(SSE). abort 실제 동작",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("StressStreamBody") } },
          },
          responses: {
            "200": {
              description: "StressStreamEvent SSE 스트림 (`data: <json>\\n\\n`)",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "400": badRequest,
          },
        },
      },
      "/runs": {
        get: {
          tags: ["results"],
          summary: "최근 벤치 런 요약",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
          ],
          responses: { "200": { description: "런 요약 목록" } },
        },
      },
      "/runs/{runId}": {
        get: {
          tags: ["results"],
          summary: "벤치 런 상세",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": jsonResponse("BenchResult", "런 메타 + 시나리오별 측정 런"),
            "404": { description: "not_found" },
            "503": { description: "sqlite_unavailable" },
          },
        },
      },
      "/runs/latest-by-model": {
        get: {
          tags: ["results"],
          summary: "모델별 최신 finished 런",
          parameters: [
            { name: "baseUrl", in: "query", required: true, schema: { type: "string" } },
            { name: "modelIds", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "모델별 최신 런" }, "400": badRequest },
        },
      },
      "/stats/model-latest": {
        get: {
          tags: ["results"],
          summary: "(model, baseUrl)별 최신 finished 런 요약",
          responses: { "200": { description: "요약 목록" } },
        },
      },
      "/base-url-names": {
        get: {
          tags: ["results"],
          summary: "Base URL 별칭(이름 + 기기/스펙 메모) 목록",
          responses: {
            "200": { description: "{ items: [{ base_url, name, note }], sqlite_available }" },
          },
        },
        put: {
          tags: ["results"],
          summary: "Base URL 별칭 저장 — 이름 빈 값=별칭 제거, 비고 공백=메모 없음(전역 대체)",
          requestBody: { required: true, content: { "application/json": { schema: ref("BaseUrlNameInput") } } },
          responses: {
            "200": { description: "{ ok, base_url, name|null, note? }" },
            "400": badRequest,
            "503": { description: "sqlite_unavailable" },
          },
        },
      },
      "/stress/runs": {
        get: {
          tags: ["results"],
          summary: "스트레스 런 목록(필터·페이지네이션)",
          responses: { "200": { description: "스트레스 런 목록 + 필터 옵션" } },
        },
      },
      "/stress/runs/{runId}": {
        get: {
          tags: ["results"],
          summary: "스트레스 런 상세(meta + stages)",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "스트레스 런 상세" }, "404": { description: "not_found" } },
        },
        delete: {
          tags: ["results"],
          summary: "스트레스 런 삭제",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" }, "404": { description: "not_found" } },
        },
      },
      "/monitor/snapshot": {
        post: {
          tags: ["monitor"],
          summary: "시스템·GPU·로드된 모델 스냅샷",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["baseUrl", "provider"],
                  properties: {
                    baseUrl: { type: "string" },
                    provider: {
                      type: "string",
                      enum: ["lm_studio", "ollama", "openai_compatible", "manual"],
                    },
                    apiKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": jsonResponse("MonitorSnapshotResponse", "스냅샷") },
        },
      },
      "/monitor/lms/native/list": {
        post: {
          tags: ["monitor"],
          summary: "LM Studio 네이티브 REST로 모델 목록 프록시(원격-안전)",
          description:
            "LM Studio 자체 `/api/v1/models`로 포워딩. loopback은 항상 허용, 원격은 `STRICT_LOCALHOST=0` + 유효한 `BENCH_API_KEYS` 키 필요. 기본(미설정/1)은 `403 remote_not_loopback`.",
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["baseUrl"],
                  properties: { baseUrl: { type: "string" }, apiKey: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "로드된 인스턴스 포함 모델 목록" },
            "401": { description: "unauthorized (STRICT_LOCALHOST=0인데 키 없음/오류)" },
            "403": { description: "remote_not_loopback (기본 잠금)" },
            "502": { description: "LM Studio 오류/도달 불가 (upstream_status·detail 포함)" },
          },
        },
      },
      "/monitor/lms/native/load": {
        post: {
          tags: ["monitor"],
          summary: "LM Studio 네이티브 REST로 모델 로드 프록시(원격-안전)",
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["baseUrl", "model"],
                  properties: {
                    baseUrl: { type: "string" },
                    model: { type: "string" },
                    apiKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "로드 결과" },
            "401": { description: "unauthorized" },
            "403": { description: "remote_not_loopback" },
            "502": { description: "LM Studio 오류/도달 불가" },
          },
        },
      },
      "/monitor/lms/native/unload": {
        post: {
          tags: ["monitor"],
          summary: "LM Studio 네이티브 REST로 모델 언로드 프록시(원격-안전)",
          description: "목록에서 `instance_id`를 해석해 언로드. bad instance_id는 502로 상위 상태·본문을 그대로 노출.",
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["baseUrl", "model"],
                  properties: {
                    baseUrl: { type: "string" },
                    model: { type: "string" },
                    apiKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "언로드 결과" },
            "401": { description: "unauthorized" },
            "403": { description: "remote_not_loopback" },
            "502": { description: "LM Studio 오류/도달 불가" },
          },
        },
      },
    },
    components: {
      schemas: {
        DetectResult: jsonSchema(DetectResultSchema),
        BenchRunMeta: jsonSchema(BenchRunMetaSchema),
        StreamEvent: jsonSchema(StreamEventSchema),
        BenchResult: jsonSchema(BenchResultSchema),
        DetectBody: jsonSchema(DetectBodySchema),
        BaseUrlNameInput: jsonSchema(BaseUrlNameInputSchema),
        BenchStreamBody: jsonSchema(BenchStreamBodySchema),
        BenchQueueStartBody: jsonSchema(BenchQueueStartBodySchema),
        BenchQueueSnapshot: jsonSchema(BenchQueueSnapshotSchema),
        BenchQueueStreamEvent: jsonSchema(BenchQueueStreamEventSchema),
        StressStreamBody: jsonSchema(StressStreamBodySchema),
        ScenarioCatalogResponse: jsonSchema(ScenarioCatalogResponseSchema),
        ScoreboardResponse: jsonSchema(ScoreboardResponseSchema),
        MonitorSnapshotResponse: jsonSchema(MonitorSnapshotResponseSchema),
        StressRampConfig: jsonSchema(StressRampConfigSchema),
        CustomScenarioInput: jsonSchema(CustomScenarioInputSchema),
        CompareResponse: jsonSchema(CompareResponseSchema),
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "`BENCH_API_KEYS` 중 하나(opt-in). 미설정 시 인증 없음.",
        },
        apiKeyHeader: { type: "apiKey", in: "header", name: "x-api-key" },
      },
    },
  };

  cached = spec;
  return spec;
}
