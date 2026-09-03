import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setExecFileForTest } from "./lms-cli.js";
import { _setLocalAddressesForTest } from "./util/localhost.js";
import { findLmsTtlMs, verifyLmStudioTtlApplied } from "./lms-ttl-verify.js";

/**
 * 픽스처는 실제 LM Studio(`lms ps --json`) 출력이다 — 형식을 추측해 만든 파서는
 * "확인했다"고 말하면서 아무것도 못 읽는 코드가 되기 쉬워, 관측한 것에 고정한다.
 */
const REAL_PS_JSON = JSON.stringify([
  {
    type: "llm",
    modelKey: "gemma-4-e2b-it-qat-mobile",
    format: "gguf",
    displayName: "Gemma 4 E2B Instruct QAT UD",
    publisher: "unsloth",
    path: "unsloth/gemma-4-E2B-it-qat-mobile-GGUF/gemma-4-E2B-it-qat-UD-Q2_K_XL.gguf",
    sizeBytes: 4089218833,
    paramsString: "4.6B",
    architecture: "gemma4",
    quantization: { name: "Q2_K_XL", bits: 2 },
    identifier: "gemma-4-e2b-it-qat-mobile",
    ttlMs: 3600000,
    lastUsedTime: 1788427332406,
    maxContextLength: 131072,
    contextLength: 131072,
    status: "idle",
    queued: 0,
    parallel: 4,
  },
]);

describe("findLmsTtlMs", () => {
  it("실제 lms ps --json 출력에서 ttlMs를 읽는다", () => {
    expect(findLmsTtlMs(REAL_PS_JSON, "gemma-4-e2b-it-qat-mobile")).toBe(3_600_000);
  });

  it("목록에 없는 모델은 판정을 보류한다", () => {
    // 적재 여부부터 불확실하다 — "TTL 없음"이라고 단정하면 거짓 경고가 된다.
    expect(findLmsTtlMs(REAL_PS_JSON, "other-model")).toBeUndefined();
  });

  it("ttlMs가 0이면 TTL 없음으로 확정한다", () => {
    const out = JSON.stringify([{ identifier: "m1", ttlMs: 0 }]);
    expect(findLmsTtlMs(out, "m1")).toBeNull();
  });

  it("항목은 있는데 ttl 필드가 없으면 보류한다 — 빌드가 안 내보낼 수 있다", () => {
    const out = JSON.stringify([{ identifier: "m1", status: "idle" }]);
    expect(findLmsTtlMs(out, "m1")).toBeUndefined();
  });

  it("평문 출력(--json 미지원)은 보류한다", () => {
    expect(findLmsTtlMs("IDENTIFIER   STATUS\nm1   idle\n", "m1")).toBeUndefined();
  });

  it("깨진 JSON은 보류한다", () => {
    expect(findLmsTtlMs("[{oops", "m1")).toBeUndefined();
  });

  it("배열이 아니라 {models:[...]} 로 와도 읽는다", () => {
    const out = JSON.stringify({ models: [{ modelKey: "m1", ttlMs: 1_000 }] });
    expect(findLmsTtlMs(out, "m1")).toBe(1_000);
  });
});

describe("verifyLmStudioTtlApplied", () => {
  beforeEach(() => {
    process.env.ENABLE_LMS_CLI = "1";
    _setLocalAddressesForTest(["127.0.0.1"]);
  });
  afterEach(() => {
    delete process.env.ENABLE_LMS_CLI;
    _setLocalAddressesForTest(null);
    _setExecFileForTest(null);
  });

  /** lms-cli는 콜백형 execFile을 promisify해 쓴다 — 콜백으로 돌려줘야 한다. */
  const stubPs = (stdout: string) =>
    _setExecFileForTest(((_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (e: unknown, out: string, err: string) => void)?.(null, stdout, "");
      return {} as never;
    }) as never);

  it("로컬 대상이면 ttl을 읽어 applied로 확정한다", async () => {
    stubPs(REAL_PS_JSON);
    const r = await verifyLmStudioTtlApplied({
      baseUrl: "http://127.0.0.1:1234",
      modelId: "gemma-4-e2b-it-qat-mobile",
    });
    expect(r).toBe("applied");
  });

  it("원격 대상이면 확인하지 않는다 — lms ps는 이 서버 기계의 이야기다", async () => {
    stubPs(REAL_PS_JSON);
    const r = await verifyLmStudioTtlApplied({
      baseUrl: "http://10.10.4.90:1234",
      modelId: "gemma-4-e2b-it-qat-mobile",
    });
    expect(r).toBeNull();
  });

  it("CLI가 꺼져 있으면 확인하지 않는다", async () => {
    delete process.env.ENABLE_LMS_CLI;
    stubPs(REAL_PS_JSON);
    expect(
      await verifyLmStudioTtlApplied({ baseUrl: "http://127.0.0.1:1234", modelId: "gemma-4-e2b-it-qat-mobile" }),
    ).toBeNull();
  });

  it("ttl이 0으로 확인되면 not_applied", async () => {
    stubPs(JSON.stringify([{ identifier: "m1", ttlMs: 0 }]));
    expect(await verifyLmStudioTtlApplied({ baseUrl: "http://127.0.0.1:1234", modelId: "m1" })).toBe(
      "not_applied",
    );
  });

  it("lms ps가 실패해도 벤치를 깨뜨리지 않고 보류한다", async () => {
    _setExecFileForTest(((_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (e: unknown, out: string, err: string) => void)?.(new Error("ENOENT"), "", "");
      return {} as never;
    }) as never);
    expect(await verifyLmStudioTtlApplied({ baseUrl: "http://127.0.0.1:1234", modelId: "m1" })).toBeNull();
  });
});
