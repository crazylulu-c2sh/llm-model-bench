/** 비전 시나리오 UI 서브카테고리 코드(문서 목차·썸네일 모달). 표시 라벨은 로케일별로 웹에서 매핑. */
export type VisionSubcategory = "ocr" | "count" | "chart" | "meme" | "wireframe";

export function visionSubcategory(id: string): VisionSubcategory | undefined {
  if (id.startsWith("vision_table_ocr")) return "ocr";
  if (id.startsWith("vision_count_red_cars")) return "count";
  if (id.startsWith("vision_chart_peak")) return "chart";
  if (id.startsWith("vision_meme_explain")) return "meme";
  if (id.startsWith("vision_wireframe_html")) return "wireframe";
  return undefined;
}
