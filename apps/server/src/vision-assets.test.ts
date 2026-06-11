import { describe, expect, it } from "vitest";
import { VISION_SCENARIO_IDS, visionImageFilename } from "@llm-bench/shared";
import {
  MAX_VISION_IMAGE_BYTES,
  loadVisionImageBytes,
  visionImageRefs,
} from "./vision-assets.js";

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
