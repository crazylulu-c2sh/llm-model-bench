import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CustomScenarioInputSchema,
  registerScenarioDef,
  type CustomScenarioInput,
  type ScenarioDef,
} from "@llm-bench/shared";
import { countCustomScenarios, listCustomScenarios, upsertCustomScenario } from "./db/database.js";

/** #83: 커스텀 시나리오 최대 개수(POST 무한 증식 방지). */
export const MAX_CUSTOM_SCENARIOS = 200;

function toDef(input: CustomScenarioInput): ScenarioDef {
  return { ...input, source: "custom" };
}

/** POST /scenarios: 검증된 입력을 DB에 upsert + 런타임 레지스트리에 등록. */
export function registerCustomScenario(
  db: DatabaseSync | null,
  input: CustomScenarioInput,
  now: string,
): ScenarioDef {
  const def = toDef(input);
  if (db) upsertCustomScenario(db, { id: def.id, def_json: JSON.stringify(input), now });
  registerScenarioDef(def);
  return def;
}

/**
 * 서버 부팅 시 커스텀 시나리오 로드·등록.
 * 1) `CUSTOM_SCENARIOS_DIR`의 `*.json`(ops 프로비저닝) → 2) DB(사용자 생성) 순.
 * 같은 id 충돌 시 나중(DB)이 우선. 잘못된 파일/행은 건너뛰고 사유를 모은다(부팅 실패 없음).
 */
export function loadCustomScenariosAtStartup(db: DatabaseSync | null): {
  loaded: number;
  errors: string[];
} {
  const errors: string[] = [];
  let loaded = 0;

  const dir = process.env.CUSTOM_SCENARIOS_DIR?.trim();
  if (dir) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch (e) {
      errors.push(`dir ${dir}: ${(e as Error).message}`);
    }
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        const parsed = CustomScenarioInputSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          errors.push(`${f}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          continue;
        }
        registerScenarioDef(toDef(parsed.data));
        loaded += 1;
      } catch (e) {
        errors.push(`${f}: ${(e as Error).message}`);
      }
    }
  }

  if (db) {
    for (const row of listCustomScenarios(db)) {
      try {
        const parsed = CustomScenarioInputSchema.safeParse(JSON.parse(row.def_json));
        if (!parsed.success) {
          errors.push(`db ${row.id}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          continue;
        }
        registerScenarioDef(toDef(parsed.data));
        loaded += 1;
      } catch (e) {
        errors.push(`db ${row.id}: ${(e as Error).message}`);
      }
    }
  }

  return { loaded, errors };
}

export function customScenarioCount(db: DatabaseSync | null): number {
  return db ? countCustomScenarios(db) : 0;
}
