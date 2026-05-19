import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetLmsCliCacheForTest,
  _setExecFileForTest,
  isLmsCliEnabled,
  isValidModelId,
  lmsCheckAvailable,
  lmsLoad,
  lmsPs,
  lmsUnload,
} from "./lms-cli";

const originalEnv = { ...process.env };

beforeEach(() => {
  _resetLmsCliCacheForTest();
});
afterEach(() => {
  _setExecFileForTest(null);
  _resetLmsCliCacheForTest();
  process.env = { ...originalEnv };
});

describe("isValidModelId", () => {
  it("accepts safe identifiers", () => {
    expect(isValidModelId("llama-3-70b")).toBe(true);
    expect(isValidModelId("publisher/model-name")).toBe(true);
    expect(isValidModelId("a_b.c-d:e/f")).toBe(true);
    expect(isValidModelId("Q4_K_M.gguf")).toBe(true);
  });

  it("rejects shell metacharacters and unicode", () => {
    expect(isValidModelId("model; rm -rf /")).toBe(false);
    expect(isValidModelId("model && evil")).toBe(false);
    expect(isValidModelId("model $(whoami)")).toBe(false);
    expect(isValidModelId("model `id`")).toBe(false);
    expect(isValidModelId("model with space")).toBe(false);
    expect(isValidModelId("한글모델")).toBe(false);
    expect(isValidModelId("model🚀")).toBe(false);
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId("a".repeat(300))).toBe(false);
    expect(isValidModelId(undefined)).toBe(false);
    expect(isValidModelId(null)).toBe(false);
  });
});

describe("ENV gate", () => {
  it("isLmsCliEnabled reflects env", () => {
    delete process.env.ENABLE_LMS_CLI;
    expect(isLmsCliEnabled()).toBe(false);
    process.env.ENABLE_LMS_CLI = "1";
    expect(isLmsCliEnabled()).toBe(true);
    process.env.ENABLE_LMS_CLI = "yes"; // 1만 인정
    expect(isLmsCliEnabled()).toBe(false);
  });

  it("lmsCheckAvailable rejects when env off", async () => {
    delete process.env.ENABLE_LMS_CLI;
    const r = await lmsCheckAvailable();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ENABLE_LMS_CLI/);
  });

  it("lmsPs throws when env off (so route layer returns 403)", async () => {
    delete process.env.ENABLE_LMS_CLI;
    await expect(lmsPs()).rejects.toThrow(/ENABLE_LMS_CLI/);
  });

  it("lmsLoad throws when env off", async () => {
    delete process.env.ENABLE_LMS_CLI;
    await expect(lmsLoad("m")).rejects.toThrow(/ENABLE_LMS_CLI/);
  });

  it("lmsUnload throws when env off", async () => {
    delete process.env.ENABLE_LMS_CLI;
    await expect(lmsUnload("m")).rejects.toThrow(/ENABLE_LMS_CLI/);
  });
});

describe("lmsCheckAvailable (env on)", () => {
  beforeEach(() => {
    process.env.ENABLE_LMS_CLI = "1";
  });

  it("returns version on success", async () => {
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      cb?.(null, "lms 0.5.0\n", "");
      return {} as never;
    }) as never);
    const r = await lmsCheckAvailable();
    expect(r.ok).toBe(true);
    expect(r.version).toBe("lms 0.5.0");
  });

  it("returns error on missing binary", async () => {
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      const err = new Error("ENOENT");
      cb?.(err, "", "");
      return {} as never;
    }) as never);
    const r = await lmsCheckAvailable();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("caches result (60s TTL)", async () => {
    let count = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      count += 1;
      cb?.(null, "lms 0.5.0\n", "");
      return {} as never;
    }) as never);
    await lmsCheckAvailable();
    await lmsCheckAvailable();
    await lmsCheckAvailable();
    expect(count).toBe(1);
  });
});

describe("lmsPs (env on)", () => {
  beforeEach(() => {
    process.env.ENABLE_LMS_CLI = "1";
  });

  it("tries --json first", async () => {
    const callArgs: string[][] = [];
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      callArgs.push([...(args as string[])]);
      cb?.(null, '[{"id":"foo"}]', "");
      return {} as never;
    }) as never);
    const r = await lmsPs();
    expect(r.ok).toBe(true);
    expect(callArgs[0]).toEqual(["ps", "--json"]);
  });

  it("falls back to plain on --json failure", async () => {
    let call = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      call += 1;
      if (call === 1) {
        cb?.(new Error("unknown option --json"), "", "");
      } else {
        cb?.(null, "ID  Name\nm1  foo\n", "");
      }
      return {} as never;
    }) as never);
    const r = await lmsPs();
    expect(r.ok).toBe(true);
    expect(call).toBe(2);
  });

  it("returns ok:false on both failures", async () => {
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      cb?.(new Error("ENOENT"), "", "");
      return {} as never;
    }) as never);
    const r = await lmsPs();
    expect(r.ok).toBe(false);
  });
});

describe("lmsLoad/Unload (env on)", () => {
  beforeEach(() => {
    process.env.ENABLE_LMS_CLI = "1";
  });

  it("rejects invalid model id without spawning", async () => {
    let spawned = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      spawned += 1;
      cb?.(null, "", "");
      return {} as never;
    }) as never);
    const r = await lmsLoad("model; rm -rf /");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_model_id");
    expect(spawned).toBe(0);
  });

  it("uses execFile (not shell) for valid id", async () => {
    let captured: { file: string; args: string[] } | null = null;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      captured = { file: file as string, args: [...(args as string[])] };
      cb?.(null, "loaded\n", "");
      return {} as never;
    }) as never);
    await lmsLoad("publisher/model-name");
    expect(captured).toEqual({ file: "lms", args: ["load", "publisher/model-name"] });
  });

  it("unload accepts timeout option", async () => {
    const seen: { timeout?: number }[] = [];
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      seen.push(opts as { timeout?: number });
      cb?.(null, "unloaded\n", "");
      return {} as never;
    }) as never);
    await lmsUnload("foo");
    expect(seen[0]?.timeout).toBe(15_000);
  });
});
