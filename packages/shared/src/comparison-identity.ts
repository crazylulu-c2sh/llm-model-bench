/** Raw provider model IDs remain intact; aggregation may use a server/configuration identity. */
export function modelKey(row: { model_id: string; comparison_id?: string }): string {
  return row.comparison_id ?? row.model_id;
}
export function comparisonId(meta: { base_url: string; provider: string; model_id: string; config_id?: string; run_id: string }): string {
  return JSON.stringify([meta.base_url.replace(/\/+$/, ""), meta.provider, meta.model_id, meta.config_id ?? meta.run_id]);
}
