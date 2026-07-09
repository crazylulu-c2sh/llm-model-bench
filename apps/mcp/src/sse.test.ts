import { describe, expect, it } from "vitest";
import { consumeSseJsonLines } from "./sse.js";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("consumeSseJsonLines", () => {
  it("parses data: JSON frames", async () => {
    const out: unknown[] = [];
    await consumeSseJsonLines(
      streamFrom([`data: {"type":"a"}\n\n`, `data: {"type":"b","n":2}\n\n`]),
      (ev) => out.push(ev),
    );
    expect(out).toEqual([{ type: "a" }, { type: "b", n: 2 }]);
  });

  it("reassembles frames split across chunks", async () => {
    const out: unknown[] = [];
    await consumeSseJsonLines(
      streamFrom([`data: {"ty`, `pe":"split"}\n`, `\ndata: {"type":"next"}\n\n`]),
      (ev) => out.push(ev),
    );
    expect(out).toEqual([{ type: "split" }, { type: "next" }]);
  });

  it("ignores non-data lines and invalid JSON", async () => {
    const out: unknown[] = [];
    await consumeSseJsonLines(
      streamFrom([`: comment\n\n`, `data: not-json\n\n`, `data: {"ok":true}\n\n`]),
      (ev) => out.push(ev),
    );
    expect(out).toEqual([{ ok: true }]);
  });
});
