/** 비전 시나리오 UI 서브카테고리 라벨 (문서 목차·썸네일 모달). */
export function visionSubcategoryLabel(id: string): string | undefined {
  if (id.startsWith("vision_table_ocr")) return "OCR";
  if (id.startsWith("vision_count_red_cars")) return "카운트";
  if (id.startsWith("vision_chart_peak")) return "차트";
  if (id.startsWith("vision_meme_explain")) return "밈";
  if (id.startsWith("vision_wireframe_html")) return "와이어프레임";
  return undefined;
}
