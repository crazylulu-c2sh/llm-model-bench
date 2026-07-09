import { z } from "zod";
import {
  BenchResultSchema,
  BenchRunMetaSchema,
  BenchStreamBodySchema,
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
        "`/bench/stream`은 클라이언트 abort를 무시하고 서버에서 끝까지 실행된다(결과는 `GET /runs/{runId}`로 회수).",
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
              schema: { type: "string", enum: ["public", "default", "vision", "all"] },
              description: "기본 public",
            },
          ],
          responses: { "200": jsonResponse("ScenarioCatalogResponse", "시나리오 서술 목록") },
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
              schema: { type: "string", enum: ["coding", "vision", "tools", "structured", "chat"] },
              description: "시나리오 필터",
            },
          ],
          responses: {
            "200": jsonResponse("ScoreboardResponse", "랭킹된 모델 행"),
            "400": badRequest,
          },
        },
      },
      "/bench/stream": {
        post: {
          tags: ["bench"],
          summary: "모델 벤치 실행(SSE). 클라이언트 abort 무시 — 서버에서 끝까지 실행",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("BenchStreamBody") } },
          },
          responses: {
            "200": sseResponse("StreamEvent", "StreamEvent SSE 스트림"),
            "400": badRequest,
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
    },
    components: {
      schemas: {
        DetectResult: jsonSchema(DetectResultSchema),
        BenchRunMeta: jsonSchema(BenchRunMetaSchema),
        StreamEvent: jsonSchema(StreamEventSchema),
        BenchResult: jsonSchema(BenchResultSchema),
        DetectBody: jsonSchema(DetectBodySchema),
        BenchStreamBody: jsonSchema(BenchStreamBodySchema),
        StressStreamBody: jsonSchema(StressStreamBodySchema),
        ScenarioCatalogResponse: jsonSchema(ScenarioCatalogResponseSchema),
        ScoreboardResponse: jsonSchema(ScoreboardResponseSchema),
        MonitorSnapshotResponse: jsonSchema(MonitorSnapshotResponseSchema),
        StressRampConfig: jsonSchema(StressRampConfigSchema),
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
