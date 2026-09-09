/**
 * LM Studio / Unsloth GGUF 카드에 섞여 나오는 **보조 아티팩트** — 벤치 대상 LLM이 아님.
 *
 * - imatrix: 양자화 캘리브레이션 데이터
 * - mmproj: 비전 projector
 * - mtp-… / label "Mtp …": 스펙큘레이티브 디코딩용 드래프트(본모델 아님)
 *
 * 주의: `qwen3.6-35b-a3b-mtp@q4_k_m` 처럼 id에 `-mtp@` 가 들어간 **본체크포인트**는 유지한다.
 *
 * 주의(#159): id/label 어디에나 단어가 있으면 매칭하던 이전 규칙은 두 가지를 오탐시켰다 —
 * "imatrix로 양자화된 정상 모델"(HF에서 `-imatrix-`는 흔한 양자화 접미사이지 캘리브레이션
 * 데이터 자체가 아니다, 예: `bartowski/…-imatrix-GGUF`)과, quant가 하나뿐이라 LM Studio가
 * `@variant` 접미사를 안 붙이는 본체크포인트인데 label이 "…MTP"로 끝나는 경우. 그래서 id는
 * **마지막 경로 세그먼트의 선두**만, label은 **선두 토큰**만 본다 — LM Studio가 실제로
 * 내보내는 아티팩트 키/표시명은 항상 그 접두사로 *시작*한다는 실측에 근거한 판정이며,
 * 문장 중간에 그 단어가 있는 것만으로는 제외하지 않는다.
 */

export function isBenchExcludedModelArtifact(id: string, label?: string | null): boolean {
  const idL = id.trim().toLowerCase();
  const labelL = (label ?? "").trim().toLowerCase();
  const hay = `${idL} ${labelL}`;
  const seg = idL.slice(idL.lastIndexOf("/") + 1);

  if (/^imatrix([^a-z0-9]|$)/.test(seg)) return true;
  if (/^imatrix([^a-z0-9]|$)/.test(labelL)) return true;
  if (/(^|[^a-z0-9])mmproj([^a-z0-9]|$)/.test(hay)) return true;

  // 파일/키 접두 `mtp-` / `mtp_` / 경로 `…/mtp-…`
  if (/(^|\/)mtp[-_]/.test(idL)) return true;

  // LMS display_name "Mtp Qwen3.8 27B" — 선두 토큰만 본다(문장 중간의 "…MTP"는 본체 취급).
  if (/^mtp([^a-z0-9]|$)/.test(labelL)) return true;

  return false;
}
