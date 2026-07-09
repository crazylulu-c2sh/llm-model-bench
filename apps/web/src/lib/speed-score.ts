// 속도 점수 계산은 @llm-bench/shared로 이전됨(web·server·mcp 단일 소스). 이 파일은 호환 shim.
export {
  SPEED_REFERENCE,
  tpsSpeedRatio,
  speedScoreForRow,
  computeSpeedScores,
  type SpeedInput,
  type SpeedGroup,
  type ModelSpeedScore,
} from "@llm-bench/shared";
