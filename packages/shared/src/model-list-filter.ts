/**
 * LM Studio / Unsloth GGUF 카드에 섞여 나오는 **보조 아티팩트** — 벤치 대상 LLM이 아님.
 *
 * - imatrix: 양자화 캘리브레이션 데이터
 * - mmproj: 비전 projector
 * - mtp-… / label "Mtp …": 스펙큘레이티브 디코딩용 드래프트(본모델 아님)
 *
 * 주의: `qwen3.6-35b-a3b-mtp@q4_k_m` 처럼 id에 `-mtp@` 가 들어간 **본체크포인트**는 유지한다.
 */

export function isBenchExcludedModelArtifact(id: string, label?: string | null): boolean {
  const idL = id.trim().toLowerCase();
  const labelL = (label ?? "").trim().toLowerCase();
  const hay = `${idL} ${labelL}`;

  if (/(^|[^a-z0-9])imatrix([^a-z0-9]|$)/.test(hay)) return true;
  if (/(^|[^a-z0-9])mmproj([^a-z0-9]|$)/.test(hay)) return true;

  // 파일/키 접두 `mtp-` / `mtp_` / 경로 `…/mtp-…`
  if (/(^|\/)mtp[-_]/.test(idL)) return true;

  // LMS display_name "Mtp Qwen3.8 27B" — 본체크포인트 id(`…-mtp@…`)는 제외하지 않음
  if (/\bmtp\b/.test(labelL) && !/-mtp@/.test(idL)) return true;

  return false;
}
