#!/usr/bin/env node
/**
 * docs/vision_bench/*.png → apps/web/public/vision/*.jpg
 * 한글·공백 파일명을 ASCII로 정규화하고 1280px 폭 JPEG로 변환한다.
 *
 * JPEG를 쓰는 이유: LM Studio 일부 비전 빌드가 `image/webp` MIME을 거부하고
 * "'url' field must be a base64 encoded image." 400을 돌려준다. JPEG는 모든
 * 비전 백엔드(Anthropic·OpenAI·LM Studio·Ollama LLaVA)에서 일관 동작한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(repoRoot, "docs/vision_bench");
const dstDir = path.join(repoRoot, "apps/web/public/vision");

const MAP = [
  ["ChatGPT Image 심화 OCR 복잡한 표 구조화 (Complex Table Structure).png", "table_ocr_a.jpg"],
  ["Gemini_Generated_Image 심화 OCR 복잡한 표 구조화 (Complex Table Structure).png", "table_ocr_b.jpg"],
  ["ChatGPT Image 공간 지각 밀집된 객체 카운팅 (Dense Object Counting).png", "count_red_cars_a.jpg"],
  ["Gemini_Generated_Image 공간 지각 밀집된 객체 카운팅 (Dense Object Counting).png", "count_red_cars_b.jpg"],
  ["ChatGPT Image 논리적 추론 복잡한 차트 해석 (Complex Chart Interpretation).png", "chart_peak_a.jpg"],
  ["Gemini_Generated_Image 논리적 추론 복잡한 차트 해석 (Complex Chart Interpretation).png", "chart_peak_b.jpg"],
  ["ChatGPT Image 논리적 추론 유머 및 밈 이해 (Humor & Meme Understanding).png", "meme_explain_a.jpg"],
  ["Gemini_Generated_Image 논리적 추론 유머 및 밈 이해 (Humor & Meme Understanding).png", "meme_explain_b.jpg"],
  ["ChatGPT Image 코드 생성 와이어프레임 렌더링 (Wireframe to Code).png", "wireframe_html_a.jpg"],
  ["Gemini_Generated_Image 코드 생성 와이어프레임 렌더링 (Wireframe to Code).png", "wireframe_html_b.jpg"],
];

await mkdir(dstDir, { recursive: true });

for (const [srcName, dstName] of MAP) {
  const src = path.join(srcDir, srcName);
  const dst = path.join(dstDir, dstName);
  if (!existsSync(src)) {
    console.error(`missing: ${src}`);
    continue;
  }
  const buf = await readFile(src);
  // OCR 자산은 작은 디지트 가독성이 채점 정답에 직접 영향 → 더 높은 품질.
  const quality = dstName.startsWith("table_ocr_") ? 92 : 88;
  const out = await sharp(buf)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  await writeFile(dst, out);
  console.log(`${dstName}  ${(out.byteLength / 1024).toFixed(1)} KB`);
}

console.log("done.");
