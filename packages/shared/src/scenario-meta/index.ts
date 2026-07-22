import type { ScenarioId } from "../scenarios-preview";
import type { BenchLocale, ScenarioBenchMeta, ScenarioBenchMetaText } from "./types";
import { META_KO, AGENT_META_KO } from "./meta.ko";
import { META_EN, AGENT_META_EN } from "./meta.en";
import { META_JA, AGENT_META_JA } from "./meta.ja";

export type { BenchLocale, ScenarioBenchMeta, ScenarioBenchMetaText } from "./types";

const BY_LOCALE: Record<
  BenchLocale,
  { meta: Record<ScenarioId, ScenarioBenchMetaText>; agent: Record<string, ScenarioBenchMetaText> }
> = {
  ko: { meta: META_KO, agent: AGENT_META_KO },
  en: { meta: META_EN, agent: AGENT_META_EN },
  ja: { meta: META_JA, agent: AGENT_META_JA },
};

/** UI용: 로케일별 시나리오 메타(목적·품질 기준 등). 미지정 시 ko. */
export function getScenarioBenchMeta(id: string, locale: BenchLocale = "ko"): ScenarioBenchMetaText | null {
  const { meta, agent } = BY_LOCALE[locale] ?? BY_LOCALE.ko;
  if ((id as ScenarioId) in meta) return meta[id as ScenarioId];
  if (id in agent) return agent[id]!;
  return null;
}

/**
 * 와이어 계약(API/MCP) 전용 — 항상 ko, `*Ko` 필드명. buildScenarioCatalog만 사용.
 * 정의된 키만 포함해 기존 JSON과 바이트 동일(undefined 필드는 생략).
 */
export function getScenarioBenchMetaKoWire(id: string): ScenarioBenchMeta | null {
  const t = getScenarioBenchMeta(id, "ko");
  if (!t) return null;
  const wire: ScenarioBenchMeta = { purposeKo: t.purpose, criteriaKo: t.criteria };
  if (t.promptNotes !== undefined) wire.promptNotesKo = t.promptNotes;
  if (t.toolsSummary !== undefined) wire.toolsSummaryKo = t.toolsSummary;
  if (t.routes !== undefined) wire.routesKo = t.routes;
  if (t.implementation !== undefined) wire.implementationKo = t.implementation;
  return wire;
}
