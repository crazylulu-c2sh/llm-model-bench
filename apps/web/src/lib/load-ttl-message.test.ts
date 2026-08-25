import { describe, expect, it } from "vitest";
import { MESSAGES } from "../i18n/messages";
import { loadTtlNotice } from "./load-ttl-message";

const m = MESSAGES.ko;

describe("loadTtlNotice", () => {
  it("TTL을 요청하지 않은 런(상태 없음)에는 아무것도 알리지 않는다", () => {
    expect(loadTtlNotice(m, "mdl", undefined)).toBeNull();
  });

  it("서버가 ttl을 거절하면 경고", () => {
    const n = loadTtlNotice(m, "mdl", "rejected");
    expect(n?.level).toBe("warn");
    expect(n?.text).toContain("mdl");
  });

  it("2xx는 확인 불가 — 실패가 아니므로 정보 수준으로 알린다", () => {
    // 성공 경로에서 매번 경고를 띄우면 진짜 경고가 묻힌다.
    expect(loadTtlNotice(m, "mdl", "unknown")?.level).toBe("info");
  });

  it("상주 중이라 못 건 경우와 그 외 미적용은 다른 문구를 쓴다", () => {
    const resident = loadTtlNotice(m, "mdl", "not_applied", "already_in_memory");
    const other = loadTtlNotice(m, "mdl", "not_applied", "load_skipped_by_request");
    expect(resident?.level).toBe("warn");
    expect(other?.level).toBe("warn");
    expect(resident?.text).not.toBe(other?.text);
    // 상주 케이스는 "먼저 언로드해야 한다"는 다음 행동을 알려줘야 한다.
    expect(resident?.text).toContain("언로드");
  });

  it("모든 로케일에서 네 문구가 서로 구분된다", () => {
    for (const locale of ["ko", "en", "ja"] as const) {
      const msgs = MESSAGES[locale];
      const texts = [
        loadTtlNotice(msgs, "x", "rejected")?.text,
        loadTtlNotice(msgs, "x", "unknown")?.text,
        loadTtlNotice(msgs, "x", "not_applied", "already_in_memory")?.text,
        loadTtlNotice(msgs, "x", "not_applied")?.text,
      ];
      expect(new Set(texts).size).toBe(4);
    }
  });
});
