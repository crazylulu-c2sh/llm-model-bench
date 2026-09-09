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
 *
 * 주의(#159 후속 실측): 위 id/label 규칙만으론 진짜 드래프트도 놓치는 사각지대가 있다 —
 * `qwen3.8-27b-mtp@8bit`/`@4bit`(266~478MB, `params_string`은 "27B"라 본체를 사칭)가
 * id에 `-mtp@`를 포함해 "본체크포인트 예외"에 걸려 조용히 keep됐다(id 패턴만으로는
 * `qwen3.6-35b-a3b-mtp@q4_k_m`류의 진짜 본체와 구분 불가). 실측한 로컬 카탈로그(38건)에서
 * 이 두 항목만 `arch`가 `_mtp`로 끝났고 — 정상 모델은 전부 맨 패밀리명(`gemma4`·`qwen35`·
 * `qwen3vl` 등)이었다 — LM Studio API의 `arch`를 보조 신호로 추가한다. id/label 규칙을
 * 대체하지 않고 **보강**하며, 필요조건은 아니다(arch를 못 주는 백엔드에서는 그냥 통과).
 */

export function isBenchExcludedModelArtifact(
  id: string,
  label?: string | null,
  arch?: string | null,
): boolean {
  const idL = id.trim().toLowerCase();
  const labelL = (label ?? "").trim().toLowerCase();
  const archL = (arch ?? "").trim().toLowerCase();
  const hay = `${idL} ${labelL}`;
  const seg = idL.slice(idL.lastIndexOf("/") + 1);

  if (/^imatrix([^a-z0-9]|$)/.test(seg)) return true;
  if (/^imatrix([^a-z0-9]|$)/.test(labelL)) return true;
  if (/(^|[^a-z0-9])mmproj([^a-z0-9]|$)/.test(hay)) return true;

  // 파일/키 접두 `mtp-` / `mtp_` / 경로 `…/mtp-…`
  if (/(^|\/)mtp[-_]/.test(idL)) return true;

  // LMS display_name "Mtp Qwen3.8 27B" — 선두 토큰만 본다(문장 중간의 "…MTP"는 본체 취급).
  if (/^mtp([^a-z0-9]|$)/.test(labelL)) return true;

  // 보조 신호: 드래프트 모델의 arch 명명 규칙(끝 앵커로만 — "assistant"라는 이름의 실제
  // 모델이 그럴듯하므로 contains는 쓰지 않는다). `_mtp`는 실측 확인, `-assistant`는 #159
  // 이슈 코멘트의 gemma MTP 드래프트 관측(`gemma4-assistant`)에 근거.
  if (/_mtp$/.test(archL) || /-assistant$/.test(archL)) return true;

  return false;
}
