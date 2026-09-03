import type { BenchQueueModelStatus, BenchRunMeta, DetectResult, StreamEvent } from "@llm-bench/shared";
import { classifyModelOutcome } from "@llm-bench/shared";
import { makeBenchRunMeta, runBench, type BenchRequest } from "./bench-runner.js";
import { endLiveRun, publishLiveEvent, startLiveRun } from "./bench-live-registry.js";
import { normBaseUrl } from "./http-shared.js";

/**
 * 모델 1건의 벤치 실행 — SQLite 저장, 라이브 브로드캐스트, 결과 분류까지.
 * `/bench/stream` 라우트의 fire-and-forget 루프를 그대로 옮긴 것이고, 이제 서버 소유 큐
 * (`bench-queue-runner.ts`)가 두 번째 소비자다. 전송(SSE 인코딩·keepalive·응답 스트림 종료)은
 * 라우트에 남는다 — 이 함수는 `onEvent`로만 바깥과 통신한다.
 */

export type BenchRunOutcome = {
  /** run_started를 못 본 채(감지·프리플라이트 단계) 실패하면 null — DB 행도 없다. */
  runId: string | null;
  status: BenchQueueModelStatus;
  errorCount: number;
  sawRunFinished: boolean;
  cancelled: boolean;
  skippedByPreflight: boolean;
};

type Persister = {
  start(meta: BenchRunMeta): void;
  onEvent(ev: StreamEvent): void;
  finalize(): void;
};

const noopPersister: Persister = { start() {}, onEvent() {}, finalize() {} };

export async function runOneBenchModel(args: {
  req: BenchRequest;
  detect: DetectResult;
  /** 라우트의 SSE push, 큐의 브로드캐스트 등 — 모든 이벤트가 그대로 전달된다. */
  onEvent: (ev: StreamEvent) => void;
  /** 이 런이 속한 큐(있으면). 라이브 조회에서 큐를 역참조하기 위한 표식. */
  queueId?: string;
}): Promise<BenchRunOutcome> {
  const { req, detect, onEvent } = args;
  let persister: Persister = noopPersister;
  try {
    const dbMod = await import("./db/database.js");
    const { BenchRunPersistence } = await import("./db/persist-stream.js");
    persister = new BenchRunPersistence(dbMod.tryOpenProdBenchDatabase());
  } catch (e) {
    console.error("[llm-bench-server] SQLite 계층 로드 실패 — 벤치는 진행하나 디스크 저장은 건너뜁니다:", e);
    persister = noopPersister;
  }
  let started = false;
  // 새로고침 후 재연결(라이브 재구독)을 위한 브로드캐스트 대상 runId — run_started에서 채워진다.
  let liveRunId: string | null = null;
  let errorCount = 0;
  let sawRunFinished = false;
  let cancelled = false;
  let skippedByPreflight = false;
  let threw = false;
  try {
    for await (const ev of runBench(req, detect)) {
      if (ev.type === "run_started") {
        const meta: BenchRunMeta = ev.meta ?? makeBenchRunMeta(req, detect, ev.run_id);
        persister.start(meta);
        started = true;
        liveRunId = ev.run_id;
        startLiveRun(ev.run_id, {
          // 실제 추론 대상 기준 — 직렬 실행 락(`/bench/queue`의 충돌 검사)이 이 값으로 런을 찾는다.
          base_url: normBaseUrl(detect.baseUrl),
          model_id: req.modelId,
          provider: req.provider,
          started_at: Date.now(),
          plan: {
            scenario_ids: [...meta.scenario_ids],
            api_routes: [...meta.api_routes],
            warmup_runs: meta.warmup_runs,
            measured_runs: meta.measured_runs,
          },
          queue_id: args.queueId ?? null,
        });
      }
      if (ev.type === "error") errorCount += 1;
      if (ev.type === "run_finished") {
        sawRunFinished = true;
        if (ev.reason === "cancelled") cancelled = true;
      }
      if (ev.type === "preflight_memory_fit" && ev.action === "skip") skippedByPreflight = true;
      persister.onEvent(ev);
      onEvent(ev);
      if (liveRunId) publishLiveEvent(liveRunId, ev);
    }
  } catch (e) {
    threw = true;
    const errEv: StreamEvent = {
      type: "error",
      layer: "orchestrator",
      code: "stream_failed",
      message: String(e),
    };
    errorCount += 1;
    onEvent(errEv);
    if (liveRunId) publishLiveEvent(liveRunId, errEv);
  } finally {
    // finalize가 던져도 endLiveRun은 반드시 돈다 — 안 그러면 죽은 런이 레지스트리에 남아
    // 직렬 실행 락을 영구 점유하고 재연결 구독자도 닫히지 않는다.
    try {
      if (started) persister.finalize();
    } catch (e) {
      console.error("[llm-bench-server] 벤치 결과 저장 마무리 실패:", e);
    }
    if (liveRunId) endLiveRun(liveRunId);
  }

  return {
    runId: liveRunId,
    // httpFailed는 클라이언트 개념이다 — 서버는 스트림을 직접 소비하므로 언제나 false.
    status: classifyModelOutcome({
      httpFailed: false,
      threw,
      sawRunFinished,
      cancelled,
      skippedByPreflight,
      scenarioErrorCount: errorCount,
    }),
    errorCount,
    sawRunFinished,
    cancelled,
    skippedByPreflight,
  };
}
