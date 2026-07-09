// 품질 점수 계산은 @llm-bench/shared로 이전됨(web·server·mcp 단일 소스). 이 파일은 호환 shim.
export {
  computeQualityScores,
  type QualityCaveat,
  type QualityGroupScore,
  type ModelQualityScore,
  type QualityInput,
} from "@llm-bench/shared";
