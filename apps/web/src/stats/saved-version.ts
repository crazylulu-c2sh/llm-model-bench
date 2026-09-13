/** Persisted evaluation/warmup versions, independent of app and scenario versions. */
export type SavedVersion = { evaluation: number | null; warmup: number | null };

function versionNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function savedVersion(config?: Record<string, unknown>): SavedVersion {
  return {
    evaluation: versionNumber(config?.evaluation_protocol_version),
    warmup: versionNumber(config?.warmup_protocol_version),
  };
}

export function savedVersionKey(version: SavedVersion): string {
  return JSON.stringify([version.evaluation, version.warmup]);
}

export function savedVersionOptions(configs: Array<Record<string, unknown> | undefined>): SavedVersion[] {
  const unique = new Map(configs.map(config => {
    const version = savedVersion(config);
    return [savedVersionKey(version), version] as const;
  }));
  return [...unique.values()].sort((a, b) =>
    (b.evaluation ?? -1) - (a.evaluation ?? -1) || (b.warmup ?? -1) - (a.warmup ?? -1));
}
