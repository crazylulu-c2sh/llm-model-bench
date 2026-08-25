import { describe, expect, it } from "vitest";
import { listBaseUrlNames, openBenchDatabase, upsertBaseUrlName } from "./database.js";

describe("base_url_names (Base URL alias)", () => {
  it("upserts and lists sorted by base_url; update keeps a single row", () => {
    const db = openBenchDatabase(":memory:");
    upsertBaseUrlName(db, "http://b.example/v1", "B Host", "", "2026-07-01T00:00:00.000Z");
    upsertBaseUrlName(db, "http://a.example/v1", "A Host", "RTX 4060 8GB", "2026-07-01T00:00:00.000Z");

    let rows = listBaseUrlNames(db);
    expect(rows).toEqual([
      { base_url: "http://a.example/v1", name: "A Host", note: "RTX 4060 8GB" },
      { base_url: "http://b.example/v1", name: "B Host", note: "" },
    ]);

    // Same-key update — new name/note, single row retained.
    upsertBaseUrlName(db, "http://a.example/v1", "A Host v2", "", "2026-07-02T00:00:00.000Z");
    rows = listBaseUrlNames(db);
    expect(rows[0]).toEqual({ base_url: "http://a.example/v1", name: "A Host v2", note: "" });
    expect(rows).toHaveLength(2);
  });

  it("trims name/note; blank string or null name removes the alias", () => {
    const db = openBenchDatabase(":memory:");
    upsertBaseUrlName(db, "http://c.example/v1", "  Trimmed  ", "  DGX Spark  ");
    expect(listBaseUrlNames(db)).toEqual([
      { base_url: "http://c.example/v1", name: "Trimmed", note: "DGX Spark" },
    ]);

    upsertBaseUrlName(db, "http://c.example/v1", "   ", ""); // blank name → clear (note goes too)
    expect(listBaseUrlNames(db)).toEqual([]);
    upsertBaseUrlName(db, "http://c.example/v1", null); // null also clears (no-op now)
    expect(listBaseUrlNames(db)).toEqual([]);
  });

  it("schema version reaches 4 on a fresh database", () => {
    const db = openBenchDatabase(":memory:");
    const row = db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(4);
    // Table exists and accepts a write.
    upsertBaseUrlName(db, "http://d.example", "D");
    expect(listBaseUrlNames(db)).toHaveLength(1);
  });
});
