import { describe, expect, it } from "vitest";
import { VISION_SCENARIO_IDS, visionImageFilename } from "@llm-bench/shared";
import {
  MAX_VISION_IMAGE_BYTES,
  buildImagePart,
  loadVisionImageBytes,
  visionImageRefs,
} from "./vision-assets.js";

const LOOPBACK = "http://127.0.0.1:1234";
const SCENARIO = "vision_chart_peak_a" as const;

describe("vision image assets on disk", () => {
  it("every vision scenario has a loadable image within the size cap", () => {
    for (const id of VISION_SCENARIO_IDS) {
      const filename = visionImageFilename(id);
      expect(filename, id).not.toBeNull();
      const asset = loadVisionImageBytes(id);
      expect(asset.bytes.byteLength, id).toBeGreaterThan(0);
      expect(asset.bytes.byteLength, id).toBeLessThanOrEqual(MAX_VISION_IMAGE_BYTES);
      expect(asset.mediaType).toBe("image/jpeg");
      expect(asset.refPath).toBe(`/vision/${filename}`);
    }
  });

  it("visionImageRefs returns the stable ref path and never a data URL", () => {
    for (const id of VISION_SCENARIO_IDS) {
      const refs = visionImageRefs(id);
      expect(refs).toEqual([`/vision/${visionImageFilename(id)}`]);
      expect(refs[0]).not.toMatch(/^data:/);
    }
  });

  it("non-vision scenarios have no image refs", () => {
    expect(visionImageRefs("chat_hello")).toEqual([]);
  });
});

const PUBLIC_ORIGIN = "https://example.com";

describe("buildImagePart — openai route", () => {
  it("forceInline 미지정 + loopback → data:image/jpeg;base64, prefix 포함", () => {
    const part = buildImagePart(SCENARIO, LOOPBACK, "openai");
    expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("forceInline: false + loopback → data:image/jpeg;base64, prefix 포함", () => {
    const part = buildImagePart(SCENARIO, LOOPBACK, "openai", { forceInline: false });
    expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("forceInline: true + loopback → data:image/jpeg;base64, prefix 포함", () => {
    const part = buildImagePart(SCENARIO, LOOPBACK, "openai", { forceInline: true });
    expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("forceInline: true + 공개 origin → 네트워크 무관하게 data URL 인라인 강제", () => {
    const part = buildImagePart(SCENARIO, PUBLIC_ORIGIN, "openai", { forceInline: true });
    expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(part.image_url.url).not.toMatch(/^https?:/);
  });
});

describe("buildImagePart — anthropic route", () => {
  it("source.type === base64, data: prefix 없는 raw base64", () => {
    const part = buildImagePart(SCENARIO, LOOPBACK, "anthropic");
    expect(part.type).toBe("image");
    expect(part.source.type).toBe("base64");
    if (part.source.type === "base64") {
      expect(part.source.media_type).toBe("image/jpeg");
      expect(part.source.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
  });
});
