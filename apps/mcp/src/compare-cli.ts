import type { CompareResponse } from "@llm-bench/shared";
import { BenchClient } from "./bench-client.js";
import { loadConfig } from "./config.js";

/**
 * #84: 헤드리스 회귀 게이트 CLI.
 *
 * 두 런/모델을 비교하고 요약을 출력한다. regression이면 --webhook로 POST하고,
 * --fail-on-regression이면 exit 1로 종료 → CI·릴리스-워치가 LM Studio 업그레이드 후 자동 알림.
 *
 * 사용:
 *   llm-bench-compare --runA <id> --runB <id> [--fail-on-regression] [--webhook <url>]
 *   llm-bench-compare --modelA <m> --modelB <m> --baseUrl <url> [--tps-regression-pct 0.1]
 */

function argVal(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const pref = `--${name}=`;
  const eq = process.argv.find((a) => a.startsWith(pref));
  return eq ? eq.slice(pref.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function num(v: number | null, digits = 2): string {
  return v == null ? "—" : v.toFixed(digits);
}

/** CompareResponse → 사람이 읽는 요약(process.stdout). */
export function formatCompareSummary(res: CompareResponse): string {
  const lines: string[] = [];
  lines.push(
    `compare: ${res.runA.model_id}${res.runA.run_id ? `(${res.runA.run_id})` : ""} → ${res.runB.model_id}${res.runB.run_id ? `(${res.runB.run_id})` : ""}`,
  );
  for (const s of res.scenarios) {
    const flag = s.regression ? `⚠ REGRESSION [${s.regressions.join(", ")}]` : "ok";
    lines.push(
      `  ${s.scenario}/${s.api_route}: quality ${num(s.quality.a)}→${num(s.quality.b)} · ` +
        `tps(agg) ${num(s.tps_aggregate.a)}→${num(s.tps_aggregate.b)} · ` +
        `ttft_p95 ${num(s.ttft_p95.a, 0)}→${num(s.ttft_p95.b, 0)} · ` +
        `empty ${num(s.empty_turn_rate.a)}→${num(s.empty_turn_rate.b)}  ${flag}`,
    );
  }
  lines.push(
    `summary: ${res.summary.scenarios_regressed}/${res.summary.scenarios_compared} scenarios regressed` +
      (res.summary.regression ? ` — REGRESSION [${res.summary.regressions.join(", ")}]` : " — clean"),
  );
  return lines.join("\n");
}

/** exit code 결정(순수, 테스트용): regression && fail-on-regression → 1. */
export function exitCodeFor(res: CompareResponse, failOnRegression: boolean): number {
  return res.summary.regression && failOnRegression ? 1 : 0;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new BenchClient(cfg);

  const qs = new URLSearchParams();
  for (const k of ["runA", "runB", "modelA", "modelB", "baseUrl"] as const) {
    const v = argVal(k);
    if (v != null) qs.set(k, v);
  }
  for (const [flag, param] of [
    ["quality-drop", "qualityDropAbs"],
    ["tps-regression-pct", "tpsRegressionPct"],
    ["ttft-regression-pct", "ttftRegressionPct"],
  ] as const) {
    const v = argVal(flag);
    if (v != null) qs.set(param, v);
  }
  if (hasFlag("no-empty-turn-flag")) qs.set("flagNewEmptyTurns", "false");

  const webhook = argVal("webhook");
  const failOnRegression = hasFlag("fail-on-regression");

  let res: CompareResponse;
  try {
    res = await client.getJson<CompareResponse>(`/compare?${qs.toString()}`);
  } catch (e) {
    console.error(`[compare] request failed: ${(e as Error).message}`);
    process.exit(2);
  }

  console.log(formatCompareSummary(res));

  if (res.summary.regression && webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(res),
      });
      console.error(`[compare] webhook posted → ${webhook}`);
    } catch (e) {
      console.error(`[compare] webhook failed: ${(e as Error).message}`);
    }
  }

  process.exit(exitCodeFor(res, failOnRegression));
}

// 테스트에서 import 시 main()이 돌지 않도록 직접 실행 여부를 가드.
if (process.argv[1] && /compare-cli\.(js|ts)$/.test(process.argv[1])) {
  void main();
}
