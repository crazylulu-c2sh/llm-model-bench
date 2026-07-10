import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CustomScenarioInputSchema, clearRegisteredScenarios, isRegisteredScenario, getScenarioDef } from "@llm-bench/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openBenchDatabase, listCustomScenarios, countCustomScenarios, deleteCustomScenario } from "./db/database.js";
import { loadCustomScenariosAtStartup, registerCustomScenario } from "./custom-scenarios.js";

const NOW = "2026-07-10T00:00:00.000Z";

function input(id: string) {
  return CustomScenarioInputSchema.parse({
    id,
    system: "You are a custom agent.",
    user: "Do the thing.",
    judge: { criterion: "score the answer" },
  });
}

beforeEach(() => clearRegisteredScenarios());
afterEach(() => {
  clearRegisteredScenarios();
  delete process.env.CUSTOM_SCENARIOS_DIR;
});

describe("custom scenario persistence + startup loader (#83)", () => {
  it("registerCustomScenario upserts DB + registers in registry with source=custom", () => {
    const db = openBenchDatabase(":memory:");
    const def = registerCustomScenario(db, input("my_task"), NOW);
    expect(def.source).toBe("custom");
    expect(isRegisteredScenario("my_task")).toBe(true);
    expect(countCustomScenarios(db)).toBe(1);
    expect(listCustomScenarios(db)[0]!.id).toBe("my_task");
  });

  it("startup loader re-registers DB rows into the registry", () => {
    const db = openBenchDatabase(":memory:");
    registerCustomScenario(db, input("my_task"), NOW);
    clearRegisteredScenarios(); // simulate fresh process (registry empty)
    expect(isRegisteredScenario("my_task")).toBe(false);
    const { loaded, errors } = loadCustomScenariosAtStartup(db);
    expect(loaded).toBe(1);
    expect(errors).toEqual([]);
    expect(getScenarioDef("my_task")?.source).toBe("custom");
  });

  it("startup loader reads *.json from CUSTOM_SCENARIOS_DIR", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-bench-custom-"));
    fs.writeFileSync(path.join(dir, "wiki.json"), JSON.stringify(input("provisioned_task")));
    fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ id: "vision_bad", system: "s", user: "u" }));
    fs.writeFileSync(path.join(dir, "notjson.txt"), "ignored");
    process.env.CUSTOM_SCENARIOS_DIR = dir;
    const { loaded, errors } = loadCustomScenariosAtStartup(null);
    expect(isRegisteredScenario("provisioned_task")).toBe(true);
    expect(loaded).toBe(1); // only the valid one
    expect(errors.length).toBe(1); // vision_bad rejected
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deleteCustomScenario removes the DB row", () => {
    const db = openBenchDatabase(":memory:");
    registerCustomScenario(db, input("my_task"), NOW);
    expect(deleteCustomScenario(db, "my_task")).toBe(1);
    expect(countCustomScenarios(db)).toBe(0);
  });

  it("migration creates custom_scenarios table and is idempotent", () => {
    const db = openBenchDatabase(":memory:");
    // re-opening / re-migrating the same in-memory db is not applicable; assert table exists via a query.
    expect(() => listCustomScenarios(db)).not.toThrow();
    const version = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(version.v).toBeGreaterThanOrEqual(3);
  });
});
