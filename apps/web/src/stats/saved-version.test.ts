import { describe, expect, it } from "vitest";
import { savedVersion, savedVersionKey, savedVersionOptions } from "./saved-version";

describe("saved version filter", () => {
  it("keeps missing, partial, and complete combinations distinct", () => {
    expect(savedVersion()).toEqual({ evaluation: null, warmup: null });
    expect(savedVersion({ evaluation_protocol_version: "1" })).toEqual({ evaluation: 1, warmup: null });
    expect(savedVersionKey(savedVersion({ warmup_protocol_version: "2" }))).not.toBe(
      savedVersionKey(savedVersion({ evaluation_protocol_version: "2" })));
  });

  it("deduplicates numeric/string versions and sorts numerically with missing last", () => {
    const configs = [
      { evaluation_protocol_version: "2", warmup_protocol_version: "2" },
      { evaluation_protocol_version: 2, warmup_protocol_version: 2 },
      { evaluation_protocol_version: "10", warmup_protocol_version: "2" },
      undefined,
      { evaluation_protocol_version: "2", warmup_protocol_version: "10" },
      { evaluation_protocol_version: "2" },
    ];
    expect(savedVersionOptions(configs).map(savedVersionKey)).toEqual([
      "[10,2]", "[2,10]", "[2,2]", "[2,null]", "[null,null]",
    ]);
  });

  it("does not invent versions from malformed values or unrelated metadata", () => {
    expect(savedVersion({ evaluation_protocol_version: "", warmup_protocol_version: {}, scenario_bundle_version: "11" }))
      .toEqual({ evaluation: null, warmup: null });
    expect(savedVersion({ evaluation_protocol_version: -1, warmup_protocol_version: 1.5 }))
      .toEqual({ evaluation: null, warmup: null });
  });
});
