import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPollingJson } from "./monitor-polling";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchPollingJson", () => {
  it("returns parsed data on 2xx + valid json", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"x":1}',
    })) as unknown as typeof fetch;
    const r = await fetchPollingJson<{ x: number }>("/x", null, new AbortController().signal);
    expect(r).toEqual({ ok: true, data: { x: 1 } });
  });

  it("returns error string on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    })) as unknown as typeof fetch;
    const r = await fetchPollingJson("/x", null, new AbortController().signal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/HTTP 500/);
  });

  it("returns error on invalid json", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "not json{",
    })) as unknown as typeof fetch;
    const r = await fetchPollingJson("/x", null, new AbortController().signal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid_json/);
  });

  it("passes signal to fetch (abort propagates)", async () => {
    let seenSignal: AbortSignal | null = null;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? null;
      return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    await fetchPollingJson("/x", null, ac.signal);
    expect(seenSignal).toBe(ac.signal);
  });
});
