import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeProdBenchDatabase,
  getProdBenchDatabaseOpenError,
  tryOpenProdBenchDatabase,
} from "./database.js";

/**
 * 싱글톤(모듈 상태) 생애주기 회귀 테스트.
 * - `closeProdBenchDatabase()` 이후 같은 프로세스에서 다시 열 수 있어야 한다 (cache가 `null`이 아니라 `undefined`로 리셋).
 * - 열기 실패는 ms 단위 backoff로 캐시되며, 영구 비활성이 아니다 (재기동 없이 자동 복구 가능).
 */
describe("prod bench database lifecycle", () => {
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "llm-bench-db-"));
    originalEnv = process.env.BENCH_DB_PATH;
    closeProdBenchDatabase(); // 다른 테스트 상태 격리
  });

  afterEach(() => {
    closeProdBenchDatabase();
    if (originalEnv === undefined) delete process.env.BENCH_DB_PATH;
    else process.env.BENCH_DB_PATH = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("close 후 다시 열 수 있어야 한다", () => {
    process.env.BENCH_DB_PATH = path.join(tmpRoot, "ok.sqlite");
    const a = tryOpenProdBenchDatabase();
    expect(a).not.toBeNull();
    // close 전에는 동작
    expect(() => a!.exec("SELECT 1")).not.toThrow();
    closeProdBenchDatabase();
    // close 후 a는 닫혀 사용 불가
    expect(() => a!.exec("SELECT 1")).toThrow();
    const b = tryOpenProdBenchDatabase();
    expect(b).not.toBeNull();
    // 새 인스턴스라 동작
    expect(() => b!.exec("SELECT 1")).not.toThrow();
  });

  it("열기 실패는 일정 시간 캐시되지만 영구 null이 아니다", () => {
    // 열 수 없는 경로(파일을 디렉터리로 점유)로 실패 유도
    const blocked = path.join(tmpRoot, "blocked");
    process.env.BENCH_DB_PATH = path.join(blocked, "child", "bench.sqlite");
    // 부모를 파일로 만들어 mkdirSync({ recursive: true })가 실패하게 함
    require("node:fs").writeFileSync(blocked, "not-a-dir");

    const r1 = tryOpenProdBenchDatabase();
    expect(r1).toBeNull();
    expect(getProdBenchDatabaseOpenError()).not.toBeNull();

    // 즉시 재호출: backoff 중이라 같은 null 반환 (open 시도 없음)
    const r2 = tryOpenProdBenchDatabase();
    expect(r2).toBeNull();
    // 차단 해소 + close로 캐시 강제 리셋 → 재시도 가능
    rmSync(blocked);
    closeProdBenchDatabase();
    process.env.BENCH_DB_PATH = path.join(tmpRoot, "recovered.sqlite");
    const r3 = tryOpenProdBenchDatabase();
    expect(r3).not.toBeNull();
  });

  it("close()는 미열림 상태에서도 안전하다 (no-op)", () => {
    expect(() => closeProdBenchDatabase()).not.toThrow();
    expect(() => closeProdBenchDatabase()).not.toThrow();
  });
});
