import { createColumnHelper, createTable, getCoreRowModel } from "@tanstack/react-table";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsTable, type ResultRow } from "./ResultsTable";
import { ResultPlaceholderCells, withResultPlaceholder, type PlaceholderColumn } from "./result-placeholder-columns";

const unit = (scenario = "chat_ping") => ({ rowKey: scenario, model_id: "test-model", scenario, api: "chat_completions" });
const complete = (scenario = "chat_ping"): ResultRow => ({ ...unit(scenario), ttft_ms: 1, pass: true });
const ids = (html: string) => [...html.matchAll(/data-column-id="([^"]+)"/g)].map(match => match[1]);
function assertAllRows(html: string) {
  const header = ids(html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)![1]);
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1];
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(ids(row[1])).toEqual(header);
    expect(row[1].match(/data-column-id="scenario"[^>]*>([\s\S]*?)<\/td>/)?.[1]).toContain("chat_completions");
    expect(row[1].match(/data-column-id="model_id"[^>]*>([\s\S]*?)<\/td>/)?.[1]).toContain("test-model");
  }
  return header;
}

describe("ResultsTable column contract", () => {
  it.each(["text", "pending-agent", "skipped-agent", "complete-agent"])("aligns every row: %s", variant => {
    const html = renderToStaticMarkup(<ResultsTable
      rows={[complete(variant === "complete-agent" ? "agent_loop_mock_v1" : "chat_ping")]}
      pendingRows={[unit(variant === "pending-agent" ? "agent_loop_mock_v1" : "chat_hello")]}
      skippedRows={[{ ...unit(variant === "skipped-agent" ? "agent_loop_mock_v1" : "code_sort_js"), reasonCode: "cancelled" }]}
    />);
    const header = assertAllRows(html);
    expect(header.includes("agent")).toBe(variant !== "text");
    const quality = [...html.matchAll(/data-column-id="quality"[^>]*>([\s\S]*?)<\/td>/g)];
    expect(quality.at(-1)?.[1]).toContain("미실행");
  });

  it("keeps the same columns through pending, completed and skipped-only states", () => {
    const pending = renderToStaticMarkup(<ResultsTable rows={[]} pendingRows={[unit()]} />);
    const completed = renderToStaticMarkup(<ResultsTable rows={[complete()]} />);
    const skipped = renderToStaticMarkup(<ResultsTable rows={[]} skippedRows={[unit()]} />);
    expect(assertAllRows(pending)).toEqual(assertAllRows(completed));
    expect(assertAllRows(skipped)).toEqual(assertAllRows(completed));
  });

  it("follows added, removed, reordered and hidden columns without editing placeholder rows", () => {
    const helper = createColumnHelper<{ value: number }>();
    // @ts-expect-error New columns cannot omit their placeholder semantics.
    const invalid: PlaceholderColumn[] = [helper.accessor("value", {})];
    void invalid;
    for (const variant of ["baseline", "added", "removed", "reordered", "hidden"]) {
      const names = variant === "removed" ? ["first"] : variant === "added" ? ["first", "second", "new-column"] : ["first", "second"];
      const columns = names.map(id => withResultPlaceholder(helper.accessor("value", { id }), "metric")) satisfies PlaceholderColumn[];
      const table = createTable({
        data: [{ value: 1 }], columns, getCoreRowModel: getCoreRowModel(), onStateChange: () => {}, renderFallbackValue: null,
        state: { columnOrder: variant === "reordered" ? ["second", "first"] : [],
          columnVisibility: variant === "hidden" ? { first: false } : {}, columnPinning: { left: [], right: [] } },
      });
      const headers = table.getVisibleLeafColumns().map(column => column.id);
      expect(table.getRowModel().rows[0].getVisibleCells().map(cell => cell.column.id)).toEqual(headers);
      for (const state of ["pending", "skipped"] as const) {
        const html = renderToStaticMarkup(<table><tbody><tr><ResultPlaceholderCells
          columns={table.getVisibleLeafColumns()} row={unit()} state={state} unrunLabel="Skipped"
        /></tr></tbody></table>);
        expect(ids(html)).toEqual(headers);
      }
    }
  });
});
