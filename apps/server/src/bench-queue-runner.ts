import type { BenchProfileIntent, DetectResult } from "@llm-bench/shared";
import { benchProfileForModel } from "@llm-bench/shared";
import type { BenchRequest } from "./bench-runner.js";
import { runOneBenchModel } from "./bench-run-driver.js";
import {
  finishQueue,
  getQueueSnapshot,
  isQueueStopRequested,
  markModelFinished,
  markModelRunId,
  markModelRunning,
  markRemainingCancelled,
  publishQueueEvent,
  waitWhileQueuePaused,
} from "./bench-queue-registry.js";

/**
 * 서버 소유 큐의 실행 루프. 클라이언트 연결과 완전히 무관하게 끝까지 돈다 —
 * 탭이 새로고침되거나 영영 닫혀도 남은 모델이 실행된다는 것이 이 모듈의 존재 이유다.
 */

export type BenchQueueBaseRequest = Omit<BenchRequest, "modelId" | "profile" | "profileMaxTokens">;

/** 모델별 프로파일을 의도에서 다시 해석한다 — 큐에 gpt-oss와 Qwen3.8이 섞여도 각자 값이 간다. */
export function benchRequestForQueueModel(
  base: BenchQueueBaseRequest,
  modelId: string,
  intent: BenchProfileIntent,
): BenchRequest {
  const p = benchProfileForModel(modelId, intent);
  return {
    ...base,
    modelId,
    profileMaxTokens: p.profileMaxTokens,
    profile: {
      profileId: p.profileId,
      taskMode: p.taskMode,
      thinkingIntent: p.thinkingIntent,
      preserveThinking: p.preserveThinking,
      presetOverride: p.presetOverride,
      samplingOverrides: p.samplingOverrides,
      reasoningEffort: p.reasoningEffort,
    },
  };
}

/** fire-and-forget. 호출자는 await 하지 않는다(HTTP 응답 생명주기와 분리). */
export function driveBenchQueue(args: {
  queueId: string;
  detect: DetectResult;
  base: BenchQueueBaseRequest;
  intent: BenchProfileIntent;
  modelIds: string[];
}): void {
  const { queueId, detect, base, intent, modelIds } = args;
  void (async () => {
    const snapshot = getQueueSnapshot(queueId);
    if (!snapshot) return;
    publishQueueEvent(queueId, {
      type: "queue_started",
      queue_id: queueId,
      base_url: snapshot.base_url,
      provider: snapshot.provider,
      model_ids: [...modelIds],
      plan: snapshot.plan,
    });
    let stopped = false;
    let failed = false;
    let current = 0;
    try {
      for (let i = 0; i < modelIds.length; i += 1) {
        current = i;
        // ⓐ 시작 전 — 이전 모델에서 정지가 걸렸거나 대기 중 정지된 경우
        if (isQueueStopRequested(queueId)) {
          stopped = true;
          markRemainingCancelled(queueId, i);
          break;
        }
        await waitWhileQueuePaused(queueId);
        // ⓑ 일시정지에서 깨어난 이유가 정지일 수 있다
        if (isQueueStopRequested(queueId)) {
          stopped = true;
          markRemainingCancelled(queueId, i);
          break;
        }
        const modelId = modelIds[i];
        markModelRunning(queueId, i);
        // 리셋 → 발행 순서는 publishQueueEvent 안에서 보장된다(버퍼를 비운 뒤 이 이벤트를 핀에 남긴다).
        publishQueueEvent(queueId, {
          type: "queue_model_started",
          queue_id: queueId,
          index: i,
          model_id: modelId,
        });
        const outcome = await runOneBenchModel({
          req: benchRequestForQueueModel(base, modelId, intent),
          detect,
          queueId,
          onEvent: (ev) => {
            if (ev.type === "run_started") markModelRunId(queueId, i, ev.run_id);
            publishQueueEvent(queueId, ev);
          },
        });
        markModelFinished(queueId, i, { status: outcome.status, errorCount: outcome.errorCount });
        publishQueueEvent(queueId, {
          type: "queue_model_finished",
          queue_id: queueId,
          index: i,
          model_id: modelId,
          run_id: outcome.runId,
          status: outcome.status,
          error_count: outcome.errorCount,
        });
        // ⓒ 큐 정지가 걸렸을 때만 멈춘다.
        // `outcome.cancelled`(= run_finished.reason === "cancelled")를 큐 정지로 승격하면 안 된다 —
        // 런 단위 정지(POST /bench/:runId/stop)는 **이 모델만 건너뛰기**이고, 큐 전체 정지는
        // POST /bench/queue/:queueId/stop이다(OpenAPI에도 그렇게 문서화돼 있다).
        if (isQueueStopRequested(queueId)) {
          stopped = true;
          markRemainingCancelled(queueId, i + 1);
          break;
        }
      }
    } catch (e) {
      // 루프 자체가 터지면(드라이버 밖 예외) 진행 중이던 모델은 running, 남은 모델은 pending으로
      // 굳는다 — 그 상태로 "finished"라고 보고하면 클라이언트가 완주로 오해한다.
      console.error("[llm-bench-server] 벤치 큐 실행 실패:", e);
      failed = true;
      markModelFinished(queueId, current, { status: "failed", errorCount: 1 });
      markRemainingCancelled(queueId, current + 1);
    } finally {
      const status = stopped || failed ? "cancelled" : "finished";
      const final = getQueueSnapshot(queueId);
      // finishQueue가 버퍼를 비우므로 종료 이벤트를 먼저 내보낸다.
      publishQueueEvent(queueId, {
        type: "queue_finished",
        queue_id: queueId,
        status,
        models: final ? final.models.map((m) => ({ ...m })) : [],
      });
      finishQueue(queueId, status);
    }
  })();
}
