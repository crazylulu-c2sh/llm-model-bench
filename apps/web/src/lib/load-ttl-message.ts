import type { LoadTtlStatus } from "@llm-bench/shared";
import type { Messages } from "../i18n";

/** 로드 TTL 상태를 사용자에게 보여줄 한 줄로. 알릴 게 없으면 null. */
export type LoadTtlNotice = { level: "warn" | "info"; text: string } | null;

/**
 * `model_loaded` 이벤트의 TTL 상태를 안내 문구로 변환한다 — 벤치/스트레스 두 페이지가 공유.
 *
 * `not_applied`는 이유에 따라 대응이 달라서 `lm_studio_prepare`를 함께 본다: 이미 상주 중이라
 * 못 건 경우엔 "적용하려면 먼저 언로드해야 한다"까지 알려줘야 사용자가 다음 행동을 정할 수 있다.
 * `unknown`은 실패가 아니라 '확인 불가'라서 경고가 아닌 정보로 띄운다(성공 경로에서 매번
 * 경고가 뜨면 진짜 경고가 묻힌다).
 */
export function loadTtlNotice(
  m: Messages,
  modelId: string,
  status: LoadTtlStatus | undefined,
  prepare?: string,
): LoadTtlNotice {
  if (!status) return null;
  if (status === "rejected") return { level: "warn", text: m.bench.loadTtlRejected(modelId) };
  if (status === "unknown") return { level: "info", text: m.bench.loadTtlUnknown(modelId) };
  return {
    level: "warn",
    text:
      prepare === "already_in_memory"
        ? m.bench.loadTtlNotAppliedResident(modelId)
        : m.bench.loadTtlNotApplied(modelId),
  };
}
